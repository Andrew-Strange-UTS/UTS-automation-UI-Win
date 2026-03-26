#!/usr/bin/env node
// scripts/install-service-win.js
// Installs the UTS Scheduler as a Windows Service using node-windows.
// Run: node scripts/install-service-win.js

const path = require("path");

let Service;
try {
  Service = require("node-windows").Service;
} catch {
  console.error("node-windows is not installed. Run:\n  npm install node-windows\n");
  process.exit(1);
}

const svc = new Service({
  name: "UTS Automation Scheduler",
  description: "Runs scheduled test sequences for UTS Automation UI. Shared across all users.",
  script: path.resolve(__dirname, "../server/scheduler-service.js"),
  env: [
    { name: "UTS_SCHEDULER_PORT", value: "5050" },
    { name: "NODE_PATH", value: path.resolve(__dirname, "../server/node_modules") },
  ],
});

svc.on("install", () => {
  console.log("Service installed. Starting...");
  svc.start();
});

svc.on("start", () => {
  console.log("UTS Automation Scheduler service is running.");
  console.log("Data directory: C:\\ProgramData\\uts-automation");
  console.log("API: http://localhost:5050/api/health");
});

svc.on("alreadyinstalled", () => {
  console.log("Service is already installed.");
});

svc.on("error", (err) => {
  console.error("Error:", err);
});

console.log("Installing UTS Automation Scheduler as a Windows Service...");
svc.install();
