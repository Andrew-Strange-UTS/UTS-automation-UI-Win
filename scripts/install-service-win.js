#!/usr/bin/env node
// scripts/install-service-win.js
// Installs the Marvin Scheduler as a Windows Service using node-windows.
// Run: node scripts/install-service-win.js

const path = require("path");
const { resolveSchedulerScript, nodeModulesFor } = require("../server/utils/serviceScriptPath");

let Service;
try {
  Service = require("node-windows").Service;
} catch {
  console.error("node-windows is not installed. Run:\n  npm install node-windows\n");
  process.exit(1);
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

const svc = new Service({
  name: "Marvin Scheduler",
  description: "Runs scheduled test sequences for Marvin. Shared across all users.",
  script: SCRIPT,
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
svc.install();
