#!/usr/bin/env node
// scripts/uninstall-service-win.js
// Removes the UTS Scheduler Windows Service.
// Run: node scripts/uninstall-service-win.js

const path = require("path");
const { resolveSchedulerScript } = require("../server/utils/serviceScriptPath");

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
