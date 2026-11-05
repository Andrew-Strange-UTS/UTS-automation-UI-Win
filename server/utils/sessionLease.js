// server/utils/sessionLease.js
// One automation session, opened when a desktop run needs it and logged off
// when nothing does (EPEA-TBD-17).
//
// The VM is not allowed to sit signed in with autologon, so there is no session
// between runs. A desktop run takes a lease; the first lease starts the
// session, the last release logs it off. Overlapping schedules share one
// session, because the scheduler runs schedules independently and two desktop
// sequences can be due at the same minute.
//
// How a session is started and stopped is injected, so this file knows nothing
// about RDP or PowerShell and can be tested anywhere.

const { EventEmitter } = require("events");
const { PassThrough } = require("stream");

const State = Object.freeze({
  IDLE: "idle",
  STARTING: "starting",
  UP: "up",
  STOPPING: "stopping",
});

// start()  -> Promise<{ ok: true, sessionId, ... } | { ok: false, reason, cause, hint }>
// logoff(session | null) -> Promise<{ ok, ... }>. null means "whatever is
//   there": a leftover from a crash or reboot mid-run, which nothing in this
//   process knows the details of.
function createSessionLease({ start, logoff, log = () => {} } = {}) {
  if (typeof start !== "function" || typeof logoff !== "function") {
    throw new Error("createSessionLease needs start and logoff functions");
  }

  let state = State.IDLE;
  let holders = 0;
  let current = null;
  let startPromise = null;
  let stopPromise = null;

  async function safeLogoff(session) {
    try {
      const result = await logoff(session);
      if (result && result.ok === false) {
        log(`Logoff did not complete: ${result.cause || result.reason || "unknown reason"}`);
      }
      return result || { ok: true };
    } catch (err) {
      log(`Logoff failed: ${err.message}`);
      return { ok: false, reason: "logoff-failed", cause: err.message };
    }
  }

  function beginStop(session) {
    state = State.STOPPING;
    stopPromise = safeLogoff(session).finally(() => {
      current = null;
      state = State.IDLE;
      stopPromise = null;
    });
    return stopPromise;
  }

  function beginStart() {
    state = State.STARTING;
    startPromise = (async () => {
      // Anything the account has open was not started by this process (a
      // crash, or a reboot mid-run), and an RDP logon would reconnect to it
      // rather than give us a clean desktop. So clear it first, every time.
      await safeLogoff(null);

      let result;
      try {
        result = await start();
      } catch (err) {
        result = { ok: false, reason: "start-failed", cause: err.message };
      }

      if (!result || !result.ok) {
        // A failed start can still leave a half-built session behind.
        await beginStop(result && result.sessionId != null ? result : null);
        throw result || { ok: false, reason: "start-failed", cause: "The session start returned nothing." };
      }

      current = result;
      state = State.UP;
      return result;
    })().finally(() => {
      startPromise = null;
    });
    return startPromise;
  }

  async function ensureUp() {
    for (;;) {
      if (state === State.UP) return current;
      if (state === State.STARTING) return startPromise;
      if (state === State.STOPPING) {
        // Logging off and starting again is slower than reusing, but a session
        // that is half logged off cannot be reused.
        await stopPromise;
        continue;
      }
      return beginStart();
    }
  }

  // Resolves to { ok: true, session, release } or to the failure. A failure
  // holds nothing, so there is nothing to release.
  async function acquire() {
    holders++;
    let session;
    try {
      session = await ensureUp();
    } catch (failure) {
      holders--;
      return { ok: false, ...(failure && typeof failure === "object" ? failure : { cause: String(failure) }) };
    }

    let released = false;
    const release = async () => {
      if (released) return { loggedOff: false, sharedWith: holders };
      released = true;
      holders--;
      if (holders > 0 || state !== State.UP) {
        return { loggedOff: false, sharedWith: holders };
      }
      const result = await beginStop(current);
      return { loggedOff: true, result };
    };

    return { ok: true, session, release };
  }

  // Service startup: whatever the account has open was left by an earlier
  // process, which cannot have logged it off (EPEA-TBD-17 AC6).
  async function sweep() {
    if (holders > 0 || state !== State.IDLE) return { swept: false };
    const result = await beginStop(null);
    return { swept: true, result };
  }

  function snapshot() {
    return {
      state,
      holders,
      sessionId: current ? current.sessionId : null,
    };
  }

  return { acquire, sweep, snapshot };
}

// A desktop run that takes a lease first, shaped like the child_process the
// scheduler already drives: .stdout, .stderr, "close", "error", .kill() and
// .pid. The run log gets a line for each lifecycle step, so whoever reads a
// failed run can see whether the session or the test was the problem.
function runWithLease({ lease, startRun, now = () => Date.now() } = {}) {
  const emitter = new EventEmitter();
  emitter.stdout = new PassThrough();
  emitter.stderr = new PassThrough();

  let child = null;
  let killed = false;
  let release = null;
  let closed = false;

  Object.defineProperty(emitter, "pid", {
    get: () => (child ? child.pid : undefined),
    enumerable: true,
  });

  const finish = async (code) => {
    if (closed) return;
    closed = true;
    if (release) {
      try {
        const outcome = await release();
        if (outcome.loggedOff) {
          emitter.stdout.write(
            outcome.result && outcome.result.ok === false
              ? `Automation session logoff failed: ${outcome.result.cause || outcome.result.reason}\n`
              : "Automation session logged off.\n"
          );
        } else {
          emitter.stdout.write(`Automation session left open for ${outcome.sharedWith} other run(s).\n`);
        }
      } catch (err) {
        emitter.stdout.write(`Automation session logoff failed: ${err.message}\n`);
      }
    }
    emitter.emit("close", code);
  };

  emitter.kill = () => {
    killed = true;
    if (child) child.kill();
  };

  (async () => {
    const began = now();
    emitter.stdout.write("Starting the automation session...\n");
    const lease_ = await lease.acquire();

    if (!lease_.ok) {
      emitter.stderr.write(
        `Could not start the automation session: ${lease_.cause || lease_.reason || "unknown reason"}\n` +
          (lease_.hint ? `${lease_.hint}\n` : "")
      );
      await finish(1);
      return;
    }

    release = lease_.release;
    if (killed) {
      emitter.stdout.write("Stopped before the run started.\n");
      await finish(1);
      return;
    }

    const seconds = Math.round((now() - began) / 1000);
    emitter.stdout.write(`Automation session ${lease_.session.sessionId} ready after ${seconds}s.\n`);

    try {
      child = startRun(lease_.session);
    } catch (err) {
      emitter.stderr.write(`The run could not be started: ${err.message}\n`);
      await finish(1);
      return;
    }

    child.stdout.pipe(emitter.stdout, { end: false });
    child.stderr.pipe(emitter.stderr, { end: false });
    child.on("error", (err) => emitter.emit("error", err));
    child.on("close", (code) => finish(code));
  })().catch(async (err) => {
    emitter.stderr.write(`The automation session could not be managed: ${err.message}\n`);
    await finish(1);
  });

  return emitter;
}

module.exports = { State, createSessionLease, runWithLease };
