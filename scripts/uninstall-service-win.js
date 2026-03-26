#!/usr/bin/env node
// scripts/uninstall-service-win.js
// Removes the UTS Scheduler Windows Service.
// Run: node scripts/uninstall-service-win.js

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
  script: path.resolve(__dirname, "../server/scheduler-service.js"),
});

svc.on("uninstall", () => {
  console.log("UTS Automation Scheduler service has been removed.");
});

svc.on("error", (err) => {
  console.error("Error:", err);
});

console.log("Uninstalling UTS Automation Scheduler service...");
svc.uninstall();
