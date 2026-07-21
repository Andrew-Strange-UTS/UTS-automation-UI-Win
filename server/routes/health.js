// server/routes/health.js
// Startup diagnostics endpoint — checks all dependencies and services.

const express = require("express");
const { execFile, exec } = require("child_process");
const os = require("os");
const path = require("path");
const { getChromeBinary, getChromeVersion, isSnapChromium } = require("../utils/chromeFinder");
const schedulerService = require("../utils/schedulerService");
const router = express.Router();

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
  if (!checks.git.ok) {
    checks.git.hint = isWindows
      ? "Install Git for Windows, then restart Marvin."
      : "Install Git via your package manager (e.g. sudo apt install git).";
    checks.git.helpUrl = "https://git-scm.com/downloads";
  }

  // --- Chrome / Chromium (never launches the browser) ---
  const chromeBinary = getChromeBinary();
  if (chromeBinary) {
    const version = getChromeVersion();
    checks.chrome = {
      ok: true,
      version: version || "installed",
      binary: chromeBinary,
    };
    if (isSnapChromium(chromeBinary)) {
      checks.chrome.warn = true;
      checks.chrome.hint =
        "Snap-packaged Chromium detected. Snap confinement can break Selenium (sandbox / temp-profile errors). If web tests fail, install Google Chrome (.deb) or a non-snap Chromium.";
      checks.chrome.helpUrl = "https://www.google.com/chrome/";
    }
  } else {
    checks.chrome = {
      ok: false,
      detail: "Chrome/Chromium not found",
      hint: "Install Google Chrome (or Chromium) to run web tests.",
      helpUrl: "https://www.google.com/chrome/",
    };
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
      checks.chromedriver.hint = "Install ChromeDriver matching your Chrome version, or reinstall dependencies so selenium-webdriver can auto-download it.";
      checks.chromedriver.helpUrl = "https://developer.chrome.com/docs/chromedriver/downloads";
    }
  }

  // --- PowerShell (Windows desktop automation) ---
  if (isWindows) {
    checks.powershell = await checkCommand("powershell", ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"], (out) => out);
    if (!checks.powershell.ok) {
      checks.powershell.hint = "PowerShell ships with Windows. Repair Windows or install PowerShell 7 to enable desktop tests.";
      checks.powershell.helpUrl = "https://learn.microsoft.com/powershell/scripting/install/installing-powershell-on-windows";
    }
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
  // Probes, and if the service is down tries to start it before reporting a
  // failure, so users are not sent to a command line for a recoverable state.
  checks.scheduler = await schedulerService.checkWithRecovery();

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
