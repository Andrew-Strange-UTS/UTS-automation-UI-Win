// server/scheduler.js
// Manages cron jobs for scheduled sequences

const cron = require("node-cron");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const scheduleStore = require("./scheduleStore");
const secretsStore = require("./secrets");

const { TESTS_ROOT } = require("./utils/paths");
const BUILTINS_DIR = path.join(__dirname, "./builtins");

// Active cron jobs keyed by schedule ID
const activeJobs = {};

// Running child processes keyed by schedule ID
const runningProcesses = {};

// Logs keyed by schedule ID (last run)
const runLogs = {};

function getRunLogs(id) {
  return runLogs[id] || "";
}

function buildCronExpression(schedule) {
  // schedule.time = "09:00"
  // schedule.days = ["mon","tue","wed","thu","fri"] etc.
  const [hour, minute] = schedule.time.split(":");
  const dayMap = {
    sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
  };
  const dayNums = schedule.days.map((d) => dayMap[d.toLowerCase()]);
  // cron: minute hour * * days
  return `${parseInt(minute)} ${parseInt(hour)} * * ${dayNums.join(",")}`;
}

function compileAndRun(schedule, onLog, onDone) {
  // Use bundled secrets if available, otherwise fall back to secrets store
  const allSecrets = schedule.bundledSecrets && Object.keys(schedule.bundledSecrets).length > 0
    ? { ...schedule.bundledSecrets }
    : (() => {
        const s = {};
        secretsStore.listNames().forEach((name) => { s[name] = secretsStore.getSecret(name); });
        return s;
      })();

  const { sequence, parameters = {} } = schedule.sequencePayload;

  // Merge secrets into parameters
  const parametersWithSecrets = {};
  for (const test of sequence) {
    parametersWithSecrets[test.name] = {
      ...(parameters[test.name] || {}),
      ...allSecrets,
      ...(test.oktaUrl ? { oktaUrl: test.oktaUrl } : {}),
    };
  }

  const seqId = "scheduled-" + uuidv4().slice(0, 8);
  const seqDir = path.join(TESTS_ROOT, seqId);
  try {
    fs.mkdirSync(seqDir, { recursive: true });
  } catch (e) {
    onLog(`[ERROR] Failed to create sequence dir: ${e.message}\n`);
    onDone(1);
    return null;
  }

  // Write bundled test code to temp files if available
  const bundledCode = schedule.bundledTestCode || {};
  for (const test of sequence) {
    const key = test.builtin || test.name;
    if (bundledCode[key]) {
      // For builtins, ensure the file exists
      if (test.builtin) {
        const builtinPath = path.join(BUILTINS_DIR, test.builtin + ".js");
        if (!fs.existsSync(builtinPath)) {
          fs.writeFileSync(builtinPath, bundledCode[key]);
        }
      } else {
        // For repo tests, ensure the test dir + run.js exists
        const testDir = path.join(TESTS_ROOT, test.name);
        const testFile = path.join(testDir, "run.js");
        if (!fs.existsSync(testFile)) {
          fs.mkdirSync(testDir, { recursive: true });
          fs.writeFileSync(testFile, bundledCode[key]);
        }
      }
    }
  }

  const zephyrToken = allSecrets["ZEPHYR_API_TOKEN"] || "";

  const combinedRunJsContent = `
const { Builder, By, Key, until } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');
const { postTestExecution } = require(${JSON.stringify(path.join(__dirname, "./utils/zephyr.js"))});
const stepFns = [
${sequence.map((test) => {
    if (test.builtin) {
      return `  require(${JSON.stringify(path.join(BUILTINS_DIR, test.builtin + ".js"))})`;
    }
    return `  require(${JSON.stringify(path.join(TESTS_ROOT, test.name, "run.js"))})`;
  }).join(",\n")}
];
const stepNames = [
${sequence.map((test) => `  ${JSON.stringify(test.name)}`).join(",\n")}
];
const stepZephyrConfigs = [
${sequence.map((test) => `  ${JSON.stringify(test.zephyr || null)}`).join(",\n")}
];
const ZEPHYR_TOKEN = ${JSON.stringify(zephyrToken)};
function log(msg) { process.stdout.write(msg + "\\n"); }
async function sendZephyrResult(zephyrConfig, statusName, stepResults) {
  if (!zephyrConfig || !ZEPHYR_TOKEN) return;
  try {
    const result = await postTestExecution(ZEPHYR_TOKEN, {
      projectKey: zephyrConfig.projectKey,
      testCaseKey: zephyrConfig.caseKey,
      testCycleKey: zephyrConfig.cycleKey,
      statusName,
      testScriptResults: stepResults.length > 0 ? stepResults : undefined,
    });
    log("Zephyr: Reported " + statusName + " for " + zephyrConfig.caseKey + " (HTTP " + result.statusCode + ")");
  } catch (err) {
    log("Zephyr: Failed to report for " + zephyrConfig.caseKey + ": " + (err && err.message || err));
  }
}
process.on('uncaughtException', function (err) {
  console.error('[FATAL uncaughtException]', err && err.stack || err);
  process.exit(2);
});
process.on('unhandledRejection', function (err) {
  console.error('[FATAL unhandledRejection]', err && err.stack || err);
  process.exit(2);
});
async function main() {
  const seleniumUrl = process.env.SELENIUM_REMOTE_URL || "http://localhost:4444/wd/hub";
  const options = new chrome.Options();
  options.addArguments("--headless=new","--disable-gpu","--no-sandbox","--window-size=1920,1080");
  let driver;
  let failedCount = 0;
  let passedCount = 0;
  try {
    driver = await new Builder().forBrowser("chrome").setChromeOptions(options).usingServer(seleniumUrl).build();
    const parameters = ${JSON.stringify(parametersWithSecrets)};
    for (let i = 0; i < stepFns.length; ++i) {
      const fn = stepFns[i];
      const testName = stepNames[i];
      const testParams = parameters[testName] || {};
      const zephyrConfig = stepZephyrConfigs[i];
      const zephyrStepResults = [];
      const zephyrLog = function(actualResult, status) {
        zephyrStepResults.push({ statusName: status || "Pass", actualResult: String(actualResult) });
      };
      try {
        console.log("Running step #" + (i + 1) + " [" + testName + "]");
        await fn(driver, testParams, zephyrLog);
        console.log("Passed step #" + (i + 1) + " [" + testName + "]");
        const hasFailedZephyrStep = zephyrStepResults.some(function(r) { return r.statusName === "Fail"; });
        if (hasFailedZephyrStep) {
          failedCount++;
        } else {
          passedCount++;
        }
        await sendZephyrResult(zephyrConfig, hasFailedZephyrStep ? "Fail" : "Pass", zephyrStepResults);
      } catch (stepError) {
        failedCount++;
        console.error("Failed step #" + (i + 1) + " [" + testName + "]:", stepError && stepError.stack || stepError);
        zephyrLog("ERROR: " + (stepError && stepError.message || stepError), "Fail");
        await sendZephyrResult(zephyrConfig, "Fail", zephyrStepResults);
      }
    }
    await driver.quit();
    console.log("All steps finished. " + passedCount + " passed / " + failedCount + " failed.");
    process.exit(failedCount > 0 ? 1 : 0);
  } catch (err) {
    if (driver) await driver.quit();
    console.error("Fatal error in scheduled sequence:", err && err.stack || err);
    process.exit(1);
  }
}
main();
`;

  fs.writeFileSync(path.join(seqDir, "run.js"), combinedRunJsContent);

  const child = spawn("node", ["run.js"], {
    cwd: seqDir,
    env: {
      ...process.env,
      NODE_PATH: process.env.NODE_PATH,
      SELENIUM_REMOTE_URL: process.env.SELENIUM_REMOTE_URL || "http://selenium:4444/wd/hub",
      VISUAL_BROWSER: "false",
    },
  });

  child.stdout.on("data", (chunk) => {
    const text = chunk.toString();
    onLog(text);
    process.stdout.write(`[schedule:${schedule.id}] ${text}`);
  });
  child.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    onLog(text);
    process.stderr.write(`[schedule:${schedule.id}] ${text}`);
  });
  child.on("error", (err) => {
    onLog(`PROCESS ERROR: ${err.message}\n`);
    onDone(1);
  });
  child.on("close", (code) => {
    onLog(`\n=== Scheduled run finished with code ${code} ===\n`);
    onDone(code);
  });

  return child;
}

async function sendNotifications(schedule, code, logs) {
  const result = code === 0 ? "PASSED" : "FAILED";
  const now = new Date();
  const time = `${String(now.getDate()).padStart(2, "0")}/${now.toLocaleString("en-US", { month: "short" })}/${now.getFullYear()}, ${now.toLocaleString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true })}`;
  const stepNames = schedule.sequencePayload?.sequence?.map((t) => t.name).join(", ") || "unknown";
  const logText = (logs || "").trim();

  // ntfy
  if (schedule.ntfyTopic) {
    try {
      const title = `Scheduled sequence ${result}: ${schedule.name}`;
      const body = `${schedule.name} finished at ${time}\nResult: ${result}\nSteps: ${stepNames}\n\nLogs:\n${logText}`;
      const res = await fetch(`https://ntfy.sh/${schedule.ntfyTopic}`, {
        method: "POST",
        headers: {
          Title: title,
          Priority: code === 0 ? "default" : "high",
          Tags: code === 0 ? "white_check_mark" : "x",
        },
        body,
      });
      console.log(`[notify] ntfy sent to ${schedule.ntfyTopic} (HTTP ${res.status})`);
    } catch (err) {
      console.error(`[notify] ntfy failed:`, err.message);
    }
  }

  // Teams webhook — All messages (nice card, no logs)
  if (schedule.teamsWebhookAll) {
    try {
      const emoji = code === 0 ? "✅" : "❌";
      const color = code === 0 ? "00cc00" : "cc0000";
      const payload = {
        "@type": "MessageCard",
        "@context": "https://schema.org/extensions",
        themeColor: color,
        summary: `${emoji} ${schedule.name} - ${result}`,
        sections: [{
          activityTitle: `${emoji} Scheduled Sequence: ${schedule.name}`,
          facts: [
            { name: "Result", value: `**${result}**` },
            { name: "Time", value: time },
            { name: "Steps", value: stepNames },
          ],
          markdown: true,
        }],
      };
      const res = await fetch(schedule.teamsWebhookAll, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      console.log(`[notify] Teams (all) webhook sent (HTTP ${res.status})`);
    } catch (err) {
      console.error(`[notify] Teams (all) webhook failed:`, err.message);
    }
  }

  // Teams webhook — Failures only (includes logs)
  if (schedule.teamsWebhookFail && code !== 0) {
    try {
      const logsHtml = (logText || "(no logs)").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
      const payload = {
        "@type": "MessageCard",
        "@context": "https://schema.org/extensions",
        themeColor: "cc0000",
        summary: `❌ ${schedule.name} - FAILED`,
        sections: [
          {
            activityTitle: `❌ Scheduled Sequence: ${schedule.name}`,
            facts: [
              { name: "Result", value: "**FAILED**" },
              { name: "Time", value: time },
              { name: "Steps", value: stepNames },
            ],
            markdown: true,
          },
          {
            title: "Logs",
            text: `<pre>${logsHtml}</pre>`,
          },
        ],
      };
      const res = await fetch(schedule.teamsWebhookFail, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      console.log(`[notify] Teams (fail) webhook sent (HTTP ${res.status})`);
    } catch (err) {
      console.error(`[notify] Teams (fail) webhook failed:`, err.message);
    }
  }
}

function executeSchedule(scheduleId) {
  const schedule = scheduleStore.getById(scheduleId);
  if (!schedule || schedule.status === "stopped") return;

  // Don't run if already running
  if (runningProcesses[scheduleId]) {
    console.log(`[scheduler] Schedule ${scheduleId} is already running, skipping.`);
    return;
  }

  console.log(`[scheduler] Executing schedule: ${schedule.name} (${scheduleId})`);
  runLogs[scheduleId] = "";

  const child = compileAndRun(
    schedule,
    (text) => {
      runLogs[scheduleId] = (runLogs[scheduleId] || "") + text;
    },
    (code) => {
      delete runningProcesses[scheduleId];
      const now = new Date().toISOString();
      scheduleStore.update(scheduleId, {
        lastRun: now,
        lastResult: code === 0 ? "passed" : "failed",
      });
      console.log(`[scheduler] Schedule ${schedule.name} finished with code ${code}`);

      // Send notifications
      sendNotifications(schedule, code, runLogs[scheduleId]);
    }
  );

  if (child) {
    runningProcesses[scheduleId] = child;
  }
}

function startJob(schedule) {
  if (activeJobs[schedule.id]) {
    activeJobs[schedule.id].stop();
  }

  const cronExpr = buildCronExpression(schedule);
  console.log(`[scheduler] Starting cron for "${schedule.name}": ${cronExpr}`);

  const job = cron.schedule(cronExpr, () => {
    console.log(`[scheduler] Cron triggered for "${schedule.name}" (${schedule.id}) at ${new Date().toString()}`);
    executeSchedule(schedule.id);
  });
  job.start();

  activeJobs[schedule.id] = job;
}

function stopJob(scheduleId) {
  if (activeJobs[scheduleId]) {
    activeJobs[scheduleId].stop();
    delete activeJobs[scheduleId];
  }
  // Kill running process if any
  if (runningProcesses[scheduleId]) {
    runningProcesses[scheduleId].kill();
    delete runningProcesses[scheduleId];
  }
}

function pauseJob(scheduleId) {
  if (activeJobs[scheduleId]) {
    activeJobs[scheduleId].stop();
    delete activeJobs[scheduleId];
  }
}

function isRunning(scheduleId) {
  return !!runningProcesses[scheduleId];
}

// Restore active schedules on server startup
function restoreSchedules() {
  const all = scheduleStore.getAll();
  for (const schedule of all) {
    if (schedule.status === "active") {
      startJob(schedule);
    }
  }
  console.log(`[scheduler] Restored ${all.filter((s) => s.status === "active").length} active schedule(s)`);
}

module.exports = {
  startJob,
  stopJob,
  pauseJob,
  executeSchedule,
  isRunning,
  getRunLogs,
  restoreSchedules,
};
