// server/utils/chromeFinder.js
// Finds a Chrome or Chromium binary on the system.
// Returns the path to the binary, or null if not found.
// IMPORTANT: Never launches Chrome — only checks file existence and PATH.

const { execFileSync } = require("child_process");
const fs = require("fs");

const WINDOWS_PATHS = [
  process.env["PROGRAMFILES"] + "\\Google\\Chrome\\Application\\chrome.exe",
  process.env["PROGRAMFILES(X86)"] + "\\Google\\Chrome\\Application\\chrome.exe",
  process.env["LOCALAPPDATA"] + "\\Google\\Chrome\\Application\\chrome.exe",
  process.env["PROGRAMFILES"] + "\\Chromium\\Application\\chrome.exe",
  process.env["PROGRAMFILES(X86)"] + "\\Chromium\\Application\\chrome.exe",
  process.env["LOCALAPPDATA"] + "\\Chromium\\Application\\chrome.exe",
];

const LINUX_COMMANDS = [
  "google-chrome",
  "google-chrome-stable",
  "chromium-browser",
  "chromium",
];

const MAC_PATHS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
];

function findChromeBinary() {
  const platform = process.platform;

  if (platform === "win32") {
    for (const p of WINDOWS_PATHS) {
      if (p && fs.existsSync(p)) return p;
    }
    return null;
  }

  if (platform === "darwin") {
    for (const p of MAC_PATHS) {
      if (fs.existsSync(p)) return p;
    }
  }

  // Linux (and macOS fallback to PATH)
  for (const cmd of LINUX_COMMANDS) {
    try {
      const result = execFileSync("which", [cmd], { timeout: 3000 }).toString().trim();
      if (result) return result;
    } catch {}
  }

  return null;
}

// Get Chrome version WITHOUT launching the browser.
// On Windows: read version from the directory name next to chrome.exe
// On Linux: run `chrome --version` (safe on Linux, doesn't open a window)
function getChromeVersion(binaryPath) {
  if (!binaryPath) return null;

  if (process.platform === "win32") {
    // Chrome on Windows stores version in a subfolder like:
    // C:\Program Files\Google\Chrome\Application\126.0.6478.127\
    try {
      const dir = require("path").dirname(binaryPath);
      const entries = fs.readdirSync(dir);
      for (const entry of entries) {
        if (/^\d+\.\d+\.\d+\.\d+$/.test(entry)) {
          return entry;
        }
      }
    } catch {}
    return "installed";
  }

  // Linux / macOS: --version is safe (outputs text, doesn't open a window)
  try {
    const output = execFileSync(binaryPath, ["--version"], {
      timeout: 5000,
      env: { ...process.env, DISPLAY: "" }, // prevent any GUI on Linux
    }).toString().trim();
    const m = output.match(/([\d.]+)/);
    return m ? m[1] : output;
  } catch {
    return "installed";
  }
}

// Cache results since binary location won't change during process lifetime
let cachedBinary = undefined;
let cachedVersion = undefined;

function getChromeBinary() {
  if (cachedBinary === undefined) {
    cachedBinary = findChromeBinary();
    if (cachedBinary) {
      console.log(`[chromeFinder] Found browser: ${cachedBinary}`);
    } else {
      console.warn("[chromeFinder] No Chrome or Chromium binary found");
    }
  }
  return cachedBinary;
}

function getChromeVersionCached() {
  if (cachedVersion === undefined) {
    cachedVersion = getChromeVersion(getChromeBinary()) || null;
  }
  return cachedVersion;
}

module.exports = { getChromeBinary, getChromeVersion: getChromeVersionCached };
