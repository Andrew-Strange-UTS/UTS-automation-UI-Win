// server/routes/tests.js
const express = require("express");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const router = express.Router();

const TESTS_ROOT = path.join(__dirname, "../../tmp/repo/tests");

router.get("/", (req, res) => {
  if (!fs.existsSync(TESTS_ROOT)) {
    return res.status(404).json({ error: "Tests folder not found." });
  }
  const folders = fs
    .readdirSync(TESTS_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  res.json(folders);
});

router.post("/:name/run", async (req, res) => {
  const testName = req.params.name;
  const repoTestDir = path.join(TESTS_ROOT, testName);
  const builtInTestDir = path.join(__dirname, "../tests", testName);
  
  const testDir = fs.existsSync(repoTestDir) ? repoTestDir :
                  fs.existsSync(builtInTestDir) ? builtInTestDir : null;

  if (!testDir) return res.status(404).json({ error: "Test folder not found" });

  const supportedFiles = [
    { filename: "run.js", cmd: ["node"] },
    { filename: "run.py", cmd: ["python3"] }
  ];

  const selected = supportedFiles.map(opt => ({
    ...opt,
    fullPath: path.join(testDir, opt.filename)
  })).find(opt => fs.existsSync(opt.fullPath));

  if (!selected) {
    return res.status(404).json({ error: "No supported test file found (run.js or run.py)" });
  }

  const manualParams = req.body.parameters || {};
  const injectedParams = Object.fromEntries(
    Object.entries(manualParams).map(([key, val]) => [key.toUpperCase(), String(val)])
  );

  const env = {
    ...process.env,
    VISUAL_BROWSER: req.body.visualBrowser ? "true" : "false",
    OKTA_PROD: req.body.needsOktaProd ? "true" : "false",
    OKTA_TEST: req.body.needsOktaTest ? "true" : "false",
    ...injectedParams
  };

  console.log(`⏩ Starting ${testName} with VISUAL_BROWSER=${env.VISUAL_BROWSER}...`);

  const child = spawn(selected.cmd[0], [...selected.cmd.slice(1), selected.fullPath], {
    cwd: testDir,
    env: env,
  });

  let output = "";

  child.stdout.setEncoding("utf8"); // Optional, ensures data is a string

  // 🔄 Collect + stream logs
  child.stdout.on("data", (data) => {
    const chunk = data.toString();
    process.stdout.write(chunk);  // Immediate flush to logs
    output += chunk;
  });

  child.stderr.on("data", (data) => {
    const chunk = data.toString();
    process.stderr.write(chunk);  // Immediate error flush
    output += chunk;
  });

  child.on("close", (code) => {
    res.json({
      status: code === 0 ? "✅ Passed" : "❌ Failed",
      log: output
    });
  });
});

module.exports = router;