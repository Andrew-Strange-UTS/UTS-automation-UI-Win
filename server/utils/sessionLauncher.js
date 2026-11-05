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
// Nothing is signed in between runs (EPEA-TBD-17): the VM is not allowed
// autologon. startSession opens a loopback RDP session for a run and
// logoffSession closes it; sessionLease.js decides when.
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
  // On-demand sessions (EPEA-TBD-17).
  ACCOUNT_MISSING: "account-missing",
  AUTOLOGON_ON: "autologon-on",
  RDP_DISABLED: "rdp-disabled",
  NO_CREDENTIAL: "no-credential",
  RDP_DENIED: "rdp-denied",
  CONFIG_UNREADABLE: "config-unreadable",
  SESSION_EXISTS: "session-exists",
  SESSION_TIMEOUT: "session-timeout",
  CONSOLE_SESSION: "console-session",
  LOGOFF_FAILED: "logoff-failed",
  // Set here, not by the script: no automation account has been set up yet,
  // which is a different problem from one that is not logged on.
  NOT_CONFIGURED: "not-configured",
  // Set here too: the script could not be run, or said something we could not
  // read.
  UNREADABLE: "unreadable",
};

const DEFAULT_PROBE_TIMEOUT_SECONDS = 30;

// How long the RDP client gets to produce an active session. A cold logon on
// the VM (profile load, Group Policy) can take most of a minute.
const DEFAULT_START_TIMEOUT_SECONDS = 90;

// After the session exists, Explorer and the shell still have to come up
// before anything can be driven. The probe is retried until then.
const DEFAULT_READY_TIMEOUT_MS = 60000;
const READY_POLL_MS = 3000;

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

function buildConfigArgs({ scriptPath = defaultScriptPath(), user } = {}) {
  return powershellArgs(scriptPath, ["-Mode", "config", "-User", user]);
}

function buildStartArgs({ scriptPath = defaultScriptPath(), user, timeoutSeconds = DEFAULT_START_TIMEOUT_SECONDS } = {}) {
  return powershellArgs(scriptPath, [
    "-Mode", "start",
    "-User", user,
    "-TimeoutSeconds", String(timeoutSeconds),
  ]);
}

function buildLogoffArgs({ scriptPath = defaultScriptPath(), user, clientPid } = {}) {
  const extra = ["-Mode", "logoff", "-User", user];
  if (Number.isInteger(clientPid) && clientPid > 0) extra.push("-ClientPid", String(clientPid));
  return powershellArgs(scriptPath, extra);
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
          ? `${user}'s session is disconnected, which means the RDP client holding it open has gone. Input works, but screen captures come back blank. The next run logs it off and starts a fresh one.`
          : undefined,
      };
    case Reason.NOT_CONFIGURED:
      return {
        cause: "No automation account is set up",
        hint: "Scheduled desktop tests need a dedicated automation account. Run scripts\\setup-automation-account.ps1 from an elevated prompt to create it.",
      };
    case Reason.NO_SESSION:
      return {
        cause: Array.isArray(result.others) && result.others.length
          ? `${user} is not logged on (signed in: ${result.others.join(", ")})`
          : `${user} is not logged on`,
        hint: `Scheduled desktop runs start ${user}'s session themselves and log it off afterwards. If this happens during a run, the session was logged off or its RDP client closed underneath it.`,
      };
    case Reason.LOCKED:
      return {
        cause: `${user} is signed in but the session is locked`,
        hint: `Input cannot be sent to a locked desktop, so this run fails, and the next run gets a fresh session. If it keeps happening, a test is sitting idle long enough to hit the machine inactivity limit or a screensaver lock for ${user}.`,
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
        hint: "The session is logged on but unresponsive. It usually means the desktop is busy or wedged; it is logged off when this run ends, and the next run starts a fresh one.",
      };
    case Reason.NOT_WINDOWS:
      return {
        cause: "Desktop automation requires Windows",
        hint: undefined,
      };
    case Reason.ACCOUNT_MISSING:
      return {
        cause: `There is no local account called ${user}`,
        hint: "Run scripts\\setup-automation-account.ps1 from an elevated prompt to create it.",
      };
    case Reason.AUTOLOGON_ON:
      return {
        cause: "Autologon is still configured on this machine",
        hint: "The VM team does not allow autologon, and Marvin no longer needs it: sessions are started for each run. Re-run scripts\\setup-automation-account.ps1, which turns autologon off.",
      };
    case Reason.RDP_DISABLED:
      return {
        cause: "Remote Desktop is turned off on this machine",
        hint: "Sessions for scheduled desktop runs are opened over RDP from the machine to itself, so Remote Desktop has to be enabled.",
      };
    case Reason.NO_CREDENTIAL:
      return {
        cause: `No stored password for ${user}`,
        hint: "The service logs the account on for each run, using a password only SYSTEM can read. Re-run scripts\\setup-automation-account.ps1 to generate and store it.",
      };
    case Reason.RDP_DENIED:
      return {
        cause: `${user} is not allowed to log on over Remote Desktop`,
        hint: `The run's session is an RDP connection from this machine to itself, so ${user} has to be in Remote Desktop Users and not in "Deny log on through Remote Desktop Services". Re-run scripts\\setup-automation-account.ps1. If a domain policy sets these, the change has to be made there.`,
      };
    case Reason.CONFIG_UNREADABLE:
      return {
        cause: `The session configuration could not be checked${result.detail ? `: ${result.detail}` : ""}`,
        hint: "This check reads the stored password's presence and the logon rights, which needs the service to run as LocalSystem.",
      };
    case Reason.SESSION_EXISTS:
      return {
        cause: `${user} already has a session open`,
        hint: "A new session cannot be started while an old one exists, because RDP would reconnect to it. It is normally logged off first; if this repeats, log it off by hand with `logoff <id>`.",
      };
    case Reason.SESSION_TIMEOUT:
      return {
        cause: result.clientExited
          ? `The RDP client exited (code ${result.clientExitCode}) without opening a session for ${user}`
          : `No session for ${user} appeared within ${result.timeoutSeconds || DEFAULT_START_TIMEOUT_SECONDS}s`,
        hint: "Check the Security event log for a failed logon (event 4625) and Applications and Services Logs > Microsoft > Windows > TerminalServices-RemoteConnectionManager for a refused connection.",
      };
    case Reason.CONSOLE_SESSION:
      return {
        cause: `The new session for ${user} was the console session (${result.sessionId})`,
        hint: "Runs must never use the console, which anyone with VMware console access can see. The run was refused and the session logged off.",
      };
    case Reason.LOGOFF_FAILED:
      return {
        cause: `${user}'s session was still there after logoff${Array.isArray(result.remaining) && result.remaining.length ? ` (${result.remaining.join(", ")})` : ""}`,
        hint: "The next run tries again before it starts. If it persists, log it off by hand with `logoff <id>`.",
      };
    default:
      return {
        cause: result.detail || "The session probe could not be read",
        hint: "Run server\\runners\\launch-in-session.ps1 -Mode probe -User <account> by hand to see what it reports.",
      };
  }
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

// One call into the script for a mode that answers with a single result line.
async function runMode({ args, timeoutMs, user, run, unreadableDetail }) {
  const { stdout, stderr, err } = await run(args, timeoutMs);
  const parsed = parseResult(stdout);
  if (!parsed) {
    const result = {
      reason: Reason.UNREADABLE,
      user,
      detail: (stderr || "").trim() || (err && err.message) || unreadableDetail,
    };
    return { ok: false, ...result, ...describeReason(result) };
  }
  return { ...parsed, user: parsed.user || user, ok: parsed.reason === Reason.OK, ...describeReason({ ...parsed, user: parsed.user || user }) };
}

function guard({ platform, user }) {
  if (platform !== "win32") {
    return { ok: false, reason: Reason.NOT_WINDOWS, ...describeReason({ reason: Reason.NOT_WINDOWS }) };
  }
  if (!user) {
    const result = { reason: Reason.NOT_CONFIGURED };
    return { ok: false, ...result, ...describeReason(result) };
  }
  return null;
}

// Can a session be started when a run needs one? Answered from configuration
// alone, without starting anything: a logon takes tens of seconds and shows up
// in the security log, which is not something to do every time the app opens.
async function checkSessionConfig(options = {}) {
  const { user, scriptPath = defaultScriptPath(), platform = process.platform, run = runPowerShell } = options;
  const refused = guard({ platform, user });
  if (refused) return refused;
  return runMode({
    args: buildConfigArgs({ scriptPath, user }),
    timeoutMs: 60000,
    user,
    run,
    unreadableDetail: "The session configuration check produced no result.",
  });
}

// Open a loopback RDP session as the automation account.
async function startSession(options = {}) {
  const {
    user,
    scriptPath = defaultScriptPath(),
    timeoutSeconds = DEFAULT_START_TIMEOUT_SECONDS,
    platform = process.platform,
    run = runPowerShell,
  } = options;
  const refused = guard({ platform, user });
  if (refused) return refused;
  return runMode({
    args: buildStartArgs({ scriptPath, user, timeoutSeconds }),
    timeoutMs: (timeoutSeconds + 30) * 1000,
    user,
    run,
    unreadableDetail: "The session start produced no result.",
  });
}

// Log off every session the account has. clientPid is the RDP client that
// startSession reported, closed if it has not already gone with its session.
async function logoffSession(options = {}) {
  const { user, clientPid, scriptPath = defaultScriptPath(), platform = process.platform, run = runPowerShell } = options;
  const refused = guard({ platform, user });
  if (refused) return refused;
  return runMode({
    args: buildLogoffArgs({ scriptPath, user, clientPid }),
    timeoutMs: 60000,
    user,
    run,
    unreadableDetail: "The logoff produced no result.",
  });
}

// A session existing is not the same as a desktop being ready: Explorer and
// the shell come up after the logon. Probe until the desktop answers, and
// report the last answer if it never does.
async function waitForUsableSession(options = {}) {
  const {
    user,
    probe = probeSession,
    timeoutMs = DEFAULT_READY_TIMEOUT_MS,
    pollMs = READY_POLL_MS,
    now = () => Date.now(),
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  } = options;
  const deadline = now() + timeoutMs;
  let last;
  let attempts = 0;
  for (;;) {
    attempts++;
    last = await probe({ user });
    if (last.ok) return { ...last, attempts };
    // Retrying cannot fix these: they are not a desktop that is still loading.
    if ([Reason.NOT_WINDOWS, Reason.NOT_CONFIGURED, Reason.TOKEN_DENIED].includes(last.reason)) {
      return { ...last, attempts };
    }
    if (now() + pollMs > deadline) return { ...last, attempts };
    await sleep(pollMs);
  }
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
  DEFAULT_START_TIMEOUT_SECONDS,
  DEFAULT_READY_TIMEOUT_MS,
  buildConfigArgs,
  buildStartArgs,
  buildLogoffArgs,
  checkSessionConfig,
  startSession,
  logoffSession,
  waitForUsableSession,
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
  probeSession,
};
