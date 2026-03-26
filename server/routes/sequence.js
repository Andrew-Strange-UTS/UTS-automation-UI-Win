// server/routes/sequence.js

const express = require("express");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { v4: uuidv4 } = require("uuid");
const router = express.Router();
const { TESTS_ROOT } = require("../utils/paths");
const { getChromeBinary } = require("../utils/chromeFinder");
const BUILTINS_DIR = path.join(__dirname, "../builtins");

// --- Import secrets handling utilities ---
const secretsStore = require("../secrets");

// Utility: Inject secrets into params
function injectSecretsInParams(obj) {
  if (typeof obj === "string") {
    return obj.replace(/\$\{\{\s*secrets\.([A-Za-z0-9_]+)\s*\}\}/g, (_, n) => {
      // Only inject if the secret exists
      return secretsStore.getSecret(n) ?? "";
    });
  }
  if (Array.isArray(obj)) {
    return obj.map((v) => injectSecretsInParams(v));
  }
  if (obj && typeof obj === "object") {
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [k, injectSecretsInParams(v)])
    );
  }
  return obj;
}

router.post("/run", async (req, res) => {
  const { sequence, parameters = {}, testType = "web" } = req.body;
  if (!Array.isArray(sequence) || sequence.length === 0) {
    res.status(400).json({ error: "No tests in sequence" });
    return;
  }
  try {
    // Get all secrets as a flat object { TESTWORDS: 'hunter2', ... }
    const allSecrets = {};
    secretsStore.listNames().forEach(name => {
      allSecrets[name] = secretsStore.getSecret(name);
    });

    // Validate: if any step has Zephyr config, a ZEPHYR_API_TOKEN secret must exist
    const hasZephyrStep = sequence.some(test => test.zephyr);
    if (hasZephyrStep && !allSecrets["ZEPHYR_API_TOKEN"]) {
      res.status(400).json({
        error: "One or more tests have Zephyr Scale fields configured, but no ZEPHYR_API_TOKEN secret is set. Please add it via the Secrets Manager."
      });
      return;
    }

    // --- Merge secrets as the default parameters for every step/test
    // If your incoming parameters is per-test (by name), do:
    const parametersWithSecrets = {};
    for (const test of sequence) {
      parametersWithSecrets[test.name] = {
        ...(parameters?.[test.name] || {}), // user-supplied params
        ...allSecrets,                      // all available secrets
        ...(test.oktaUrl ? { oktaUrl: test.oktaUrl } : {}), // OKTA URL for built-in login steps
      };
    }
    // If parameters is flat and not per test, just ...spread both at top level


    // --- Regular setup code ---
    // Create a unique sequence folder in TESTS_ROOT
    const seqId = "sequence-" + uuidv4().slice(0, 8);
    const seqDir = path.join(TESTS_ROOT, seqId);
    fs.mkdirSync(seqDir);

    // Compile run.js (with .js test references)
    const zephyrToken = allSecrets["ZEPHYR_API_TOKEN"] || "";
    const isDesktop = testType === "desktop";
    const desktopRunnerPath = path.join(__dirname, "../runners/desktop-runner.js");

    // Driver setup code depends on test type
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
  if (process.env.VISUAL_BROWSER !== "true") {
    options.addArguments("--headless=new","--disable-gpu","--window-size=1920,1080");
  }
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
const { postTestExecution } = require(${JSON.stringify(path.join(__dirname, "../utils/zephyr.js"))});
const stepFns = [
${sequence.map(test => {
  if (test.builtin) {
    return `  require(${JSON.stringify(path.join(BUILTINS_DIR, test.builtin + ".js"))})`;
  }
  return `  require(${JSON.stringify(path.join(TESTS_ROOT, test.name, "run.js"))})`;
}).join(",\n")}
];
const stepNames = [
${sequence.map(test => `  ${JSON.stringify(test.name)}`).join(",\n")}
];
const stepZephyrConfigs = [
${sequence.map(test => `  ${JSON.stringify(test.zephyr || null)}`).join(",\n")}
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
    log("[Zephyr] Reported " + statusName + " for " + zephyrConfig.caseKey + " (HTTP " + result.statusCode + ")");
    log("[Zephyr] Response: " + result.body);
  } catch (err) {
    log("[Zephyr] Failed to report for " + zephyrConfig.caseKey + ": " + (err && err.message || err));
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
console.log('RUNNING IN FOLDER:', ${JSON.stringify(seqDir)});
console.log('TEST TYPE:', ${JSON.stringify(testType)});
console.log('NODE_PATH:', process.env.NODE_PATH);
console.log('Parameters present for steps: ' + stepNames.join(', '));
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
        zephyrStepResults.push({
          statusName: status || "Pass",
          actualResult: String(actualResult),
        });
      };
      try {
        console.log("▶ Running step #" + (i + 1) + " [" + testName + "]");
        await fn(driver, testParams, zephyrLog);
        console.log("✅ Finished step #" + (i + 1) + " [" + testName + "]");
        const hasFailedZephyrStep = zephyrStepResults.some(function(r) { return r.statusName === "Fail"; });
        if (hasFailedZephyrStep) {
          failedCount++;
        } else {
          passedCount++;
        }
        await sendZephyrResult(zephyrConfig, hasFailedZephyrStep ? "Fail" : "Pass", zephyrStepResults);
      } catch (stepError) {
        failedCount++;
        console.error("❌ Step #" + (i + 1) + " [" + testName + "] failed:", stepError && stepError.stack || stepError);
        zephyrLog("ERROR: " + (stepError && stepError.message || stepError), "Fail");
        await sendZephyrResult(zephyrConfig, "Fail", zephyrStepResults);
      }
    }
${driverTeardownCode}
    console.log("All steps finished.");
    console.log("Summary: " + passedCount + " passed / " + failedCount + " failed.");
    process.exit(failedCount > 0 ? 1 : 0);
  } catch (err) {
${driverErrorTeardown}
    console.error("Fatal error in test sequence:", err && err.stack || err);
    process.exit(1);
  }
}
main();
`;

    fs.writeFileSync(path.join(seqDir, "run.js"), combinedRunJsContent);

    // Start streaming to client
    res.set({
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(`[client log] Preparing to run ${seqId}\n`);
    console.log(`[client log] Preparing to run ${seqId}`);
    res.write(`[client log] Waiting 2000ms before running ${seqId}\n`);
    await new Promise((resolve) => setTimeout(resolve, 2000));
    res.write(`[client log] Now running ${seqId}\n`);
    console.log(`[client log] Now running ${seqId}`);
    const childEnv = {
      ...process.env,
      NODE_PATH: process.env.NODE_PATH,
    };
    if (!isDesktop) {
      childEnv.SELENIUM_REMOTE_URL = process.env.SELENIUM_REMOTE_URL || "";
      // Check if any step in the sequence has visualBrowser enabled
      const anyVisual = sequence.some((s) => s.visualBrowser) ||
        Object.values(parameters).some((p) => p && p.visualBrowser);
      childEnv.VISUAL_BROWSER = anyVisual ? "true" : "false";
    }
    const child = spawn("node", ["run.js"], {
      cwd: seqDir,
      env: childEnv,
    });

    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      res.write(chunk);
      process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      res.write(chunk);
      process.stderr.write(chunk);
    });
    child.on("error", (err) => {
      const msg =
        "CHILD PROCESS ERROR: " +
        (err && err.message) +
        "\n[search folder] " +
        seqDir;
      res.write(msg);
      console.error(msg);
      res.end();
    });
    child.on("close", (code, signal) => {
      res.write(
        `\n=== Sequence finished with code ${code}, signal "${signal}" ===\n[search folder] ${seqDir}\n`
      );
      res.end();
    });
    req.on("close", () => {
      child.kill();
      res.write("\n[Client disconnected, killed child process]\n");
      res.end();
    });
  } catch (e) {
    const msg =
      `[FATAL error in compiling sequence test] ${e && e.stack || e}\n[search folder] ${TESTS_ROOT}\n`;
    res.write(msg);
    console.error(msg);
    res.end();
  }
});

module.exports = router;