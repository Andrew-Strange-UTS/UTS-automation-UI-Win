// server/utils/automationAccount.test.js
// Run: node --test server/utils/automationAccount.test.js

const test = require("node:test");
const assert = require("node:assert");

const { isValidAccountName, readAccountName } = require("./automationAccount");

const FILE = "C:\\ProgramData\\uts-automation\\automation-account.json";

function fsWith(content) {
  return {
    readFileSync: () => {
      if (content === null) {
        const err = new Error("ENOENT");
        err.code = "ENOENT";
        throw err;
      }
      return content;
    },
  };
}

test("a configured account is read from the file", () => {
  const fs = fsWith(JSON.stringify({ user: "marvin-auto", configuredAt: "2026-09-21T00:00:00Z" }));
  assert.strictEqual(readAccountName(FILE, { fs, env: {} }), "marvin-auto");
});

test("no file, bad JSON or a missing name all mean not configured", () => {
  const env = {};
  assert.strictEqual(readAccountName(FILE, { fs: fsWith(null), env }), null);
  assert.strictEqual(readAccountName(FILE, { fs: fsWith("{ broken"), env }), null);
  assert.strictEqual(readAccountName(FILE, { fs: fsWith("{}"), env }), null);
});

test("a byte-order mark does not hide a perfectly good account", () => {
  // Windows PowerShell 5.1 `Set-Content -Encoding UTF8` writes EF BB BF, which
  // JSON.parse rejects. On the VM that turned a correctly created account into
  // "no automation account is set up", with nothing visibly wrong with the file.
  const fs = fsWith("\uFEFF" + JSON.stringify({ user: "marvin-auto" }));
  assert.strictEqual(readAccountName(FILE, { fs, env: {} }), "marvin-auto");
});

test("the environment overrides the file, but is validated the same way", () => {
  const fs = fsWith(JSON.stringify({ user: "marvin-auto" }));
  assert.strictEqual(readAccountName(FILE, { fs, env: { UTS_AUTOMATION_USER: "other-auto" } }), "other-auto");
  assert.strictEqual(readAccountName(FILE, { fs, env: { UTS_AUTOMATION_USER: "bad name & rm" } }), null);
});

test("an account name that could be injected into a command is refused", () => {
  // The name reaches icacls and a PowerShell command line. A name is not a
  // place to be relaxed about quoting.
  for (const bad of ['a" & calc', "a;b", "a b", "DOMAIN\\user", "a$b", "", "x".repeat(21), null, 42]) {
    assert.strictEqual(isValidAccountName(bad), false, `should refuse: ${String(bad)}`);
  }
  for (const good of ["marvin-auto", "marvin_auto", "Marvin.Auto", "svc-marvin1"]) {
    assert.strictEqual(isValidAccountName(good), true, `should accept: ${good}`);
  }
});

test("a stored credential is never what makes an account usable", () => {
  // The file holds a name and nothing else. If a password ever appears in it,
  // something has gone badly wrong: nothing reads one, and nothing should
  // write one.
  const fs = fsWith(JSON.stringify({ user: "marvin-auto", password: "hunter2" }));
  const name = readAccountName(FILE, { fs, env: {} });
  assert.strictEqual(name, "marvin-auto");
  assert.strictEqual(typeof name, "string", "the name alone is the whole contract");
});
