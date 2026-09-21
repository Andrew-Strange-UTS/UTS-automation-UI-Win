// server/utils/serviceScriptPath.test.js
// Run: node --test server/utils/serviceScriptPath.test.js

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");

const { parseScriptArg, resolveSchedulerScript, nodeModulesFor } = require("./serviceScriptPath");

const FALLBACK = path.join("C:", "checkout", "server");
const INSTALLED = path.join("C:", "Program Files", "Marvin", "resources", "app", "server", "scheduler-service.js");

test("an explicit --script wins, in either spelling", () => {
  assert.strictEqual(parseScriptArg(["--script", INSTALLED]), INSTALLED);
  assert.strictEqual(parseScriptArg([`--script=${INSTALLED}`]), INSTALLED);
  assert.strictEqual(parseScriptArg([]), null);
  assert.strictEqual(parseScriptArg(["--other", "x"]), null);
});

test("the flag beats the environment, and the environment beats the checkout", () => {
  const env = { UTS_SCHEDULER_SCRIPT: path.join("C:", "from-env", "scheduler-service.js") };

  assert.strictEqual(
    resolveSchedulerScript({ argv: ["--script", INSTALLED], env, fallbackDir: FALLBACK }),
    path.resolve(INSTALLED)
  );
  assert.strictEqual(
    resolveSchedulerScript({ argv: [], env, fallbackDir: FALLBACK }),
    path.resolve(env.UTS_SCHEDULER_SCRIPT)
  );
  assert.strictEqual(
    resolveSchedulerScript({ argv: [], env: {}, fallbackDir: FALLBACK }),
    path.resolve(path.join(FALLBACK, "scheduler-service.js"))
  );
});

test("NODE_PATH follows the registered script, never this checkout", () => {
  // The service runs as LocalSystem with the system PATH. Registering the
  // installed app but pointing NODE_PATH at a clone in someone's profile is how
  // a service ends up depending on a directory nobody will keep.
  assert.strictEqual(
    nodeModulesFor(INSTALLED),
    path.join("C:", "Program Files", "Marvin", "resources", "app", "server", "node_modules")
  );
  assert.notStrictEqual(nodeModulesFor(INSTALLED), path.join(FALLBACK, "node_modules"));
});

test("uninstall can name the old path a service was registered with", () => {
  // node-windows derives the daemon directory from the script path, so removing
  // a service installed from a profile needs that profile's path, not ours.
  const old = path.join("C:", "Users", "someone", "UTS-win-automation-UI", "server", "scheduler-service.js");
  assert.strictEqual(
    resolveSchedulerScript({ argv: ["--script", old], env: {}, fallbackDir: FALLBACK }),
    path.resolve(old)
  );
});
