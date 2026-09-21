#!/usr/bin/env node
// scripts/install-service-win.js
// Installs the Marvin Scheduler as a Windows Service using node-windows.
// Run: node scripts/install-service-win.js

const path = require("path");
const { resolveSchedulerScript, nodeModulesFor } = require("../server/utils/serviceScriptPath");

// node-windows is declared in server/package.json, but this script lives in
// scripts/, so a bare require() resolves against the ROOT node_modules and
// misses it. Look in the server's own node_modules too, or a plain
// `npm install` at the root leaves these scripts unable to run at all.
let Service;
try {
  Service = require("node-windows").Service;
} catch {
  try {
    Service = require(path.join(__dirname, "..", "server", "node_modules", "node-windows")).Service;
  } catch {
    console.error(
      "node-windows was not found.\n" +
        "It is a dependency of the server, so install it there:\n" +
        "  cd server && npm install\n"
    );
    process.exit(1);
  }
}

// Point the service at the machine-wide install, not at whatever clone this
// script happens to sit in:
//   node scripts\install-service-win.js --script "C:\Program Files\Marvin\resources\app\server\scheduler-service.js"
// A service registered from a user profile dies with that profile, and the
// automation account cannot read another user's profile at all.
const SCRIPT = resolveSchedulerScript({
  argv: process.argv.slice(2),
  env: process.env,
  fallbackDir: path.resolve(__dirname, "../server"),
});

// node-windows defaults the service's working directory to wherever this script
// was run from, which is normally a clone in somebody's profile. That directory
// is then inherited by anything the service launches, and the automation
// account cannot be in another user's profile: it is what made every
// CreateProcessAsUser call fail with ERROR_INVALID_NAME. It also breaks the
// service outright if that clone is ever deleted. Both spellings are passed
// because the option's casing differs between node-windows versions.
const WORKING_DIR = path.dirname(SCRIPT);

const svc = new Service({
  name: "Marvin Scheduler",
  description: "Runs scheduled test sequences for Marvin. Shared across all users.",
  script: SCRIPT,
  workingDirectory: WORKING_DIR,
  workingdirectory: WORKING_DIR,
  env: [
    { name: "UTS_SCHEDULER_PORT", value: "5050" },
    { name: "NODE_PATH", value: nodeModulesFor(SCRIPT) },
  ],
});

svc.on("install", () => {
  console.log("Service installed. Starting...");
  svc.start();
});

svc.on("start", () => {
  console.log("Marvin Scheduler service is running.");
  console.log("Data directory: C:\\ProgramData\\uts-automation");
  console.log("API: http://localhost:5050/api/health");
});

svc.on("alreadyinstalled", () => {
  console.log("Service is already installed.");
});

svc.on("error", (err) => {
  console.error("Error:", err);
});

console.log(`Installing Marvin Scheduler as a Windows Service...`);
console.log(`Service script: ${SCRIPT}`);
console.log(`Working directory: ${WORKING_DIR}`);
svc.install();
