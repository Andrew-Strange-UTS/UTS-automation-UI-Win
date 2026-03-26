// server/utils/chromeFinder.js
// Finds a Chrome or Chromium binary on the system.
// Returns the path to the binary, or null if not found.

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

// Cache result since binary location won't change during process lifetime
let cached = undefined;

function getChromeBinary() {
  if (cached === undefined) {
    cached = findChromeBinary();
    if (cached) {
      console.log(`[chromeFinder] Found browser: ${cached}`);
    } else {
      console.warn("[chromeFinder] No Chrome or Chromium binary found");
    }
  }
  return cached;
}

module.exports = { getChromeBinary };
