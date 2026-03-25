// server/routes/stream.js
const express = require("express");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

const router = express.Router();

router.get("/:name", async (req, res) => {
  const testName = req.params.name;
  const repoTestDir = path.join(__dirname, "../../tmp/repo/tests", testName);
  const builtInTestDir = path.join(__dirname, "../tests", testName);

  let testDir = null;
  let jsPath = null;

  if (fs.existsSync(path.join(repoTestDir, "run.js"))) {
    testDir = repoTestDir;
    jsPath = path.join(repoTestDir, "run.js");
  } else if (fs.existsSync(path.join(builtInTestDir, "run.js"))) {
    testDir = builtInTestDir;
    jsPath = path.join(builtInTestDir, "run.js");
  }

  if (!jsPath || !fs.existsSync(jsPath)) {
    console.error(`❌ run.js not found for '${testName}'`);
    return res.status(404).send("Test script not found");
  }

  console.log(`✅ Using test directory: ${testDir}`);
  console.log(`🚀 Running: node run.js`);

  // Setup SSE headers
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.flushHeaders();
  res.write("event: message\ndata: 🚀 Stream opened\n\n");

  // Set environment
  const env = {
    ...process.env,
    NODE_OPTIONS: "--trace-warnings",
    FORCE_COLOR: "1",
    VISUAL_BROWSER: "true",
  };

  // Run test
  const child = spawn("node", ["run.js"], {
    cwd: testDir,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const sendLine = (line) => {
    const sanitized = line.toString().replace(/\n/g, "⏎");
    res.write(`data: ${sanitized}\n\n`);
    res.flush?.();
  };

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    console.log("⏺️ STDOUT:", chunk);
    chunk.split(/\r?\n/).forEach((line) => {
      if (line.trim()) sendLine(line);
    });
  });

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (data) => {
    console.log("⏺️ STDERR:", data);
    data.split(/\r?\n/).forEach((line) => {
      if (line.trim()) sendLine("[stderr] " + line);
    });
  });

  child.on("close", (code) => {
    sendLine(`✅ Test finished with code ${code}`);
    res.write("event: close\ndata: done\n\n");
    res.end();
  });

  req.on("close", () => {
    console.warn(`🔌 Client closed stream for ${testName}`);
    child.kill();
  });
});

module.exports = router;