// main/backend-manager.js — Manages the Express backend as a child process
const { fork } = require("child_process");
const path = require("path");
const { app } = require("electron");

let backendProcess = null;

function getDataDir() {
  // In production, use Electron's userData directory for writable data
  // In dev, use a local data/ folder in the project
  if (app.isPackaged) {
    return app.getPath("userData");
  }
  return path.join(__dirname, "..", "data");
}

function startBackend(port) {
  return new Promise((resolve, reject) => {
    const serverEntry = path.join(__dirname, "..", "server", "index.js");
    const dataDir = getDataDir();

    // Resolve the server's node_modules so spawned test scripts can find dependencies
    const serverNodeModules = path.join(__dirname, "..", "server", "node_modules");

    backendProcess = fork(serverEntry, [], {
      env: {
        ...process.env,
        PORT: String(port),
        UTS_DATA_DIR: dataDir,
        NODE_PATH: serverNodeModules,
        CORS_ORIGIN: "http://localhost:5173",
        // No remote Selenium — tests run locally
        SELENIUM_LOCAL: "true",
      },
      stdio: ["pipe", "pipe", "pipe", "ipc"],
    });

    backendProcess.stdout.on("data", (data) => {
      console.log(`[backend] ${data.toString().trim()}`);
    });

    backendProcess.stderr.on("data", (data) => {
      console.error(`[backend] ${data.toString().trim()}`);
    });

    backendProcess.on("message", (msg) => {
      if (msg === "ready") {
        console.log(`[backend] Server ready on port ${port}`);
        resolve();
      }
    });

    backendProcess.on("error", (err) => {
      console.error("[backend] Failed to start:", err);
      reject(err);
    });

    backendProcess.on("exit", (code) => {
      console.log(`[backend] Exited with code ${code}`);
      backendProcess = null;
    });

    // If the backend doesn't send "ready" within 10s, resolve anyway
    setTimeout(() => resolve(), 10000);
  });
}

function stopBackend() {
  if (backendProcess) {
    backendProcess.kill();
    backendProcess = null;
  }
}

module.exports = { startBackend, stopBackend };
