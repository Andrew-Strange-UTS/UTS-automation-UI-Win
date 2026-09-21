// server/utils/serviceScriptPath.js
// Which copy of scheduler-service.js the Windows service is registered against.
//
// This used to be implicit: the install script registered `../server/
// scheduler-service.js` relative to itself, so running it from a clone in
// someone's profile registered that clone. The service then ran from
// C:\Users\<someone>\... , which means it stops working if that profile is
// removed, it is invisible to anyone else maintaining the machine, and the
// automation account (which has no access to another user's profile) cannot
// read anything it needs.
//
// The service should run from the machine-wide install. Uninstalling, though,
// has to name the *same* path it was installed with, because node-windows
// derives the daemon directory from it, which is why this is explicit and
// overridable rather than clever.

const path = require("path");

function parseScriptArg(argv = []) {
  const flag = argv.indexOf("--script");
  if (flag !== -1 && argv[flag + 1]) return argv[flag + 1];

  const inline = argv.find((a) => a.startsWith("--script="));
  return inline ? inline.slice("--script=".length) : null;
}

// Precedence: an explicit flag, then the environment, then the copy of the
// server next to this checkout.
function resolveSchedulerScript({ argv = [], env = {}, fallbackDir } = {}) {
  const chosen = parseScriptArg(argv) || env.UTS_SCHEDULER_SCRIPT || null;
  if (chosen) return path.resolve(chosen);
  return path.resolve(fallbackDir, "scheduler-service.js");
}

// The service runs as LocalSystem with the system PATH, so it cannot rely on a
// user's NODE_PATH. It is always the node_modules beside the script that gets
// registered, never this checkout's.
function nodeModulesFor(scriptPath) {
  return path.join(path.dirname(scriptPath), "node_modules");
}

module.exports = { parseScriptArg, resolveSchedulerScript, nodeModulesFor };
