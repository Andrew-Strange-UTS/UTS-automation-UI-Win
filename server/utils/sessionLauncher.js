// server/utils/sessionLauncher.js
// Running desktop work in a real interactive session, from Session 0.
//
// The scheduler service runs as LocalSystem, so every process it spawns lands
// in Session 0, which has no interactive desktop: SendKeys fails with "Access
// is denied" and screen capture with "The handle is invalid". Scheduled web
// tests never noticed, because headless Chrome needs no desktop.
//
// The fix is launch-in-session.ps1, which takes the automation account's
// session token (LocalSystem can, with no password) and creates the process on
// winsta0\default. This module builds its command lines, reads its answers, and
// turns a reason code into something a person can act on.
//
// The command runner is injectable so all of that can be tested off Windows.

const { execFile, spawn } = require("child_process");
const { EventEmitter } = require("events");
const { PassThrough } = require("stream");
const fs = require("fs");
const path = require("path");

const SCRIPT_NAME = "launch-in-session.ps1";

// Must match the reason codes written by launch-in-session.ps1.
const Reason = {
  OK: "ok",
  NOT_WINDOWS: "not-windows",
  NO_SESSION: "no-session",
  LOCKED: "locked",
  TOKEN_DENIED: "token-denied",
  LAUNCH_FAILED: "launch-failed",
  PROBE_TIMEOUT: "probe-timeout",
  RUN_TIMEOUT: "run-timeout",
  // Set here, not by the script: no automation account has been set up yet,
  // which is a different problem from one that is not logged on.
  NOT_CONFIGURED: "not-configured",
  // Set here too: the script could not be run, or said something we could not
  // read.
  UNREADABLE: "unreadable",
};

const DEFAULT_PROBE_TIMEOUT_SECONDS = 30;

// The keep-alive writes a heartbeat each cycle (default 4 minutes). Older than
// this and it is not doing its job, whatever its scheduled task claims: a task
// sits in "Running" perfectly happily with a wedged script behind it.
const KEEP_AWAKE_STALE_SECONDS = 600;

function defaultScriptPath() {
  return path.join(__dirname, "..", "runners", SCRIPT_NAME);
}

// The redirected command line always starts with cmd.exe, so that is what
// CreateProcessAsUser has to be told it is launching.
function defaultShell(env = process.env) {
  return path.join(env.SystemRoot || "C:\\Windows", "System32", "cmd.exe");
}

function powershellArgs(scriptPath, extra) {
  return [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    scriptPath,
    ...extra,
  ];
}

function buildProbeArgs({ scriptPath = defaultScriptPath(), user, timeoutSeconds = DEFAULT_PROBE_TIMEOUT_SECONDS } = {}) {
  return powershellArgs(scriptPath, [
    "-Mode", "probe",
    "-User", user,
    "-TimeoutSeconds", String(timeoutSeconds),
  ]);
}

function buildDiagnoseArgs({ scriptPath = defaultScriptPath(), user, timeoutSeconds = 120 } = {}) {
  return powershellArgs(scriptPath, [
    "-Mode", "diagnose",
    "-User", user,
    "-TimeoutSeconds", String(timeoutSeconds),
  ]);
}

function buildLaunchArgs({
  scriptPath = defaultScriptPath(),
  user,
  commandLine,
  workingDirectory,
  // CreateProcessAsUser needs the executable named explicitly as well as a
  // working directory; inferring either fails with ERROR_INVALID_NAME.
  applicationName = defaultShell(),
  wait = true,
  // 0 means wait indefinitely. A run is not a probe: the probe's 30 seconds cut
  // a real sequence off mid-step and reported it as an unresponsive desktop,
  // which it was not.
  timeoutSeconds = 0,
} = {}) {
  const extra = ["-Mode", "launch", "-User", user, "-CommandLine", commandLine];
  if (applicationName) extra.push("-ApplicationName", applicationName);
  if (workingDirectory) extra.push("-WorkingDirectory", workingDirectory);
  if (wait) extra.push("-Wait");
  extra.push("-TimeoutSeconds", String(timeoutSeconds));
  return powershellArgs(scriptPath, extra);
}

// A process created in another session cannot write down our stdio pipes, so
// the child redirects to a file and the caller tails it. cmd.exe does the
// redirection because CreateProcessAsUser takes a command line, not a shell.
//
// The outer quotes are not redundant. `cmd /c` strips the first and last quote
// of everything after /c whenever the string holds more than two quotes, so
//     cmd /c "run.cmd" > "run.log" 2>&1
// reaches cmd as
//     run.cmd" > "run.log 2>&1
// The redirect never happens, nothing is captured, and cmd exits 1: a scheduled
// run that failed with an empty log. Wrapping the whole thing gives cmd an
// outer pair to strip and leaves the real quotes intact.
function buildRedirectedCommandLine({ exe = "node", args = [], logFile } = {}) {
  const quoted = [exe, ...args].map((part) => `"${part}"`).join(" ");
  return `cmd.exe /c "${quoted} > "${logFile}" 2>&1"`;
}

// Variables that describe WHO is running, not WHAT is being run. The service
// runs as LocalSystem, so its copies point into the SYSTEM profile: TEMP is
// C:\Windows\TEMP, which grants Users write but not read. Replaying those into
// the child overrides the correct per-user values CreateEnvironmentBlock
// already set, and the first thing that breaks is Add-Type: csc writes its .cs
// there and then cannot read it back ("Source file ... could not be found").
const USER_SPECIFIC_ENV = [
  "TEMP",
  "TMP",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "HOMEDRIVE",
  "HOMEPATH",
  "USERNAME",
  "USERDOMAIN",
  "USERDOMAIN_ROAMINGPROFILE",
  "LOGONSERVER",
  "SESSIONNAME",
];

function stripUserEnvironment(env = {}) {
  const drop = new Set(USER_SPECIFIC_ENV.map((name) => name.toUpperCase()));
  const kept = {};
  for (const [name, value] of Object.entries(env)) {
    if (!drop.has(name.toUpperCase())) kept[name] = value;
  }
  return kept;
}

// CreateProcessAsUser builds the child's environment from the user's own
// profile, so the variables the service sets (NODE_PATH and friends) would be
// lost. A .cmd in the run directory carries them, and is also the artefact you
// can run by hand when a scheduled run misbehaves.
function buildRunScript({ env = {}, exe = "node", args = [] } = {}) {
  const lines = ["@echo off"];
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined || value === null) continue;
    lines.push(`set "${name}=${String(value)}"`);
  }
  lines.push(`"${exe}" ${args.map((a) => `"${a}"`).join(" ")}`);
  lines.push("exit /b %ERRORLEVEL%");
  return lines.join("\r\n") + "\r\n";
}

// launch -Wait reports the process id as soon as it has one, then the final
// result when it exits. The id is what lets Stop kill a run that is executing
// in another session, where our own process tree does not reach.
function parseStartedPid(text) {
  const match = String(text || "").match(/\{[^{}]*"reason"\s*:\s*"started"[^{}]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    return typeof parsed.pid === "number" ? parsed.pid : null;
  } catch {
    return null;
  }
}

// The script prints one line of JSON, but PowerShell profiles, module banners
// and progress records have a habit of adding noise, so take the last line that
// parses rather than assuming the whole of stdout is the answer.
function parseResult(stdout) {
  const lines = String(stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].startsWith("{")) continue;
    try {
      const parsed = JSON.parse(lines[i]);
      if (parsed && typeof parsed.reason === "string") return parsed;
    } catch {
      // Keep looking: a brace-leading line that is not JSON is just noise.
    }
  }
  return null;
}

// What the startup check shows. Each reason is a different problem with a
// different fix, so none of them may collapse into "desktop tests unavailable".
function describeReason(result = {}) {
  const user = result.user || "the automation account";
  const win32 = result.win32 ? ` (Win32 error ${result.win32})` : "";

  switch (result.reason) {
    case Reason.OK:
      return {
        cause: `Session ${result.sessionId} (${result.state})`,
        hint: result.state === "disconnected"
          ? `${user} is logged on but its session is disconnected. Input works, but screen captures come back blank. Reconnect it to the console (tscon) so failure screenshots are usable.`
          : undefined,
      };
    case Reason.NOT_CONFIGURED:
      return {
        cause: "No automation account is set up",
        hint: "Scheduled desktop tests need a dedicated always-logged-on account. Run the automation account setup from an elevated prompt to create it.",
      };
    case Reason.NO_SESSION:
      return {
        cause: Array.isArray(result.others) && result.others.length
          ? `${user} is not logged on (signed in: ${result.others.join(", ")})`
          : `${user} is not logged on`,
        hint: `Scheduled desktop tests run in ${user}'s session, so that account has to be signed in for them to work. Check that autologon is still configured and that nothing has signed it out.`,
      };
    case Reason.LOCKED:
      return {
        cause: `${user} is signed in but the session is locked`,
        hint: `Input cannot be sent to a locked desktop. Confirm the screensaver, lock timeout and inactivity policy are still disabled for ${user}.`,
      };
    case Reason.TOKEN_DENIED:
      return {
        cause: `The session token for ${user} could not be taken${win32}`,
        hint: "Only LocalSystem can query a session token. Check the Marvin Scheduler service is still running as LocalSystem rather than a user account.",
      };
    case Reason.LAUNCH_FAILED:
      return {
        cause: `A process could not be started in ${user}'s session${win32}`,
        hint: "The session exists and its token was taken, but process creation failed. Check the Windows Event Viewer for the failing launch.",
      };
    case Reason.RUN_TIMEOUT:
      return {
        cause: `The run hit its time limit in ${user}'s session and was stopped`,
        hint: "The sequence was still running when the launcher's limit expired, and has been killed rather than left going with nobody reading it. Raise the limit for this schedule, or find out why the sequence no longer finishes.",
      };
    case Reason.PROBE_TIMEOUT:
      return {
        cause: `${user}'s session did not answer the desktop probe in time`,
        hint: "The session is logged on but unresponsive. It usually means the desktop is busy or wedged; sign that account out and let autologon restore it.",
      };
    case Reason.NOT_WINDOWS:
      return {
        cause: "Desktop automation requires Windows",
        hint: undefined,
      };
    default:
      return {
        cause: result.detail || "The session probe could not be read",
        hint: "Run server\\runners\\launch-in-session.ps1 -Mode probe -User <account> by hand to see what it reports.",
      };
  }
}

// The keep-alive's own verdict, separate from the session's.
//
// It fails independently: the session can be perfectly healthy while the thing
// stopping it from locking has been dead for an hour. And whether it is needed
// at all depends on the machine's inactivity policy, so a missing keep-alive on
// a VM with no such policy is not a fault and is not reported as one.
//
// The heartbeat decides, never the scheduled task's state: a task sits in
// "Running" quite happily with a wedged script behind it.
function describeKeepAwake(result = {}) {
  const user = result.user || "the automation account";
  const limit = Number(result.inactivityTimeoutSecs) || 0;
  const age = result.keepAwakeAgeSeconds;
  const alive = typeof age === "number" && age <= KEEP_AWAKE_STALE_SECONDS;
  const TASK = '"Marvin keep automation session awake"';

  if (!limit) {
    return alive
      ? { ok: true, cause: `Running (no inactivity limit on this machine)` }
      : { ok: true, cause: "Not needed: this machine has no inactivity limit" };
  }

  if (alive) {
    return { ok: true, cause: `Running, last beat ${age}s ago (limit ${limit}s)` };
  }

  if (typeof age !== "number") {
    return {
      ok: false,
      cause: `Not running, and this machine locks a session after ${limit}s`,
      hint: `${user}'s session will lock, and a locked session cannot be unlocked: the account's password is discarded at setup by design, so only a reboot recovers it. Check the ${TASK} scheduled task has run in that session.`,
    };
  }

  return {
    ok: false,
    cause: `Stopped ${age}s ago, and this machine locks a session after ${limit}s`,
    hint: `The keep-alive is registered but is no longer reporting, so the session will lock once the limit fires. Check the ${TASK} scheduled task in ${user}'s session; a task can sit in "Running" with a stalled script behind it.`,
  };
}

function runPowerShell(args, timeoutMs) {
  return new Promise((resolve) => {
    execFile("powershell.exe", args, { timeout: timeoutMs, windowsHide: true }, (err, stdout, stderr) => {
      resolve({ err, stdout: stdout || "", stderr: stderr || "" });
    });
  });
}

// Is there a session we can actually run desktop work in? Proved by launching a
// probe process into it, never inferred from the account existing: an account
// that is logged on but locked looks identical from the outside and cannot
// receive a single keystroke.
async function probeSession(options = {}) {
  const {
    user,
    scriptPath = defaultScriptPath(),
    timeoutSeconds = DEFAULT_PROBE_TIMEOUT_SECONDS,
    platform = process.platform,
    run = runPowerShell,
  } = options;

  if (platform !== "win32") {
    return { ok: false, reason: Reason.NOT_WINDOWS, ...describeReason({ reason: Reason.NOT_WINDOWS }) };
  }
  if (!user) {
    const result = { reason: Reason.NOT_CONFIGURED };
    return { ok: false, ...result, ...describeReason(result) };
  }

  const args = buildProbeArgs({ scriptPath, user, timeoutSeconds });
  // The script's own timeout is the real one; this only stops a wedged
  // powershell.exe from holding the health check open forever.
  const { stdout, stderr, err } = await run(args, (timeoutSeconds + 10) * 1000);

  const parsed = parseResult(stdout);
  if (!parsed) {
    const result = {
      reason: Reason.UNREADABLE,
      user,
      detail: (stderr || "").trim() || (err && err.message) || "The session probe produced no result.",
    };
    return { ok: false, ...result, ...describeReason(result) };
  }

  return { ...parsed, ok: parsed.reason === Reason.OK, ...describeReason(parsed) };
}

// Start a scheduled run in the automation account's session, behaving like the
// child_process the scheduler already knows how to drive: .stdout, .stderr,
// "close", "error" and .kill().
//
// The output comes back through a file because a process in another session
// cannot write down our pipes, and .kill() goes through taskkill because our
// process tree does not reach into that session either.
function startRunInSession(options = {}) {
  const {
    user,
    seqDir,
    env = {},
    nodeExe = "node",
    script = "run.js",
    scriptPath = defaultScriptPath(),
    spawnFn = spawn,
    fsImpl = fs,
    pollMs = 400,
    timeoutSeconds,
  } = options;

  const emitter = new EventEmitter();
  emitter.stdout = new PassThrough();
  emitter.stderr = new PassThrough();

  const runScript = path.join(seqDir, "run.cmd");
  const logFile = path.join(seqDir, "run.log");
  fsImpl.writeFileSync(
    runScript,
    // Only what the run needs. Anything describing the service's own identity
    // stays out, so the target user's profile keeps its own.
    buildRunScript({ env: stripUserEnvironment(env), exe: nodeExe, args: [script] })
  );

  const args = buildLaunchArgs({
    scriptPath,
    user,
    commandLine: buildRedirectedCommandLine({ exe: runScript, args: [], logFile }),
    workingDirectory: seqDir,
    wait: true,
    timeoutSeconds,
  });

  let offset = 0;
  const drain = () => {
    try {
      const size = fsImpl.statSync(logFile).size;
      if (size <= offset) return;
      const fd = fsImpl.openSync(logFile, "r");
      try {
        const buffer = Buffer.alloc(size - offset);
        fsImpl.readSync(fd, buffer, 0, buffer.length, offset);
        offset = size;
        emitter.stdout.write(buffer);
      } finally {
        fsImpl.closeSync(fd);
      }
    } catch {
      // The child has not created the log yet, or it is mid-write.
    }
  };

  const ps = spawnFn("powershell.exe", args, { windowsHide: true });
  const timer = setInterval(drain, pollMs);
  // A poll timer must never be the reason a process stays alive: if the
  // launcher dies without a close event, this would hold the service open.
  if (typeof timer.unref === "function") timer.unref();
  let childPid = null;
  let scriptOutput = "";

  ps.stdout.on("data", (chunk) => {
    scriptOutput += chunk.toString();
    if (childPid === null) {
      const pid = parseStartedPid(scriptOutput);
      if (pid !== null) {
        childPid = pid;
        emitter.pid = pid;
      }
    }
  });
  ps.stderr.on("data", (chunk) => emitter.stderr.write(chunk));
  ps.on("error", (err) => {
    clearInterval(timer);
    emitter.emit("error", err);
  });

  ps.on("close", (code) => {
    clearInterval(timer);
    drain();

    if (offset === 0) {
      // No bytes ever reached the log. The test cannot have run, so say that
      // rather than handing back an empty log and an exit code.
      emitter.stderr.write(
        `No output was captured from this run. The command was never able to write to ${logFile}, ` +
          `which usually means it did not start. Launcher said: ${scriptOutput.trim() || "(nothing)"}\n`
      );
    }

    const result = parseResult(scriptOutput);
    if (result && result.reason !== Reason.OK) {
      // The run never started. Say why in the run log, or it reads as a test
      // failure rather than a machine that could not run the test.
      const { cause, hint } = describeReason({ ...result, user });
      emitter.stderr.write(`Could not run in ${user}'s session: ${cause}\n${hint ? hint + "\n" : ""}`);
      emitter.emit("close", 1);
      return;
    }
    emitter.emit("close", code);
  });

  emitter.kill = () => {
    if (childPid !== null) {
      spawnFn("taskkill", ["/PID", String(childPid), "/T", "/F"], { windowsHide: true });
    }
    ps.kill();
  };

  return emitter;
}

// Why a launch into the session fails, when the probe says it does. Only this
// process can ask: querying a session token needs SeTcbPrivilege, which the
// service has as LocalSystem and an interactive administrator does not.
async function diagnoseSession(options = {}) {
  const {
    user,
    scriptPath = defaultScriptPath(),
    timeoutSeconds = 120,
    platform = process.platform,
    run = runPowerShell,
  } = options;

  if (platform !== "win32") {
    return { ok: false, reason: Reason.NOT_WINDOWS };
  }
  if (!user) {
    return { ok: false, reason: Reason.NOT_CONFIGURED };
  }

  const args = buildDiagnoseArgs({ scriptPath, user, timeoutSeconds });
  const { stdout, stderr, err } = await run(args, (timeoutSeconds + 30) * 1000);

  const parsed = parseResult(stdout);
  if (!parsed) {
    return {
      ok: false,
      reason: Reason.UNREADABLE,
      detail: (stderr || "").trim() || (err && err.message) || "The diagnostic produced no result.",
    };
  }
  return parsed;
}

module.exports = {
  Reason,
  buildDiagnoseArgs,
  diagnoseSession,
  KEEP_AWAKE_STALE_SECONDS,
  startRunInSession,
  SCRIPT_NAME,
  defaultScriptPath,
  buildProbeArgs,
  buildLaunchArgs,
  buildRedirectedCommandLine,
  buildRunScript,
  stripUserEnvironment,
  defaultShell,
  parseStartedPid,
  parseResult,
  describeReason,
  describeKeepAwake,
  probeSession,
};
