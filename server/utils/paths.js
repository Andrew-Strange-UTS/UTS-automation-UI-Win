// server/utils/paths.js
// Centralised path resolution for Electron vs Docker environments
const path = require("path");
const fs = require("fs");

// UTS_DATA_DIR is set by Electron's backend-manager to the userData directory
// In Docker, these paths fall back to the Docker volume locations
const DATA_DIR = process.env.UTS_DATA_DIR || path.join(__dirname, "../../data");

// Ensure the data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const SECRETS_FILE = path.join(DATA_DIR, "secrets.json.enc");
const SECRETS_KEY_FILE = path.join(DATA_DIR, "secrets_master_key");
const SCHEDULES_FILE = path.join(DATA_DIR, "schedules.json");
const TESTS_ROOT = path.join(DATA_DIR, "repo", "tests");
const CLONE_TARGET = path.join(DATA_DIR, "repo");

// Ensure test directories exist
if (!fs.existsSync(TESTS_ROOT)) {
  fs.mkdirSync(TESTS_ROOT, { recursive: true });
}

module.exports = {
  DATA_DIR,
  SECRETS_FILE,
  SECRETS_KEY_FILE,
  SCHEDULES_FILE,
  TESTS_ROOT,
  CLONE_TARGET,
};
