// server/utils/sessionLauncher.test.js
// Run: node --test server/utils/sessionLauncher.test.js
//
// The PowerShell half cannot run here, so everything that decides *what* is run
// and *what a result means* lives in JS where it can be tested. The script
// itself is verified on the VM (EPEA-TBD-13 AC10).

const test = require("node:test");
const assert = require("node:assert");

const {
  Reason,
  buildProbeArgs,
  buildLaunchArgs,
  buildRedirectedCommandLine,
  parseResult,
  describeReason,
  probeSession,
} = require("./sessionLauncher");

const SCRIPT = "C:\\Marvin\\server\\runners\\launch-in-session.ps1";
const USER = "marvin-auto";

// ─── Command building ───

test("the probe runs the script without a profile and without prompting", () => {
  const args = buildProbeArgs({ scriptPath: SCRIPT, user: USER });

  // -NonInteractive matters: this runs from a service, where a prompt would
  // hang the health check forever.
  assert.ok(args.includes("-NoProfile"));
  assert.ok(args.includes("-NonInteractive"));
  assert.deepStrictEqual(args.slice(args.indexOf("-File"), args.indexOf("-File") + 2), ["-File", SCRIPT]);
  assert.deepStrictEqual(args.slice(args.indexOf("-Mode"), args.indexOf("-Mode") + 2), ["-Mode", "probe"]);
  assert.deepStrictEqual(args.slice(args.indexOf("-User"), args.indexOf("-User") + 2), ["-User", USER]);
});

test("a launch carries the command line, working directory and wait flag", () => {
  const args = buildLaunchArgs({
    scriptPath: SCRIPT,
    user: USER,
    commandLine: 'cmd.exe /c "node" "run.js"',
    workingDirectory: "C:\\ProgramData\\uts-automation\\tmp\\scheduled-abc",
    wait: true,
  });

  assert.deepStrictEqual(args.slice(args.indexOf("-Mode"), args.indexOf("-Mode") + 2), ["-Mode", "launch"]);
  assert.ok(args.includes("-Wait"), "the service needs the child's exit code");
  assert.ok(args.includes("C:\\ProgramData\\uts-automation\\tmp\\scheduled-abc"));
  assert.ok(args.includes('cmd.exe /c "node" "run.js"'));
});

test("a launch that is not waited on omits -Wait", () => {
  const args = buildLaunchArgs({ scriptPath: SCRIPT, user: USER, commandLine: "x", wait: false });
  assert.ok(!args.includes("-Wait"));
});

test("the child redirects its own output, because it cannot share our pipes", () => {
  // A process in another session cannot write down the service's stdio, so the
  // run log has to come back through a file.
  const line = buildRedirectedCommandLine({
    exe: "node",
    args: ["run.js"],
    logFile: "C:\\ProgramData\\uts-automation\\tmp\\scheduled-abc\\run.log",
  });

  assert.match(line, /^cmd\.exe \/c /);
  assert.match(line, /"node" "run\.js"/);
  assert.match(line, />\s*"C:\\ProgramData\\uts-automation\\tmp\\scheduled-abc\\run\.log" 2>&1$/);
});

test("paths with spaces stay quoted", () => {
  const line = buildRedirectedCommandLine({
    exe: "C:\\Program Files\\nodejs\\node.exe",
    args: ["run.js"],
    logFile: "C:\\Temp\\my run\\out.log",
  });
  assert.ok(line.includes('"C:\\Program Files\\nodejs\\node.exe"'));
  assert.ok(line.includes('"C:\\Temp\\my run\\out.log"'));
});

// ─── Reading the script's answer ───

test("the result survives PowerShell writing noise before it", () => {
  const stdout = [
    "WARNING: module something loaded",
    "{ not json at all",
    '{"ok":true,"reason":"ok","user":"marvin-auto","sessionId":2,"state":"active"}',
  ].join("\r\n");

  const parsed = parseResult(stdout);
  assert.strictEqual(parsed.reason, "ok");
  assert.strictEqual(parsed.sessionId, 2);
});

test("no readable result is not mistaken for a working session", () => {
  assert.strictEqual(parseResult(""), null);
  assert.strictEqual(parseResult("Add-Type : Cannot compile"), null);
  assert.strictEqual(parseResult('{"unrelated":true}'), null);
});

// ─── Turning a reason into something actionable ───

test("each failure reason gets its own cause and its own fix", () => {
  const reasons = [Reason.NO_SESSION, Reason.LOCKED, Reason.TOKEN_DENIED, Reason.LAUNCH_FAILED, Reason.PROBE_TIMEOUT];
  const described = reasons.map((reason) => describeReason({ reason, user: USER }));

  for (const d of described) {
    assert.ok(d.cause && d.cause.length > 0);
    assert.ok(d.hint && d.hint.length > 0, "a red tick without a fix is not much use");
  }

  const causes = new Set(described.map((d) => d.cause));
  assert.strictEqual(causes.size, reasons.length, "no two failures may read the same");

  const hints = new Set(described.map((d) => d.hint));
  assert.strictEqual(hints.size, reasons.length, "and no two may send you to the same place");
});

test("a locked session names locking as the problem, not the account", () => {
  const { cause, hint } = describeReason({ reason: Reason.LOCKED, user: USER });
  assert.match(cause, /locked/);
  assert.match(hint, /screensaver|lock timeout|inactivity/i);
});

test("a disconnected but working session is reported green, with the screenshot caveat", () => {
  const { cause, hint } = describeReason({ reason: Reason.OK, user: USER, sessionId: 2, state: "disconnected" });
  assert.match(cause, /Session 2/);
  assert.match(hint, /blank|tscon/i, "disconnected sessions render nothing, so captures come back blank");
});

test("a healthy active session carries no warning", () => {
  const { hint } = describeReason({ reason: Reason.OK, user: USER, sessionId: 1, state: "active" });
  assert.strictEqual(hint, undefined);
});

// ─── The probe as the health check sees it ───

test("a usable session reports ok", async () => {
  const result = await probeSession({
    user: USER,
    platform: "win32",
    run: async () => ({ stdout: '{"ok":true,"reason":"ok","user":"marvin-auto","sessionId":1,"state":"active"}' }),
  });

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.sessionId, 1);
});

test("a locked session is not ok, and says why", async () => {
  // The deliberate break: this is the startup tick going red. A session that is
  // logged on but locked cannot receive a keystroke, and used to be invisible
  // until a 3am run failed with a raw "Access is denied".
  const result = await probeSession({
    user: USER,
    platform: "win32",
    run: async () => ({ stdout: '{"ok":false,"reason":"locked","user":"marvin-auto","sessionId":1,"state":"active"}' }),
  });

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, Reason.LOCKED);
  assert.match(result.cause, /locked/);
});

test("a probe that cannot run is a failure, never a pass", async () => {
  const result = await probeSession({
    user: USER,
    platform: "win32",
    run: async () => ({ stdout: "", stderr: "powershell.exe: not found", err: new Error("spawn failed") }),
  });

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, Reason.UNREADABLE);
  assert.match(result.detail, /not found/);
});

test("no configured account is its own cause, not a missing session", async () => {
  const result = await probeSession({ platform: "win32", run: async () => ({ stdout: "" }) });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, Reason.NOT_CONFIGURED);
  assert.match(result.hint, /setup/i);
});

test("a different account being logged on is named as such", async () => {
  // "Nobody is logged on" and "the wrong person is logged on" need different
  // fixes, so the check may not collapse them into one message.
  const result = await probeSession({
    user: USER,
    platform: "win32",
    run: async () => ({
      stdout: '{"ok":false,"reason":"no-session","user":"marvin-auto","others":["020144"]}',
    }),
  });

  assert.strictEqual(result.ok, false);
  assert.match(result.cause, /not logged on \(signed in: 020144\)/);
});

test("off Windows the probe says so instead of pretending", async () => {
  let ran = false;
  const result = await probeSession({
    user: USER,
    platform: "linux",
    run: async () => { ran = true; return { stdout: "" }; },
  });

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, Reason.NOT_WINDOWS);
  assert.strictEqual(ran, false, "nothing is run off Windows");
});
