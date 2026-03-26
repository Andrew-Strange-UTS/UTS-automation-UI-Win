// server/routes/health.js
// Startup diagnostics endpoint — checks all dependencies and services.

const express = require("express");
const { execFile, exec } = require("child_process");
const os = require("os");
const path = require("path");
const { getChromeBinary } = require("../utils/chromeFinder");
const router = express.Router();

const SCHEDULER_URL = process.env.UTS_SCHEDULER_URL || "http://localhost:5050";

// Run a command and resolve with { ok, version/detail }
function checkCommand(cmd, args, parseVersion) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 5000 }, (err, stdout, stderr) => {
      if (err) return resolve({ ok: false, detail: err.message });
      const output = (stdout || stderr || "").trim();
      const version = parseVersion ? parseVersion(output) : output;
      resolve({ ok: true, version });
    });
  });
}

// Shell-based check (for commands that need shell resolution)
function checkShell(command, parseVersion) {
  return new Promise((resolve) => {
    exec(command, { timeout: 5000 }, (err, stdout, stderr) => {
      if (err) return resolve({ ok: false, detail: err.message });
      const output = (stdout || stderr || "").trim();
      const version = parseVersion ? parseVersion(output) : output;
      resolve({ ok: true, version });
    });
  });
}

router.get("/", async (req, res) => {
  const platform = os.platform(); // "win32", "linux", "darwin"
  const isWindows = platform === "win32";
  const checks = {};

  // --- Node.js ---
  checks.node = { ok: true, version: process.version };

  // --- OS ---
  checks.os = {
    ok: true,
    platform,
    version: os.release(),
    detail: isWindows ? "Windows" : platform === "darwin" ? "macOS" : "Linux",
  };

  // --- Git ---
  checks.git = await checkCommand("git", ["--version"], (out) => {
    const m = out.match(/git version ([\d.]+)/);
    return m ? m[1] : out;
  });

  // --- Chrome / Chromium ---
  const chromeBinary = getChromeBinary();
  if (chromeBinary) {
    // Get version from the detected binary
    const versionResult = await checkCommand(chromeBinary, ["--version"], (out) => {
      const m = out.match(/([\d.]+)/);
      return m ? m[1] : out;
    });
    checks.chrome = {
      ok: true,
      version: versionResult.ok ? versionResult.version : "installed",
      binary: chromeBinary,
    };
  } else {
    checks.chrome = { ok: false, detail: "Chrome/Chromium not found" };
  }

  // --- ChromeDriver ---
  checks.chromedriver = await checkCommand("chromedriver", ["--version"], (out) => {
    const m = out.match(/ChromeDriver ([\d.]+)/);
    return m ? m[1] : out;
  });
  // If system chromedriver not found, check if selenium-webdriver can auto-manage it
  if (!checks.chromedriver.ok) {
    try {
      const seleniumPath = require.resolve("selenium-webdriver");
      checks.chromedriver = {
        ok: true,
        version: "auto-managed by selenium-webdriver",
        detail: "System chromedriver not found, but selenium-webdriver will download it automatically",
      };
    } catch {
      checks.chromedriver.detail = "Not found. Install chromedriver or ensure selenium-webdriver can auto-download it.";
    }
  }

  // --- PowerShell (Windows desktop automation) ---
  if (isWindows) {
    checks.powershell = await checkCommand("powershell", ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"], (out) => out);
  } else {
    // Check if pwsh is available on Linux (optional)
    const pwshResult = await checkCommand("pwsh", ["--version"], (out) => {
      const m = out.match(/PowerShell ([\d.]+)/);
      return m ? m[1] : out;
    });
    checks.powershell = {
      ok: false,
      available: pwshResult.ok,
      detail: isWindows
        ? "PowerShell not found"
        : "Desktop automation requires Windows + PowerShell. Not available on this OS.",
    };
  }

  // --- Scheduler Service ---
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const healthRes = await fetch(`${SCHEDULER_URL}/api/health`, { signal: controller.signal });
    clearTimeout(timeout);
    if (healthRes.ok) {
      const data = await healthRes.json();
      checks.scheduler = {
        ok: true,
        version: `uptime ${Math.floor(data.uptime)}s`,
        detail: `${data.schedules} schedule(s) loaded`,
      };
    } else {
      checks.scheduler = { ok: false, detail: `Service returned HTTP ${healthRes.status}` };
    }
  } catch (err) {
    checks.scheduler = { ok: false, detail: "Service not running on " + SCHEDULER_URL };
  }

  // --- Summary: what features are available ---
  const features = {
    webTests: checks.chrome.ok,
    desktopTests: isWindows && checks.powershell.ok,
    scheduling: checks.scheduler.ok,
    gitClone: checks.git.ok,
    zephyrReporting: true, // Always available if secrets are configured
  };

  res.json({ checks, features, platform });
});

module.exports = router;
