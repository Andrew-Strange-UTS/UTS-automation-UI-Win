// server/ws.js
const { spawn } = require("child_process");
const { WebSocketServer } = require("ws");
const path = require("path");
const fs = require("fs");

function setupWebSocket(server) {
  const wss = new WebSocketServer({ server });

  wss.on("connection", (ws) => {
    ws.on("message", async (msg) => {
      const { type, test } = JSON.parse(msg.toString() || "{}");
      if (type !== "RUN") return;

      const testDir = path.join(__dirname, "../tmp/repo/tests", test);
      const scriptPath = fs.existsSync(path.join(testDir, "run.js"))
        ? "run.js"
        : fs.existsSync(path.join(testDir, "run.py"))
        ? "run.py"
        : null;

      if (!scriptPath) {
        ws.send(JSON.stringify({ type: "log", message: `❌ No test script found in ${testDir}` }));
        return;
      }

      const runner = scriptPath.endsWith(".py") ? "python3" : "node";
      const fullPath = path.join(testDir, scriptPath);
      const env = {
        ...process.env,
        VISUAL_BROWSER: "true",
      };

      ws.send(JSON.stringify({ type: "log", message: `🚀 Starting ${test} [${runner}]` }));

      const child = spawn(runner, [fullPath], {
        cwd: testDir,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");

      child.stdout.on("data", (chunk) => {
        const lines = chunk.toString().split(/\r?\n/);
        for (const line of lines) {
          if (line.trim() !== "") {
            ws.send(JSON.stringify({ type: "log", message: line }));
          }
        }
      });

      child.stderr.on("data", (chunk) => {
        const lines = chunk.toString().split(/\r?\n/);
        for (const line of lines) {
          if (line.trim() !== "") {
            ws.send(JSON.stringify({ type: "log", message: `[stderr] ${line}` }));
          }
        }
      });

      child.on("close", (code) => {
        ws.send(
          JSON.stringify({
            type: "done",
            status: code === 0 ? "✅ Passed" : `❌ Failed (code ${code})`,
          })
        );
        ws.close(); // close WS after test run
      });

      ws.on("close", () => {
        child.kill();
      });
    });
  });
}

module.exports = { setupWebSocket };