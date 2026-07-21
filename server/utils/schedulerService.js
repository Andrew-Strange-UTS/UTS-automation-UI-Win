// server/utils/schedulerService.js
// Probing and recovery for the standalone scheduler service.
//
// The service owns schedule storage and execution, so when it is down no user
// sees any schedules. Rather than telling people to run a command by hand, try
// to start it and re-probe.

const { exec } = require("child_process");
const os = require("os");

const SCHEDULER_URL = process.env.UTS_SCHEDULER_URL || "http://localhost:5050";

// Service identifiers as registered by the install scripts.
const WIN_SERVICE_DISPLAY_NAME = "Marvin Scheduler"; // scripts/install-service-win.js
const LINUX_SERVICE_NAME = "uts-scheduler"; // scripts/install-service-linux.sh

const PROBE_TIMEOUT_MS = 3000;
const START_TIMEOUT_MS = 15000;
// How long the service may take to bind its port after the start command
// returns. Bounded so a wedged service cannot hang startup.
const POST_START_GRACE_MS = 5000;
const POST_START_POLL_MS = 500;

// Why the service is unavailable. The distinction drives what we tell the user:
// "not installed" needs a one-off install, "permissions" needs an admin, and
// "will not start" means the service is registered but broken.
const Reason = {
  RUNNING: "running",
  NOT_INSTALLED: "not-installed",
  PERMISSION_DENIED: "permission-denied",
  WILL_NOT_START: "will-not-start",
  UNKNOWN: "unknown",
};

function probe(timeoutMs = PROBE_TIMEOUT_MS) {
  return (async () => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(`${SCHEDULER_URL}/api/health`, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) {
        return { ok: false, detail: `Service returned HTTP ${res.status}` };
      }
      const data = await res.json();
      return { ok: true, data };
    } catch (err) {
      return { ok: false, detail: `Service not running on ${SCHEDULER_URL}` };
    }
  })();
}

function run(command, timeoutMs = START_TIMEOUT_MS) {
  return new Promise((resolve) => {
    exec(command, { timeout: timeoutMs, windowsHide: true }, (err, stdout, stderr) => {
      resolve({
        ok: !err,
        code: err ? err.code : 0,
        output: `${stdout || ""}${stderr || ""}`.trim(),
      });
    });
  });
}

// Classify a failed start from the command output. Service tooling reports
// these as text rather than distinct exit codes, so matching strings is the
// available option.
function classifyFailure(output) {
  const text = (output || "").toLowerCase();

  if (
    text.includes("cannot find any service") ||
    text.includes("does not exist") ||
    text.includes("no service with name") ||
    text.includes("not found") ||
    text.includes("could not be found")
  ) {
    return Reason.NOT_INSTALLED;
  }

  if (
    text.includes("access is denied") ||
    text.includes("access denied") ||
    text.includes("permission denied") ||
    text.includes("requires elevation") ||
    text.includes("authentication is required") ||
    text.includes("insufficient privilege")
  ) {
    return Reason.PERMISSION_DENIED;
  }

  return Reason.WILL_NOT_START;
}

function startCommand() {
  if (os.platform() === "win32") {
    // -DisplayName because node-windows registers the service under a derived
    // internal name, while the display name is what the install script sets.
    return (
      `powershell -NoProfile -NonInteractive -Command ` +
      `"Start-Service -DisplayName '${WIN_SERVICE_DISPLAY_NAME}' -ErrorAction Stop"`
    );
  }
  return `systemctl start ${LINUX_SERVICE_NAME}`;
}

// Try to start the service, then re-probe. Never throws: the caller is a health
// check and must always produce a result.
async function attemptStart() {
  const result = await run(startCommand());

  if (!result.ok) {
    return {
      started: false,
      reason: classifyFailure(result.output),
      output: result.output,
    };
  }

  // The start command can return before the port is listening.
  const deadline = Date.now() + POST_START_GRACE_MS;
  for (;;) {
    const health = await probe(1000);
    if (health.ok) {
      return { started: true, reason: Reason.RUNNING, data: health.data };
    }
    if (Date.now() >= deadline) {
      return {
        started: false,
        reason: Reason.WILL_NOT_START,
        output: "The service start command succeeded but the service is not responding.",
      };
    }
    await new Promise((r) => setTimeout(r, POST_START_POLL_MS));
  }
}

// Every schedules request hitting a dead service would otherwise trigger its own
// start attempt. Throttle so a genuinely broken service is tried occasionally,
// not once per request.
const ATTEMPT_COOLDOWN_MS = 30000;
let lastAttemptAt = 0;

async function attemptStartThrottled() {
  const since = Date.now() - lastAttemptAt;
  if (lastAttemptAt && since < ATTEMPT_COOLDOWN_MS) {
    return { started: false, reason: Reason.UNKNOWN, throttled: true };
  }
  lastAttemptAt = Date.now();
  return attemptStart();
}

function hintFor(reason) {
  const isWindows = os.platform() === "win32";

  switch (reason) {
    case Reason.NOT_INSTALLED:
      return isWindows
        ? "The scheduler service is not installed. From an elevated prompt run: node scripts\\install-service-win.js"
        : "The scheduler service is not installed. Run: sudo bash scripts/install-service-linux.sh";
    case Reason.PERMISSION_DENIED:
      return isWindows
        ? "The scheduler service is installed but Marvin does not have permission to start it. Ask an administrator to start the 'Marvin Scheduler' service, or set it to start automatically."
        : "The scheduler service is installed but could not be started without elevation. Run: sudo systemctl start uts-scheduler";
    case Reason.WILL_NOT_START:
      return isWindows
        ? "The scheduler service is installed but will not start. Check the Windows Event Viewer, or run it in the foreground to see the error: node server\\scheduler-service.js"
        : "The scheduler service is installed but will not start. Check: sudo journalctl -u uts-scheduler -n 50";
    default:
      return isWindows
        ? "Start the scheduler service: run `node scripts\\install-service-win.js` (one-off) or `node server\\scheduler-service.js`."
        : "Start the scheduler service: `sudo bash scripts/install-service-linux.sh` or `node server/scheduler-service.js`.";
  }
}

// Probe, and if the service is down try once to start it before reporting.
async function checkWithRecovery() {
  const first = await probe();
  if (first.ok) {
    return {
      ok: true,
      version: `uptime ${Math.floor(first.data.uptime)}s`,
      detail: `${first.data.schedules} schedule(s) loaded`,
    };
  }

  const attempt = await attemptStart();
  if (attempt.started) {
    return {
      ok: true,
      version: `uptime ${Math.floor(attempt.data.uptime)}s`,
      detail: `${attempt.data.schedules} schedule(s) loaded (service was started automatically)`,
      autoStarted: true,
    };
  }

  return {
    ok: false,
    detail: first.detail,
    reason: attempt.reason,
    hint: hintFor(attempt.reason),
    attempted: true,
    attemptOutput: attempt.output || undefined,
  };
}

module.exports = {
  SCHEDULER_URL,
  Reason,
  probe,
  attemptStart,
  attemptStartThrottled,
  checkWithRecovery,
  hintFor,
  classifyFailure,
};
