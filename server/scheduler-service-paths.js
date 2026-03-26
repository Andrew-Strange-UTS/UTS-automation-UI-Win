// server/scheduler-service-paths.js
// Path constants for the standalone scheduler service.
// Uses a system-wide shared directory so all users see the same data.

const path = require("path");
const fs = require("fs");

function getSharedDataDir() {
  if (process.env.UTS_SCHEDULER_DATA_DIR) {
    return process.env.UTS_SCHEDULER_DATA_DIR;
  }
  if (process.platform === "win32") {
    return path.join(process.env.PROGRAMDATA || "C:\\ProgramData", "uts-automation");
  }
  return "/var/lib/uts-automation";
}

const DATA_DIR = getSharedDataDir();

const SCHEDULES_FILE = path.join(DATA_DIR, "schedules.json");
const SECRETS_FILE = path.join(DATA_DIR, "secrets.json.enc");
const SECRETS_KEY_FILE = path.join(DATA_DIR, "secrets_master_key");
const TESTS_ROOT = path.join(DATA_DIR, "repo", "tests");
const BUILTINS_DIR = path.join(DATA_DIR, "builtins");
const RUNNERS_DIR = path.join(DATA_DIR, "runners");
const UTILS_DIR = path.join(DATA_DIR, "utils");
const LOGS_DIR = path.join(DATA_DIR, "logs");
const TMP_DIR = path.join(DATA_DIR, "tmp");

// Ensure all directories exist
for (const dir of [DATA_DIR, TESTS_ROOT, BUILTINS_DIR, RUNNERS_DIR, UTILS_DIR, LOGS_DIR, TMP_DIR]) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

module.exports = {
  DATA_DIR,
  SCHEDULES_FILE,
  SECRETS_FILE,
  SECRETS_KEY_FILE,
  TESTS_ROOT,
  BUILTINS_DIR,
  RUNNERS_DIR,
  UTILS_DIR,
  LOGS_DIR,
  TMP_DIR,
};
