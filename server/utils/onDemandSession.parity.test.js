// Cross-file invariants for on-demand sessions (EPEA-TBD-17, EPEA-TBD-18).
//
// The setup script, the PowerShell launcher and the JS that reads its answers
// are three files that have to agree, and none of them can run here. These
// read the files and check the seams: a renamed secret or a new reason code
// that the JS does not know about would otherwise only show up on the VM.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { Reason } = require("./sessionLauncher");

const root = path.join(__dirname, "..", "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const launcher = read("server/runners/launch-in-session.ps1");
const setup = read("scripts/setup-automation-account.ps1");

const secretIn = (text) => {
  const m = text.match(/\$SecretName\s*=\s*'([^']+)'/);
  return m && m[1];
};

test("EPEA-TBD-17 AC3: the setup script stores the password under the name the launcher reads", () => {
  assert.ok(secretIn(setup), "setup script names a secret");
  assert.equal(secretIn(launcher), secretIn(setup));
  assert.match(secretIn(setup), /^L\$/, "a local secret: never replicated, SYSTEM only");
});

test("EPEA-TBD-17 AC2: the setup script never turns autologon on", () => {
  assert.doesNotMatch(setup, /AutoAdminLogon"\s*-Value\s*"1"/);
  assert.match(setup, /AutoAdminLogon"\s*-Value\s*"0"/);
  assert.match(setup, /Set-LsaSecret -KeyName "DefaultPassword" -Value \$null/, "the old autologon password is deleted");
});

test("EPEA-TBD-17 AC3: the password is never printed or written to a file by the setup script", () => {
  for (const line of setup.split(/\r?\n/)) {
    if (/\$password\b/.test(line)) {
      assert.doesNotMatch(line, /Write-(Host|Output)|Out-File|Set-Content|Add-Content|WriteAllText/, line.trim());
    }
  }
});

test("EPEA-TBD-18 AC3: the keep-alive is gone: no task registered, no script shipped", () => {
  assert.doesNotMatch(setup, /Register-ScheduledTask/);
  assert.equal(fs.existsSync(path.join(root, "server/runners/keep-session-awake.ps1")), false);
});

test("EPEA-TBD-18 AC4: every reason the launcher can report is one the JS knows how to describe", () => {
  const emitted = new Set([...launcher.matchAll(/Write-Result\s+"([a-z-]+)"/g)].map((m) => m[1]));
  // config builds its reason in a variable, so collect the literals from
  // that one assignment too (and only that one: other ifs hold state names).
  const from = launcher.indexOf("$reason = if ($facts.autologon)");
  assert.ok(from > 0, "config mode's reason assignment is where this test expects it");
  const block = launcher.slice(from, launcher.indexOf("Write-Result $reason", from));
  for (const m of block.matchAll(/\{\s*"([a-z-]+)"\s*\}/g)) emitted.add(m[1]);
  emitted.delete("diagnose");
  const known = new Set(Object.values(Reason));
  const unknown = [...emitted].filter((r) => !known.has(r));
  assert.deepEqual(unknown, [], `reasons the launcher emits but the JS does not know: ${unknown.join(", ")}`);
  for (const r of ["autologon-on", "rdp-denied", "no-credential", "session-timeout", "console-session", "logoff-failed"]) {
    assert.ok(emitted.has(r), `the launcher can report ${r}`);
  }
});

test("EPEA-TBD-17 AC10: the launcher refuses a session that is the console's", () => {
  assert.match(launcher, /WTSGetActiveConsoleSessionId/);
  assert.match(launcher, /Write-Result "console-session"/);
});

test("EPEA-TBD-17 AC3: the launcher hands the password to mstsc as a DPAPI blob, never on a command line", () => {
  const start = launcher.slice(launcher.indexOf('if ($Mode -eq "start")'), launcher.indexOf('if ($Mode -eq "logoff")'));
  assert.match(start, /password 51:b:\$blob/);
  assert.match(start, /ConvertFrom-SecureString \$secure/);
  const startProcess = start.split(/\r?\n/).find((l) => /Start-Process/.test(l));
  assert.ok(startProcess, "mstsc is started");
  assert.doesNotMatch(startProcess, /password|\$blob/i);
});
