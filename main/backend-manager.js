// main/backend-manager.js — Manages the Express backend as a child process
const { fork } = require("child_process");
const path = require("path");
const fs = require("fs");
const { app } = require("electron");

let backendProcess = null;
let logStream = null;

// Why the backend is unavailable, for the UI to show instead of a bare
// "backend not found". Null once the backend reports ready.
let lastError = null;

function getDataDir() {
  // In production, use Electron's userData directory for writable data
  // In dev, use a local data/ folder in the project
  if (app.isPackaged) {
    return app.getPath("userData");
  }
  return path.join(__dirname, "..", "data");
}

function getLogPath() {
  return path.join(app.getPath("userData"), "logs", "backend.log");
}

function getLastError() {
  return lastError;
}

// The build sets `asar: false`, because the backend spawns plain `node`
// processes to run tests and those cannot read inside an asar archive. If the
// build is ever switched back to asar, prefer the unpacked copy when one
// exists. Resolving to a path that is not there is what silently broke startup
// before, so only rewrite when the target actually exists.
function resolveUnpacked(target) {
  if (!target.includes(`app.asar${path.sep}`)) return target;

  const unpacked = target.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
  if (fs.existsSync(unpacked)) return unpacked;
  return target;
}

function openLog() {
  const logPath = getLogPath();
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    logStream = fs.createWriteStream(logPath, { flags: "a" });
  } catch (err) {
    console.error("[backend] Could not open log file:", err.message);
    logStream = null;
  }
  return logPath;
}

function writeLog(text) {
  if (logStream) {
    try {
      logStream.write(text);
    } catch {
      // A broken log stream must never take the app down.
    }
  }
}

function startBackend(port) {
  return new Promise((resolve) => {
    lastError = null;

    const serverEntry = resolveUnpacked(path.join(__dirname, "..", "server", "index.js"));
    const dataDir = getDataDir();

    // Resolve the server's node_modules so spawned test scripts can find dependencies
    const serverNodeModules = resolveUnpacked(
      path.join(__dirname, "..", "server", "node_modules")
    );

    const logPath = openLog();
    writeLog(
      `\n=== Marvin backend start ${new Date().toISOString()} ===\n` +
        `entry:        ${serverEntry}\n` +
        `dataDir:      ${dataDir}\n` +
        `node_modules: ${serverNodeModules}\n` +
        `port:         ${port}\n`
    );

    // Fail fast with a precise message rather than letting fork throw something
    // opaque. A missing entry point means the packaging is wrong.
    if (!fs.existsSync(serverEntry)) {
      lastError = `Backend entry point not found:\n${serverEntry}`;
      writeLog(`[ERROR] ${lastError}\n`);
      resolve(false);
      return;
    }

    // A missing node_modules produces a bare "Cannot find module 'express'"
    // several frames deep. Name the real problem instead.
    if (!fs.existsSync(serverNodeModules)) {
      lastError =
        `The backend's dependencies are missing:\n${serverNodeModules}\n\n` +
        `The app was packaged without server/node_modules. Rebuild with 'npm run dist'.`;
      writeLog(`[ERROR] ${lastError}\n`);
      resolve(false);
      return;
    }

    let settled = false;
    const settle = (ok) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };

    try {
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
    } catch (err) {
      lastError = `Could not start the backend process: ${err.message}`;
      writeLog(`[ERROR] ${lastError}\n`);
      settle(false);
      return;
    }

    backendProcess.stdout.on("data", (data) => {
      const text = data.toString();
      console.log(`[backend] ${text.trim()}`);
      writeLog(text);
    });

    backendProcess.stderr.on("data", (data) => {
      const text = data.toString();
      console.error(`[backend] ${text.trim()}`);
      writeLog(text);
      // Keep the tail of stderr: if the child dies, this is the useful part.
      lastError = text.trim().split("\n").slice(-15).join("\n");
    });

    backendProcess.on("message", (msg) => {
      if (msg === "ready") {
        console.log(`[backend] Server ready on port ${port}`);
        writeLog(`[ready] listening on port ${port}\n`);
        lastError = null;
        settle(true);
      }
    });

    backendProcess.on("error", (err) => {
      console.error("[backend] Failed to start:", err);
      lastError = `Could not start the backend process: ${err.message}`;
      writeLog(`[ERROR] ${lastError}\n`);
      settle(false);
    });

    backendProcess.on("exit", (code, signal) => {
      console.log(`[backend] Exited with code ${code}`);
      writeLog(`[exit] code=${code} signal=${signal}\n`);
      backendProcess = null;
      // Only an exit *before* the ready message is a startup failure. A later
      // exit is the normal shutdown path.
      if (!settled) {
        const detail = lastError ? `\n\n${lastError}` : "";
        lastError = `The backend exited during startup (code ${code}).${detail}`;
        settle(false);
      }
    });

    // If the backend doesn't send "ready" within 10s, give up waiting. Report it
    // rather than continuing as though startup succeeded.
    setTimeout(() => {
      if (!settled) {
        lastError =
          lastError ||
          "The backend did not report ready within 10 seconds.";
        writeLog(`[ERROR] timed out waiting for ready\n`);
        settle(false);
      }
    }, 10000);
  });
}

function stopBackend() {
  if (backendProcess) {
    backendProcess.kill();
    backendProcess = null;
  }
  if (logStream) {
    try {
      logStream.end();
    } catch {
      // Nothing useful to do if the log stream is already gone.
    }
    logStream = null;
  }
}

module.exports = { startBackend, stopBackend, getLastError, getLogPath };
