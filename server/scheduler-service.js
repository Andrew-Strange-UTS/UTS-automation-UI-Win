#!/usr/bin/env node
// server/scheduler-service.js
// Standalone scheduler service — runs as a system-wide background process.
// All users share the same schedules, secrets, and logs.
// Exposes a REST API on port 5050 (configurable via UTS_SCHEDULER_PORT).

const express = require("express");
const cors = require("cors");
const cron = require("node-cron");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { v4: uuidv4 } = require("uuid");

const paths = require("./scheduler-service-paths");
const { portableEncrypt, portableDecrypt } = require("./utils/portableEncryption");
const { getChromeBinary } = require("./utils/chromeFinder");

const PORT = parseInt(process.env.UTS_SCHEDULER_PORT || "5050", 10);

// Resolve NODE_PATH for child processes (test runners need selenium-webdriver etc.)
const SERVER_NODE_MODULES = process.env.NODE_PATH || path.join(__dirname, "node_modules");

// ─── Bootstrap: copy builtins, runners, utils into shared data dir ───

function copyIfMissing(srcDir, destDir, files) {
  for (const file of files) {
    const dest = path.join(destDir, file);
    if (!fs.existsSync(dest)) {
      const src = path.join(srcDir, file);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, dest);
        console.log(`[bootstrap] Copied ${file} → ${destDir}`);
      }
    }
  }
}

copyIfMissing(
  path.join(__dirname, "builtins"),
  paths.BUILTINS_DIR,
  ["default-test.js", "desktop-sample.js", "okta-login.js", "okta-login-finish.js"]
);
copyIfMissing(
  path.join(__dirname, "runners"),
  paths.RUNNERS_DIR,
  ["desktop-runner.js"]
);
copyIfMissing(
  path.join(__dirname, "utils"),
  paths.UTILS_DIR,
  ["zephyr.js"]
);

// ─── Secrets store (own encryption key in shared data dir) ───

const ALGO = "aes-256-gcm";

function ensureKey() {
  if (fs.existsSync(paths.SECRETS_KEY_FILE)) {
    return fs.readFileSync(paths.SECRETS_KEY_FILE);
  }
  const key = crypto.randomBytes(32);
  fs.writeFileSync(paths.SECRETS_KEY_FILE, key, { mode: 0o600 });
  console.log(`[secrets] Generated new master key at ${paths.SECRETS_KEY_FILE}`);
  return key;
}

const ENCRYPTION_KEY = ensureKey();

function encryptData(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, ENCRYPTION_KEY, iv);
  let enc = cipher.update(JSON.stringify(plain), "utf8", "base64");
  enc += cipher.final("base64");
  const tag = cipher.getAuthTag();
  return iv.toString("hex") + ":" + tag.toString("hex") + ":" + enc;
}

function decryptData(str) {
  const [ivHex, tagHex, data] = str.split(":");
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const decipher = crypto.createDecipheriv(ALGO, ENCRYPTION_KEY, iv);
  decipher.setAuthTag(tag);
  let dec = decipher.update(data, "base64", "utf8");
  dec += decipher.final("utf8");
  return JSON.parse(dec);
}

let secrets = {};
try {
  if (fs.existsSync(paths.SECRETS_FILE)) {
    secrets = decryptData(fs.readFileSync(paths.SECRETS_FILE, "utf-8"));
  }
} catch { secrets = {}; }

function saveSecrets() {
  fs.writeFileSync(paths.SECRETS_FILE, encryptData(secrets), { mode: 0o600 });
}

const secretsStore = {
  listNames() { return Object.keys(secrets); },
  getSecret(name) { return secrets[name]; },
  setSecret(name, value) { secrets[name] = value; saveSecrets(); },
  deleteSecret(name) { delete secrets[name]; saveSecrets(); },
};

// ─── Schedule store (JSON file in shared data dir) ───

function loadSchedules() {
  try {
    if (fs.existsSync(paths.SCHEDULES_FILE)) {
      return JSON.parse(fs.readFileSync(paths.SCHEDULES_FILE, "utf8"));
    }
  } catch (e) {
    console.error("[scheduleStore] Failed to load:", e.message);
  }
  return [];
}

function saveSchedules(schedules) {
  fs.writeFileSync(paths.SCHEDULES_FILE, JSON.stringify(schedules, null, 2));
}

const scheduleStore = {
  getAll() { return loadSchedules(); },
  getById(id) { return loadSchedules().find((s) => s.id === id) || null; },
  create(schedule) {
    const all = loadSchedules();
    all.push(schedule);
    saveSchedules(all);
    return schedule;
  },
  update(id, updates) {
    const all = loadSchedules();
    const idx = all.findIndex((s) => s.id === id);
    if (idx === -1) return null;
    all[idx] = { ...all[idx], ...updates };
    saveSchedules(all);
    return all[idx];
  },
  remove(id) {
    const all = loadSchedules();
    const filtered = all.filter((s) => s.id !== id);
    if (filtered.length === all.length) return false;
    saveSchedules(filtered);
    return true;
  },
};

// ─── Cron engine ───

const activeJobs = {};
const runningProcesses = {};
const runLogs = {};

function getRunLogs(id) {
  // Try in-memory first, then last log file
  if (runLogs[id]) return runLogs[id];
  const logDir = path.join(paths.LOGS_DIR, id);
  if (!fs.existsSync(logDir)) return "";
  const files = fs.readdirSync(logDir).sort().reverse();
  if (files.length === 0) return "";
  return fs.readFileSync(path.join(logDir, files[0]), "utf8");
}

function buildCronExpression(schedule) {
  const [hour, minute] = schedule.time.split(":");
  const dayMap = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
  const dayNums = schedule.days.map((d) => dayMap[d.toLowerCase()]);
  return `${parseInt(minute)} ${parseInt(hour)} * * ${dayNums.join(",")}`;
}

function compileAndRun(schedule, onLog, onDone) {
  // Use bundled secrets if available, fall back to service secrets store
  const allSecrets = schedule.bundledSecrets && Object.keys(schedule.bundledSecrets).length > 0
    ? { ...schedule.bundledSecrets }
    : (() => {
        const s = {};
        secretsStore.listNames().forEach((name) => { s[name] = secretsStore.getSecret(name); });
        return s;
      })();

  const { sequence, parameters = {}, testType = "web" } = schedule.sequencePayload;
  const isDesktop = testType === "desktop";

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
  const seqDir = path.join(paths.TMP_DIR, seqId);
  try {
    fs.mkdirSync(seqDir, { recursive: true });
  } catch (e) {
    onLog(`[ERROR] Failed to create sequence dir: ${e.message}\n`);
    onDone(1);
    return null;
  }

  // Write bundled test code if available
  const bundledCode = schedule.bundledTestCode || {};
  for (const test of sequence) {
    const key = test.builtin || test.name;
    if (bundledCode[key]) {
      if (test.builtin) {
        const builtinPath = path.join(paths.BUILTINS_DIR, test.builtin + ".js");
        if (!fs.existsSync(builtinPath)) {
          fs.writeFileSync(builtinPath, bundledCode[key]);
        }
      } else {
        const testDir = path.join(paths.TESTS_ROOT, test.name);
        const testFile = path.join(testDir, "run.js");
        if (!fs.existsSync(testFile)) {
          fs.mkdirSync(testDir, { recursive: true });
          fs.writeFileSync(testFile, bundledCode[key]);
        }
      }
    }
  }

  const zephyrToken = allSecrets["ZEPHYR_API_TOKEN"] || "";
  const desktopRunnerPath = path.join(paths.RUNNERS_DIR, "desktop-runner.js");
  const zephyrPath = path.join(paths.UTILS_DIR, "zephyr.js");
  const chromeBinary = getChromeBinary();
  const chromeBinaryLine = chromeBinary
    ? `  options.setChromeBinaryPath(${JSON.stringify(chromeBinary)});`
    : `  // Using default Chrome location`;

  const driverSetupCode = isDesktop ? `
  const { createDesktopDriver } = require(${JSON.stringify(desktopRunnerPath)});
  let driver;
  let failedCount = 0;
  let passedCount = 0;
  try {
    driver = createDesktopDriver();
    console.log("Desktop driver ready (PowerShell + Windows APIs)");
` : `
  const remoteUrl = process.env.SELENIUM_REMOTE_URL;
  const options = new chrome.Options();
${chromeBinaryLine}
  options.addArguments("--no-sandbox","--disable-dev-shm-usage");
  options.addArguments("--headless=new","--disable-gpu","--window-size=1920,1080");
  let driver;
  let failedCount = 0;
  let passedCount = 0;
  try {
    driver = remoteUrl
      ? await new Builder().forBrowser("chrome").setChromeOptions(options).usingServer(remoteUrl).build()
      : await new Builder().forBrowser("chrome").setChromeOptions(options).build();
`;

  const driverTeardownCode = isDesktop
    ? `    if (driver && driver.quit) await driver.quit();`
    : `    await driver.quit();`;
  const driverErrorTeardown = isDesktop
    ? `    // Desktop driver has no persistent session`
    : `    if (driver) await driver.quit();`;

  const combinedRunJsContent = `
${isDesktop ? "" : `const { Builder, By, Key, until } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');`}
const { postTestExecution } = require(${JSON.stringify(zephyrPath)});
const stepFns = [
${sequence.map((test) => {
    if (test.builtin) {
      return `  require(${JSON.stringify(path.join(paths.BUILTINS_DIR, test.builtin + ".js"))})`;
    }
    return `  require(${JSON.stringify(path.join(paths.TESTS_ROOT, test.name, "run.js"))})`;
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
${driverSetupCode}
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
        console.log("▶ Running step #" + (i + 1) + " [" + testName + "]");
        await fn(driver, testParams, zephyrLog);
        console.log("✅ Finished step #" + (i + 1) + " [" + testName + "]");
        const hasFailedZephyrStep = zephyrStepResults.some(function(r) { return r.statusName === "Fail"; });
        if (hasFailedZephyrStep) { failedCount++; } else { passedCount++; }
        await sendZephyrResult(zephyrConfig, hasFailedZephyrStep ? "Fail" : "Pass", zephyrStepResults);
      } catch (stepError) {
        failedCount++;
        console.error("❌ Step #" + (i + 1) + " [" + testName + "] failed:", stepError && stepError.stack || stepError);
        zephyrLog("ERROR: " + (stepError && stepError.message || stepError), "Fail");
        await sendZephyrResult(zephyrConfig, "Fail", zephyrStepResults);
      }
    }
${driverTeardownCode}
    console.log("All steps finished. " + passedCount + " passed / " + failedCount + " failed.");
    process.exit(failedCount > 0 ? 1 : 0);
  } catch (err) {
${driverErrorTeardown}
    console.error("Fatal error in scheduled sequence:", err && err.stack || err);
    process.exit(1);
  }
}
main();
`;

  fs.writeFileSync(path.join(seqDir, "run.js"), combinedRunJsContent);

  const childEnv = {
    ...process.env,
    NODE_PATH: SERVER_NODE_MODULES,
    VISUAL_BROWSER: "false",
  };
  if (!isDesktop && process.env.SELENIUM_REMOTE_URL) {
    childEnv.SELENIUM_REMOTE_URL = process.env.SELENIUM_REMOTE_URL;
  }

  const child = spawn("node", ["run.js"], { cwd: seqDir, env: childEnv });

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
    // Clean up temp dir
    try { fs.rmSync(seqDir, { recursive: true, force: true }); } catch {}
  });

  return child;
}

// ─── Notifications ───

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
        headers: { Title: title, Priority: code === 0 ? "default" : "high", Tags: code === 0 ? "white_check_mark" : "x" },
        body,
      });
      console.log(`[notify] ntfy sent to ${schedule.ntfyTopic} (HTTP ${res.status})`);
    } catch (err) {
      console.error(`[notify] ntfy failed:`, err.message);
    }
  }

  // Teams webhook — all results
  if (schedule.teamsWebhookAll) {
    try {
      const emoji = code === 0 ? "✅" : "❌";
      const color = code === 0 ? "00cc00" : "cc0000";
      const payload = {
        "@type": "MessageCard", "@context": "https://schema.org/extensions",
        themeColor: color, summary: `${emoji} ${schedule.name} - ${result}`,
        sections: [{ activityTitle: `${emoji} Scheduled Sequence: ${schedule.name}`,
          facts: [{ name: "Result", value: `**${result}**` }, { name: "Time", value: time }, { name: "Steps", value: stepNames }],
          markdown: true }],
      };
      const res = await fetch(schedule.teamsWebhookAll, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      console.log(`[notify] Teams (all) webhook sent (HTTP ${res.status})`);
    } catch (err) { console.error(`[notify] Teams (all) webhook failed:`, err.message); }
  }

  // Teams webhook — failures only (includes logs)
  if (schedule.teamsWebhookFail && code !== 0) {
    try {
      const logsHtml = (logText || "(no logs)").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
      const payload = {
        "@type": "MessageCard", "@context": "https://schema.org/extensions",
        themeColor: "cc0000", summary: `❌ ${schedule.name} - FAILED`,
        sections: [
          { activityTitle: `❌ Scheduled Sequence: ${schedule.name}`,
            facts: [{ name: "Result", value: "**FAILED**" }, { name: "Time", value: time }, { name: "Steps", value: stepNames }],
            markdown: true },
          { title: "Logs", text: `<pre>${logsHtml}</pre>` },
        ],
      };
      const res = await fetch(schedule.teamsWebhookFail, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      console.log(`[notify] Teams (fail) webhook sent (HTTP ${res.status})`);
    } catch (err) { console.error(`[notify] Teams (fail) webhook failed:`, err.message); }
  }
}

// ─── Scheduler operations ───

function executeSchedule(scheduleId) {
  const schedule = scheduleStore.getById(scheduleId);
  if (!schedule || schedule.status === "stopped") return;
  if (runningProcesses[scheduleId]) {
    console.log(`[scheduler] Schedule ${scheduleId} already running, skipping.`);
    return;
  }

  console.log(`[scheduler] Executing: ${schedule.name} (${scheduleId})`);
  runLogs[scheduleId] = "";

  const child = compileAndRun(
    schedule,
    (text) => { runLogs[scheduleId] = (runLogs[scheduleId] || "") + text; },
    (code) => {
      delete runningProcesses[scheduleId];
      // Persist logs to file
      const logDir = path.join(paths.LOGS_DIR, scheduleId);
      if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
      const logFile = path.join(logDir, new Date().toISOString().replace(/[:.]/g, "-") + ".log");
      fs.writeFileSync(logFile, runLogs[scheduleId] || "");

      scheduleStore.update(scheduleId, {
        lastRun: new Date().toISOString(),
        lastResult: code === 0 ? "passed" : "failed",
      });
      console.log(`[scheduler] ${schedule.name} finished with code ${code}`);
      sendNotifications(schedule, code, runLogs[scheduleId]);
    }
  );

  if (child) runningProcesses[scheduleId] = child;
}

function startJob(schedule) {
  if (activeJobs[schedule.id]) activeJobs[schedule.id].stop();
  const cronExpr = buildCronExpression(schedule);
  console.log(`[scheduler] Starting cron for "${schedule.name}": ${cronExpr}`);
  const job = cron.schedule(cronExpr, () => {
    console.log(`[scheduler] Cron triggered: "${schedule.name}" at ${new Date().toString()}`);
    executeSchedule(schedule.id);
  });
  job.start();
  activeJobs[schedule.id] = job;
}

function stopJob(scheduleId) {
  if (activeJobs[scheduleId]) { activeJobs[scheduleId].stop(); delete activeJobs[scheduleId]; }
  if (runningProcesses[scheduleId]) { runningProcesses[scheduleId].kill(); delete runningProcesses[scheduleId]; }
}

function pauseJob(scheduleId) {
  if (activeJobs[scheduleId]) { activeJobs[scheduleId].stop(); delete activeJobs[scheduleId]; }
}

function isRunning(scheduleId) {
  return !!runningProcesses[scheduleId];
}

function restoreSchedules() {
  const all = scheduleStore.getAll();
  for (const schedule of all) {
    if (schedule.status === "active") startJob(schedule);
  }
  console.log(`[scheduler] Restored ${all.filter((s) => s.status === "active").length} active schedule(s)`);
}

// ─── Helper: strip sensitive data for API responses ───

function safeSchedule(s) {
  return {
    ...s,
    sequencePayload: undefined,
    bundledSecrets: undefined,
    bundledTestCode: undefined,
    isRunning: isRunning(s.id),
    stepNames: s.sequencePayload?.sequence?.map((t) => t.name) || [],
    zephyrSteps: (s.sequencePayload?.sequence || [])
      .filter((t) => t.zephyr)
      .map((t) => ({ name: t.name, ...t.zephyr })),
  };
}

// ─── Express API ───

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", uptime: process.uptime(), schedules: scheduleStore.getAll().length });
});

// List all schedules
app.get("/api/schedules", (req, res) => {
  res.json({ schedules: scheduleStore.getAll().map(safeSchedule) });
});

// Get single schedule
app.get("/api/schedules/:id", (req, res) => {
  const schedule = scheduleStore.getById(req.params.id);
  if (!schedule) return res.status(404).json({ error: "Schedule not found" });
  res.json(safeSchedule(schedule));
});

// Get logs
app.get("/api/schedules/:id/logs", (req, res) => {
  res.json({ logs: getRunLogs(req.params.id) });
});

// Create schedule
app.post("/api/schedules", (req, res) => {
  const { name, sequencePayload, time, days, ntfyTopic, teamsWebhookAll, teamsWebhookFail,
          bundledSecrets: reqSecrets, bundledTestCode: reqCode } = req.body;

  if (!name || !sequencePayload || !time || !days || !Array.isArray(days) || days.length === 0) {
    return res.status(400).json({ error: "Required: name, sequencePayload, time (HH:MM), days (array)" });
  }
  if (!/^\d{2}:\d{2}$/.test(time)) {
    return res.status(400).json({ error: "time must be in HH:MM format" });
  }
  const validDays = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  for (const d of days) {
    if (!validDays.includes(d.toLowerCase())) {
      return res.status(400).json({ error: `Invalid day: ${d}` });
    }
  }

  const schedule = {
    id: uuidv4().slice(0, 8),
    name,
    sequencePayload,
    bundledSecrets: reqSecrets || {},
    bundledTestCode: reqCode || {},
    time,
    days: days.map((d) => d.toLowerCase()),
    ntfyTopic: ntfyTopic || "",
    teamsWebhookAll: teamsWebhookAll || "",
    teamsWebhookFail: teamsWebhookFail || "",
    status: "active",
    createdAt: new Date().toISOString(),
    lastRun: null,
    lastResult: null,
  };

  scheduleStore.create(schedule);
  startJob(schedule);
  res.json(safeSchedule(schedule));
});

// Update schedule
app.patch("/api/schedules/:id", (req, res) => {
  const schedule = scheduleStore.getById(req.params.id);
  if (!schedule) return res.status(404).json({ error: "Schedule not found" });

  const { name, time, days, ntfyTopic, teamsWebhookAll, teamsWebhookFail } = req.body;
  const updates = {};
  if (name) updates.name = name;
  if (ntfyTopic !== undefined) updates.ntfyTopic = ntfyTopic;
  if (teamsWebhookAll !== undefined) updates.teamsWebhookAll = teamsWebhookAll;
  if (teamsWebhookFail !== undefined) updates.teamsWebhookFail = teamsWebhookFail;
  if (time) {
    if (!/^\d{2}:\d{2}$/.test(time)) return res.status(400).json({ error: "time must be in HH:MM format" });
    updates.time = time;
  }
  if (days) {
    const validDays = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
    for (const d of days) {
      if (!validDays.includes(d.toLowerCase())) return res.status(400).json({ error: `Invalid day: ${d}` });
    }
    updates.days = days.map((d) => d.toLowerCase());
  }

  const updated = scheduleStore.update(req.params.id, updates);
  if (updated.status === "active") startJob(updated);
  res.json(safeSchedule(updated));
});

// Run now
app.post("/api/schedules/:id/run", (req, res) => {
  const schedule = scheduleStore.getById(req.params.id);
  if (!schedule) return res.status(404).json({ error: "Schedule not found" });
  if (isRunning(schedule.id)) return res.status(409).json({ error: "Already running" });
  executeSchedule(schedule.id);
  res.json({ message: "Schedule triggered", id: schedule.id });
});

// Pause
app.post("/api/schedules/:id/pause", (req, res) => {
  const schedule = scheduleStore.getById(req.params.id);
  if (!schedule) return res.status(404).json({ error: "Schedule not found" });
  pauseJob(schedule.id);
  const updated = scheduleStore.update(schedule.id, { status: "paused" });
  res.json(safeSchedule(updated));
});

// Resume
app.post("/api/schedules/:id/resume", (req, res) => {
  const schedule = scheduleStore.getById(req.params.id);
  if (!schedule) return res.status(404).json({ error: "Schedule not found" });
  const updated = scheduleStore.update(schedule.id, { status: "active" });
  startJob(updated);
  res.json(safeSchedule(updated));
});

// Stop (kill running process)
app.post("/api/schedules/:id/stop", (req, res) => {
  const schedule = scheduleStore.getById(req.params.id);
  if (!schedule) return res.status(404).json({ error: "Schedule not found" });
  stopJob(schedule.id);
  const updated = scheduleStore.update(schedule.id, { status: "stopped" });
  res.json(safeSchedule(updated));
});

// Delete
app.delete("/api/schedules/:id", (req, res) => {
  stopJob(req.params.id);
  const removed = scheduleStore.remove(req.params.id);
  if (!removed) return res.status(404).json({ error: "Schedule not found" });
  res.json({ message: "Schedule deleted" });
});

// Export
app.post("/api/schedules/:id/export", (req, res) => {
  const { password } = req.body;
  if (!password || password.length < 4) return res.status(400).json({ error: "Password must be at least 4 characters" });
  const schedule = scheduleStore.getById(req.params.id);
  if (!schedule) return res.status(404).json({ error: "Schedule not found" });

  const bundle = {
    version: 1,
    exportedAt: new Date().toISOString(),
    schedule: {
      name: schedule.name, time: schedule.time, days: schedule.days,
      ntfyTopic: schedule.ntfyTopic, teamsWebhookAll: schedule.teamsWebhookAll, teamsWebhookFail: schedule.teamsWebhookFail,
    },
    sequencePayload: schedule.sequencePayload,
    bundledSecrets: schedule.bundledSecrets || {},
    bundledTestCode: schedule.bundledTestCode || {},
  };

  const encrypted = portableEncrypt(bundle, password);
  const safeName = schedule.name.replace(/[^a-zA-Z0-9_-]/g, "_");
  res.set({
    "Content-Type": "application/octet-stream",
    "Content-Disposition": `attachment; filename="${safeName}.utsb"`,
    "Content-Length": encrypted.length,
  });
  res.send(encrypted);
});

// Import
app.post("/api/schedules/import", (req, res) => {
  const { fileData, password } = req.body;
  if (!fileData || !password) return res.status(400).json({ error: "fileData (base64) and password required" });

  let bundle;
  try {
    const buffer = Buffer.from(fileData, "base64");
    bundle = portableDecrypt(buffer, password);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  if (!bundle.version || !bundle.sequencePayload || !bundle.schedule) {
    return res.status(400).json({ error: "Invalid bundle format" });
  }

  // Write bundled test code
  const writtenTests = [];
  if (bundle.bundledTestCode) {
    for (const [name, code] of Object.entries(bundle.bundledTestCode)) {
      if (!code) continue;
      const builtinPath = path.join(paths.BUILTINS_DIR, name + ".js");
      if (fs.existsSync(builtinPath)) continue;
      const testDir = path.join(paths.TESTS_ROOT, name);
      fs.mkdirSync(testDir, { recursive: true });
      fs.writeFileSync(path.join(testDir, "run.js"), code);
      writtenTests.push(name);
    }
  }

  // Merge bundled secrets
  const importedSecrets = [];
  if (bundle.bundledSecrets) {
    for (const [name, value] of Object.entries(bundle.bundledSecrets)) {
      secretsStore.setSecret(name, value);
      importedSecrets.push(name);
    }
  }

  const schedule = {
    id: uuidv4().slice(0, 8),
    name: bundle.schedule.name,
    sequencePayload: bundle.sequencePayload,
    bundledSecrets: bundle.bundledSecrets || {},
    bundledTestCode: bundle.bundledTestCode || {},
    time: bundle.schedule.time,
    days: bundle.schedule.days,
    ntfyTopic: bundle.schedule.ntfyTopic || "",
    teamsWebhookAll: bundle.schedule.teamsWebhookAll || "",
    teamsWebhookFail: bundle.schedule.teamsWebhookFail || "",
    status: "active",
    createdAt: new Date().toISOString(),
    lastRun: null,
    lastResult: null,
  };

  scheduleStore.create(schedule);
  startJob(schedule);

  res.json({
    ...safeSchedule(schedule),
    imported: { secrets: importedSecrets, tests: writtenTests },
  });
});

// ─── Start server ───

restoreSchedules();

app.listen(PORT, () => {
  console.log(`[scheduler-service] Running on http://localhost:${PORT}`);
  console.log(`[scheduler-service] Data directory: ${paths.DATA_DIR}`);
});

// ─── Graceful shutdown ───

function shutdown() {
  console.log("[scheduler-service] Shutting down...");
  for (const id of Object.keys(activeJobs)) {
    activeJobs[id].stop();
  }
  for (const id of Object.keys(runningProcesses)) {
    runningProcesses[id].kill();
  }
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
