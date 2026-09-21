#!/usr/bin/env node
// scripts/uninstall-service-win.js
// Removes the UTS Scheduler Windows Service.
// Run: node scripts/uninstall-service-win.js

const path = require("path");
const { resolveSchedulerScript } = require("../server/utils/serviceScriptPath");

let Service;
try {
  Service = require("node-windows").Service;
} catch {
  console.error("node-windows is not installed. Run:\n  npm install node-windows\n");
  process.exit(1);
}

// node-windows derives the daemon directory from the script path, so an
// uninstall has to name the same path the install used. To remove a service
// registered from an old location, point this at it:
//   node scripts\uninstall-service-win.js --script "C:\Users\someone\UTS-win-automation-UI\server\scheduler-service.js"
const SCRIPT = resolveSchedulerScript({
  argv: process.argv.slice(2),
  env: process.env,
  fallbackDir: path.resolve(__dirname, "../server"),
});

const svc = new Service({
  name: "Marvin Scheduler",
  script: SCRIPT,
});

svc.on("uninstall", () => {
  console.log("Marvin Scheduler service has been removed.");
});

svc.on("error", (err) => {
  console.error("Error:", err);
});

console.log("Uninstalling Marvin Scheduler service...");
console.log(`Service script: ${SCRIPT}`);
svc.uninstall();
