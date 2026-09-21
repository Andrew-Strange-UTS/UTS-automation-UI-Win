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

const { execFile } = require("child_process");
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
  // Set here, not by the script: no automation account has been set up yet,
  // which is a different problem from one that is not logged on.
  NOT_CONFIGURED: "not-configured",
  // Set here too: the script could not be run, or said something we could not
  // read.
  UNREADABLE: "unreadable",
};

const DEFAULT_PROBE_TIMEOUT_SECONDS = 30;

function defaultScriptPath() {
  return path.join(__dirname, "..", "runners", SCRIPT_NAME);
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

function buildLaunchArgs({
  scriptPath = defaultScriptPath(),
  user,
  commandLine,
  workingDirectory,
  wait = true,
  timeoutSeconds,
} = {}) {
  const extra = ["-Mode", "launch", "-User", user, "-CommandLine", commandLine];
  if (workingDirectory) extra.push("-WorkingDirectory", workingDirectory);
  if (wait) extra.push("-Wait");
  if (timeoutSeconds) extra.push("-TimeoutSeconds", String(timeoutSeconds));
  return powershellArgs(scriptPath, extra);
}

// A process created in another session cannot write down our stdio pipes, so
// the child redirects to a file and the caller tails it. cmd.exe does the
// redirection because CreateProcessAsUser takes a command line, not a shell.
function buildRedirectedCommandLine({ exe = "node", args = [], logFile } = {}) {
  const quoted = [exe, ...args].map((part) => `"${part}"`).join(" ");
  return `cmd.exe /c ${quoted} > "${logFile}" 2>&1`;
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

module.exports = {
  Reason,
  SCRIPT_NAME,
  defaultScriptPath,
  buildProbeArgs,
  buildLaunchArgs,
  buildRedirectedCommandLine,
  parseResult,
  describeReason,
  probeSession,
};
