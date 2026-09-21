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
  KEEP_AWAKE_STALE_SECONDS,
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

test("a healthy active session with the keep-alive running carries no warning", () => {
  const { hint } = describeReason({
    reason: Reason.OK, user: USER, sessionId: 1, state: "active", keepAwakeAgeSeconds: 12,
  });
  assert.strictEqual(hint, undefined);
});

test("a session with nothing keeping it awake is flagged while it still works", () => {
  // A session that is fine right now can be minutes from locking, and a locked
  // session cannot be unlocked: the password is discarded at setup by design.
  // Saying so only once it has locked is too late to be useful.
  const { cause, hint } = describeReason({
    reason: Reason.OK, user: USER, sessionId: 1, state: "active",
  });

  assert.match(cause, /Session 1/, "it is still reported as a working session");
  assert.match(hint, /nothing is keeping it awake/);
  assert.match(hint, /inactivity limit/);
});

test("a keep-alive that has stopped reporting is flagged, with how long ago", () => {
  const { hint } = describeReason({
    reason: Reason.OK, user: USER, sessionId: 1, state: "active", keepAwakeAgeSeconds: 3600,
  });

  assert.match(hint, /3600s ago/);
  assert.match(hint, /stopped/);
});

test("a fresh heartbeat just under the threshold is not flagged", () => {
  const { hint } = describeReason({
    reason: Reason.OK, user: USER, sessionId: 1, state: "active",
    keepAwakeAgeSeconds: KEEP_AWAKE_STALE_SECONDS - 1,
  });
  assert.strictEqual(hint, undefined);
});

test("a disconnected session reports that first, since captures come back blank either way", () => {
  const { hint } = describeReason({
    reason: Reason.OK, user: USER, sessionId: 2, state: "disconnected", keepAwakeAgeSeconds: 5,
  });
  assert.match(hint, /disconnected/);
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

// ─── A run driven through the session, as the scheduler sees it ───

const { EventEmitter } = require("events");
const { PassThrough } = require("stream");
const { startRunInSession, buildRunScript, parseStartedPid } = require("./sessionLauncher");

function fakePowerShell() {
  const ps = new EventEmitter();
  ps.stdout = new PassThrough();
  ps.stderr = new PassThrough();
  ps.kill = () => { ps.killed = true; };
  return ps;
}

// A log file that grows, like the child's redirected output does.
function fakeFs(initial = "") {
  let content = initial;
  const written = {};
  return {
    append: (text) => { content += text; },
    written,
    writeFileSync: (file, data) => { written[file] = data; },
    statSync: () => ({ size: Buffer.byteLength(content) }),
    openSync: () => 1,
    closeSync: () => {},
    readSync: (fd, buffer, off, length, position) => {
      Buffer.from(content).copy(buffer, 0, position, position + length);
      return length;
    },
  };
}

test("a run in the session streams the child's log back as stdout", async () => {
  const files = fakeFs();
  const ps = fakePowerShell();
  const run = startRunInSession({
    user: USER,
    seqDir: "C:\\runs\\abc",
    env: { NODE_PATH: "C:\\Marvin\\server\\node_modules" },
    spawnFn: () => ps,
    fsImpl: files,
    pollMs: 5,
  });

  let received = "";
  run.stdout.on("data", (c) => { received += c.toString(); });

  files.append("Running step #1\n");
  ps.stdout.write('{"reason":"started","pid":4242,"sessionId":1}\r\n');

  const code = await new Promise((resolve) => {
    setTimeout(() => {
      files.append("All steps finished. 1 passed / 0 failed.\n");
      ps.stdout.write('{"ok":true,"reason":"ok","pid":4242,"exitCode":0}\r\n');
      ps.emit("close", 0);
    }, 20);
    run.on("close", resolve);
  });

  assert.strictEqual(code, 0);
  assert.match(received, /Running step #1/);
  assert.match(received, /All steps finished/, "output after the last poll is still flushed on close");
  assert.strictEqual(run.pid, 4242, "the child's id is captured for Stop");
});

test("the run script carries the environment the user profile would not have", () => {
  const files = fakeFs();
  const ps = fakePowerShell();
  startRunInSession({
    user: USER,
    seqDir: "C:\\runs\\abc",
    env: { NODE_PATH: "C:\\Marvin\\server\\node_modules", SELENIUM_LOCAL: "true" },
    spawnFn: () => ps,
    fsImpl: files,
  });
  ps.emit("close", 0);

  const cmd = files.written["C:\\runs\\abc\\run.cmd"] || files.written[Object.keys(files.written)[0]];
  assert.match(cmd, /set "NODE_PATH=C:\\Marvin\\server\\node_modules"/);
  assert.match(cmd, /set "SELENIUM_LOCAL=true"/);
  assert.match(cmd, /exit \/b %ERRORLEVEL%/, "the exit code has to survive the wrapper");
});

test("a session that cannot run the job fails the run and says why", async () => {
  // Not a test failure: the machine could not run the test. Those read very
  // differently at 3am, so the run log has to say which one it was.
  const files = fakeFs();
  const ps = fakePowerShell();
  const run = startRunInSession({
    user: USER,
    seqDir: "C:\\runs\\abc",
    spawnFn: () => ps,
    fsImpl: files,
    pollMs: 5,
  });

  let errText = "";
  run.stderr.on("data", (c) => { errText += c.toString(); });

  const code = await new Promise((resolve) => {
    run.on("close", resolve);
    ps.stdout.write('{"ok":false,"reason":"locked","user":"marvin-auto","sessionId":1}\r\n');
    ps.emit("close", 1);
  });

  assert.strictEqual(code, 1);
  assert.match(errText, /Could not run in marvin-auto's session/);
  assert.match(errText, /locked/);
});

test("stopping a run kills the process in the other session, not just powershell", () => {
  // Our process tree does not reach into another session, so kill() alone
  // would leave the test running with nobody watching it.
  const files = fakeFs();
  const ps = fakePowerShell();
  const spawned = [];
  const run = startRunInSession({
    user: USER,
    seqDir: "C:\\runs\\abc",
    spawnFn: (cmd, args) => { spawned.push({ cmd, args }); return ps; },
    fsImpl: files,
  });

  ps.stdout.write('{"reason":"started","pid":4242,"sessionId":1}\r\n');
  run.kill();
  ps.emit("close", 1);

  const taskkill = spawned.find((s) => s.cmd === "taskkill");
  assert.ok(taskkill, "taskkill is how a process in another session is stopped");
  assert.deepStrictEqual(taskkill.args, ["/PID", "4242", "/T", "/F"]);
  assert.ok(ps.killed, "and the launcher is stopped too");
});
