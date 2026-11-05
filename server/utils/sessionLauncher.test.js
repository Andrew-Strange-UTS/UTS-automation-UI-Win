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
  DEFAULT_START_TIMEOUT_SECONDS,
  buildConfigArgs,
  buildStartArgs,
  buildLogoffArgs,
  checkSessionConfig,
  startSession,
  logoffSession,
  waitForUsableSession,
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

test("a launch always names the executable, because inferring it fails on a real VM", () => {
  // Measured with -Mode diagnose: CreateProcessAsUser returned ERROR_INVALID_NAME
  // (123) for every variant except one that passed BOTH an explicit application
  // name and an explicit working directory. Neither alone was enough.
  const args = buildLaunchArgs({ scriptPath: SCRIPT, user: USER, commandLine: "x", workingDirectory: "C:\\runs\\abc" });

  const appIndex = args.indexOf("-ApplicationName");
  assert.notStrictEqual(appIndex, -1, "an application name is not optional");
  assert.match(args[appIndex + 1], /cmd\.exe$/i, "the redirected command line runs through cmd.exe");
  assert.ok(args.includes("-WorkingDirectory"), "and a working directory is not optional either");
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

test("a run waits as long as it takes, unlike a probe", () => {
  // The probe's 30s limit was reused for runs, so the first real scheduled
  // sequence was cut off mid-step and reported as an unresponsive desktop.
  const args = buildLaunchArgs({ scriptPath: SCRIPT, user: USER, commandLine: "x" });
  const idx = args.indexOf("-TimeoutSeconds");

  assert.notStrictEqual(idx, -1, "the timeout is always stated, never left to the script's default");
  assert.strictEqual(args[idx + 1], "0", "0 means wait indefinitely");
});

test("a caller that wants a limit still gets one", () => {
  const args = buildLaunchArgs({ scriptPath: SCRIPT, user: USER, commandLine: "x", timeoutSeconds: 600 });
  assert.strictEqual(args[args.indexOf("-TimeoutSeconds") + 1], "600");
});

test("a run cut short is not described as an unresponsive desktop", () => {
  const probe = describeReason({ reason: Reason.PROBE_TIMEOUT, user: USER });
  const run = describeReason({ reason: Reason.RUN_TIMEOUT, user: USER });

  assert.match(run.cause, /time limit/);
  assert.notStrictEqual(run.cause, probe.cause, "a slow test and a wedged desktop need different answers");
  assert.match(run.hint, /killed/, "and the run is not left going with nobody reading it");
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
  assert.match(line, />\s*"C:\\ProgramData\\uts-automation\\tmp\\scheduled-abc\\run\.log" 2>&1"$/);
});

test("the whole command is wrapped, because cmd /c eats the outer quotes", () => {
  // Without the wrapper, cmd strips the first and last quote of everything
  // after /c, the redirect is mangled, nothing is captured, and cmd exits 1.
  // That is a scheduled run that failed with an empty log and no explanation.
  const line = buildRedirectedCommandLine({ exe: "node", args: ["run.js"], logFile: "C:\\runs\\out.log" });

  const afterSwitch = line.slice("cmd.exe /c ".length);
  assert.ok(afterSwitch.startsWith('"'), "must open with a quote for cmd to strip");
  assert.ok(afterSwitch.endsWith('"'), "and close with one");

  // What cmd actually executes after stripping that outer pair.
  const asCmdSeesIt = afterSwitch.slice(1, -1);
  assert.strictEqual(asCmdSeesIt, '"node" "run.js" > "C:\\runs\\out.log" 2>&1');
});

test("a run that captured nothing says so instead of returning an empty log", async () => {
  const files = fakeFs();
  const ps = fakePowerShell();
  const run = startRunInSession({
    user: USER, seqDir: "C:\\runs\\abc", spawnFn: () => ps, fsImpl: files, pollMs: 5,
  });

  let errText = "";
  run.stderr.on("data", (c) => { errText += c.toString(); });

  await new Promise((resolve) => {
    run.on("close", resolve);
    ps.stdout.write('{"ok":true,"reason":"ok","pid":42,"exitCode":1}\r\n');
    ps.emit("close", 1);
  });

  assert.match(errText, /No output was captured/);
  assert.match(errText, /did not start/);
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

test("a healthy active session carries no warning of its own", () => {
  const { hint } = describeReason({ reason: Reason.OK, user: USER, sessionId: 1, state: "active" });
  assert.strictEqual(hint, undefined);
});

test("a disconnected session still reports the blank-capture caveat", () => {
  const { hint } = describeReason({
    reason: Reason.OK, user: USER, sessionId: 2, state: "disconnected",
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

// ─── The session diagnostic ───

const { diagnoseSession, buildDiagnoseArgs } = require("./sessionLauncher");

test("the diagnostic asks the script for its diagnose mode", () => {
  const args = buildDiagnoseArgs({ scriptPath: SCRIPT, user: USER });
  assert.deepStrictEqual(args.slice(args.indexOf("-Mode"), args.indexOf("-Mode") + 2), ["-Mode", "diagnose"]);
  assert.ok(args.includes(USER));
});

test("the diagnostic returns every variant's result, not just a verdict", async () => {
  // The point is which variant Windows accepts, so a pass/fail would throw away
  // the only useful part.
  const payload = {
    ok: true,
    reason: "diagnose",
    user: USER,
    sessionId: 1,
    results: [
      { variant: "as production", reason: "launch-failed", win32: 123 },
      { variant: "explicit application name", reason: "ok", exitCode: 0 },
    ],
  };

  const result = await diagnoseSession({
    user: USER,
    platform: "win32",
    run: async () => ({ stdout: JSON.stringify(payload) }),
  });

  assert.strictEqual(result.results.length, 2);
  assert.strictEqual(result.results[1].reason, "ok");
});

test("a diagnostic that cannot run says so rather than reporting nothing wrong", async () => {
  const result = await diagnoseSession({
    user: USER,
    platform: "win32",
    run: async () => ({ stdout: "", stderr: "Access is denied" }),
  });

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, Reason.UNREADABLE);
  assert.match(result.detail, /Access is denied/);
});

// ─── The environment handed to a run in another session ───

const { stripUserEnvironment } = require("./sessionLauncher");

test("the service's own identity is kept out of the run's environment", () => {
  // The service is LocalSystem, so its TEMP is C:\Windows\TEMP, which grants
  // Users write but not read. Replaying it into the child broke Add-Type:
  // csc wrote its .cs there and could not read it back.
  const kept = stripUserEnvironment({
    TEMP: "C:\\Windows\\TEMP",
    TMP: "C:\\Windows\\TEMP",
    USERPROFILE: "C:\\Windows\\system32\\config\\systemprofile",
    APPDATA: "C:\\Windows\\system32\\config\\systemprofile\\AppData\\Roaming",
    USERNAME: "PRDITDJUMP02$",
    NODE_PATH: "C:\\Program Files\\Marvin\\resources\\app\\server\\node_modules",
    SELENIUM_LOCAL: "true",
  });

  assert.deepStrictEqual(Object.keys(kept).sort(), ["NODE_PATH", "SELENIUM_LOCAL"]);
});

test("the filter is case insensitive, because Windows variables are", () => {
  const kept = stripUserEnvironment({ Temp: "x", tmp: "y", UserProfile: "z", NODE_PATH: "keep" });
  assert.deepStrictEqual(Object.keys(kept), ["NODE_PATH"]);
});

test("a run script carries what the run needs and nothing about who runs it", () => {
  const files = fakeFs();
  const ps = fakePowerShell();
  startRunInSession({
    user: USER,
    seqDir: "C:\\runs\\abc",
    env: { NODE_PATH: "C:\\Marvin\\node_modules", TEMP: "C:\\Windows\\TEMP" },
    spawnFn: () => ps,
    fsImpl: files,
  });
  ps.emit("close", 0);

  const cmd = files.written[Object.keys(files.written)[0]];
  assert.match(cmd, /set "NODE_PATH=/);
  assert.ok(!/set "TEMP=/i.test(cmd), "the user's own TEMP must survive");
});

// ─── On-demand sessions (EPEA-TBD-17, EPEA-TBD-18) ───

const ok = (obj) => async () => ({ stdout: JSON.stringify(obj) + "\n" });

test("EPEA-TBD-17: start asks the script to open a session, with a timeout long enough for a cold logon", () => {
  const args = buildStartArgs({ scriptPath: SCRIPT, user: USER });
  assert.deepStrictEqual(args.slice(-6), ["-Mode", "start", "-User", USER, "-TimeoutSeconds", String(DEFAULT_START_TIMEOUT_SECONDS)]);
  assert.ok(DEFAULT_START_TIMEOUT_SECONDS >= 60, "a profile load on the VM can take most of a minute");
});

test("EPEA-TBD-17: logoff names the RDP client only when there is one", () => {
  assert.deepStrictEqual(buildLogoffArgs({ scriptPath: SCRIPT, user: USER, clientPid: 812 }).slice(-6), ["-Mode", "logoff", "-User", USER, "-ClientPid", "812"]);
  assert.ok(!buildLogoffArgs({ scriptPath: SCRIPT, user: USER }).includes("-ClientPid"));
  assert.ok(!buildLogoffArgs({ scriptPath: SCRIPT, user: USER, clientPid: "812; calc" }).includes("-ClientPid"), "only an integer is passed through");
});

test("EPEA-TBD-18 AC1: the config check runs its own mode and starts nothing", () => {
  const args = buildConfigArgs({ scriptPath: SCRIPT, user: USER });
  assert.deepStrictEqual(args.slice(-4), ["-Mode", "config", "-User", USER]);
});

test("EPEA-TBD-17 AC4: a started session reports its id and RDP client", async () => {
  const result = await startSession({
    user: USER, platform: "win32",
    run: ok({ ok: true, reason: "ok", user: USER, sessionId: 4, station: "RDP-Tcp#7", clientPid: 812, consoleSessionId: 1 }),
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.sessionId, 4);
  assert.strictEqual(result.clientPid, 812);
});

test("EPEA-TBD-17 AC4: a session that never appears names the client's exit and where to look", async () => {
  const result = await startSession({
    user: USER, platform: "win32",
    run: ok({ ok: false, reason: "session-timeout", clientExited: true, clientExitCode: 3 }),
  });
  assert.strictEqual(result.ok, false);
  assert.match(result.cause, /RDP client exited \(code 3\)/);
  assert.match(result.hint, /4625/);
});

test("EPEA-TBD-17: a start that prints nothing readable is a failure, never a session", async () => {
  const result = await startSession({ user: USER, platform: "win32", run: async () => ({ stdout: "", stderr: "Add-Type failed" }) });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, Reason.UNREADABLE);
  assert.match(result.detail, /Add-Type failed/);
});

test("EPEA-TBD-17 AC10: a session on the console is refused", async () => {
  const result = await startSession({
    user: USER, platform: "win32",
    run: ok({ ok: false, reason: "console-session", sessionId: 1, consoleSessionId: 1 }),
  });
  assert.strictEqual(result.ok, false);
  assert.match(result.cause, /console session/);
  assert.match(result.hint, /VMware console/);
});

test("EPEA-TBD-17 AC5: a logoff that leaves a session behind is a failure and names it", async () => {
  const result = await logoffSession({
    user: USER, clientPid: 812, platform: "win32",
    run: ok({ ok: false, reason: "logoff-failed", remaining: ["4 RDP-Tcp#7 state=4"] }),
  });
  assert.strictEqual(result.ok, false);
  assert.match(result.cause, /4 RDP-Tcp#7/);
});

test("EPEA-TBD-18 AC4: every reason the session row can be red has its own cause and fix", () => {
  const reasons = [
    Reason.ACCOUNT_MISSING, Reason.AUTOLOGON_ON, Reason.RDP_DISABLED, Reason.NO_CREDENTIAL,
    Reason.RDP_DENIED, Reason.CONFIG_UNREADABLE, Reason.SESSION_EXISTS, Reason.SESSION_TIMEOUT,
    Reason.CONSOLE_SESSION, Reason.LOGOFF_FAILED,
  ];
  const described = reasons.map((reason) => describeReason({ reason, user: USER }));
  for (const [i, d] of described.entries()) {
    assert.ok(d.cause, `${reasons[i]} has a cause`);
    assert.ok(d.hint, `${reasons[i]} has a fix`);
  }
  assert.strictEqual(new Set(described.map((d) => d.cause)).size, reasons.length, "no two reasons share a cause");
  assert.strictEqual(new Set(described.map((d) => d.hint)).size, reasons.length, "no two reasons share a fix");
});

test("EPEA-TBD-18 AC4: autologon still being on is red, and says the VM team has ruled it out", async () => {
  const result = await checkSessionConfig({
    user: USER, platform: "win32",
    run: ok({ ok: false, reason: "autologon-on", autologon: true, credentialStored: true }),
  });
  assert.strictEqual(result.ok, false);
  assert.match(result.cause, /Autologon/);
  assert.match(result.hint, /does not allow autologon/);
});

test("EPEA-TBD-18 AC1: a ready configuration is ok even with no session open", async () => {
  const result = await checkSessionConfig({
    user: USER, platform: "win32",
    run: ok({ ok: true, reason: "ok", autologon: false, rdpEnabled: true, credentialStored: true, rdpLogonDenied: false, inRemoteDesktopUsers: true, sessions: [] }),
  });
  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(result.sessions, []);
});

test("EPEA-TBD-18 AC1: no session is no longer described as autologon having failed", () => {
  const { hint } = describeReason({ reason: Reason.NO_SESSION, user: USER });
  assert.doesNotMatch(hint, /autologon/i);
});

test("EPEA-TBD-17: the on-demand calls refuse to run without an account or off Windows", async () => {
  const run = async () => { throw new Error("must not run"); };
  assert.strictEqual((await startSession({ user: null, platform: "win32", run })).reason, Reason.NOT_CONFIGURED);
  assert.strictEqual((await logoffSession({ user: USER, platform: "linux", run })).reason, Reason.NOT_WINDOWS);
  assert.strictEqual((await checkSessionConfig({ user: null, platform: "win32", run })).reason, Reason.NOT_CONFIGURED);
});

test("EPEA-TBD-17 AC4: the desktop is probed until it answers, because the shell starts after the logon", async () => {
  const answers = [{ ok: false, reason: "launch-failed" }, { ok: false, reason: "locked" }, { ok: true, reason: "ok", sessionId: 4 }];
  let t = 0;
  const result = await waitForUsableSession({
    user: USER, probe: async () => answers.shift(), timeoutMs: 60000, pollMs: 3000,
    now: () => t, sleep: async (ms) => { t += ms; },
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.attempts, 3);
});

test("EPEA-TBD-17 AC4: a desktop that never answers returns the last reason once the time is up", async () => {
  let t = 0;
  let calls = 0;
  const result = await waitForUsableSession({
    user: USER, probe: async () => { calls++; return { ok: false, reason: "probe-timeout" }; },
    timeoutMs: 10000, pollMs: 3000, now: () => t, sleep: async (ms) => { t += ms; },
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, "probe-timeout");
  assert.ok(calls >= 3 && calls <= 5, `retried within the deadline (${calls} probes)`);
});

test("EPEA-TBD-17 AC4: a token that cannot be taken is not retried, because waiting will not fix it", async () => {
  let calls = 0;
  const result = await waitForUsableSession({
    user: USER, probe: async () => { calls++; return { ok: false, reason: "token-denied" }; },
    sleep: async () => {},
  });
  assert.strictEqual(result.reason, "token-denied");
  assert.strictEqual(calls, 1);
});
