const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("events");
const { PassThrough } = require("stream");
const { createSessionLease, runWithLease, State } = require("./sessionLease");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const tick = () => new Promise((r) => setImmediate(r));

// A fake machine: records every start and logoff, and can be told to fail.
function fakeMachine({ startResult } = {}) {
  const calls = [];
  let next = 10;
  return {
    calls,
    start: async () => {
      calls.push("start");
      if (startResult) return startResult;
      return { ok: true, sessionId: next++, clientPid: 900 };
    },
    logoff: async (session) => {
      calls.push(session ? `logoff:${session.sessionId}` : "logoff:any");
      return { ok: true };
    },
  };
}

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.pid = 4242;
  child.killed = false;
  child.kill = () => { child.killed = true; };
  return child;
}

function collect(stream) {
  let text = "";
  stream.on("data", (c) => { text += c.toString(); });
  return () => text;
}

test("EPEA-TBD-17 AC4: the first lease clears leftovers, then starts a session", async () => {
  const m = fakeMachine();
  const lease = createSessionLease(m);
  const got = await lease.acquire();
  assert.equal(got.ok, true);
  assert.equal(got.session.sessionId, 10);
  assert.deepEqual(m.calls, ["logoff:any", "start"]);
  assert.equal(lease.snapshot().state, State.UP);
});

test("EPEA-TBD-17 AC5: the last release logs the session off", async () => {
  const m = fakeMachine();
  const lease = createSessionLease(m);
  const got = await lease.acquire();
  const outcome = await got.release();
  assert.equal(outcome.loggedOff, true);
  assert.deepEqual(m.calls, ["logoff:any", "start", "logoff:10"]);
  assert.deepEqual(lease.snapshot(), { state: State.IDLE, holders: 0, sessionId: null });
});

test("EPEA-TBD-17 AC5: releasing twice does not log off a session someone else holds", async () => {
  const m = fakeMachine();
  const lease = createSessionLease(m);
  const a = await lease.acquire();
  const b = await lease.acquire();
  await a.release();
  await a.release();
  assert.equal(lease.snapshot().holders, 1);
  assert.equal(lease.snapshot().state, State.UP);
  assert.ok(!m.calls.includes("logoff:10"));
  await b.release();
  assert.ok(m.calls.includes("logoff:10"));
});

test("EPEA-TBD-17 AC8: overlapping runs share one session, logged off after the last", async () => {
  const m = fakeMachine();
  const lease = createSessionLease(m);
  const [a, b] = await Promise.all([lease.acquire(), lease.acquire()]);
  assert.equal(a.session.sessionId, b.session.sessionId);
  assert.equal(m.calls.filter((c) => c === "start").length, 1, "only one session is started");

  const first = await a.release();
  assert.equal(first.loggedOff, false);
  assert.equal(first.sharedWith, 1);
  assert.equal(lease.snapshot().state, State.UP);

  const last = await b.release();
  assert.equal(last.loggedOff, true);
  assert.equal(lease.snapshot().state, State.IDLE);
});

test("EPEA-TBD-17 AC8: a run arriving while the session is starting waits for it rather than starting a second", async () => {
  const gate = deferred();
  const calls = [];
  const lease = createSessionLease({
    start: async () => { calls.push("start"); await gate.promise; return { ok: true, sessionId: 3 }; },
    logoff: async (s) => { calls.push(s ? `logoff:${s.sessionId}` : "logoff:any"); return { ok: true }; },
  });
  const pa = lease.acquire();
  await tick();
  assert.equal(lease.snapshot().state, State.STARTING);
  const pb = lease.acquire();
  gate.resolve();
  const [a, b] = await Promise.all([pa, pb]);
  assert.equal(a.session.sessionId, 3);
  assert.equal(b.session.sessionId, 3);
  assert.equal(calls.filter((c) => c === "start").length, 1);
});

test("EPEA-TBD-17 AC8: a run arriving during logoff waits for it, then gets a fresh session", async () => {
  const gate = deferred();
  let next = 1;
  const calls = [];
  const lease = createSessionLease({
    start: async () => { calls.push("start"); return { ok: true, sessionId: next++ }; },
    logoff: async (s) => {
      calls.push(s ? `logoff:${s.sessionId}` : "logoff:any");
      if (s && s.sessionId === 1) await gate.promise;
      return { ok: true };
    },
  });
  const a = await lease.acquire();
  const releasing = a.release();
  await tick();
  assert.equal(lease.snapshot().state, State.STOPPING);

  const pb = lease.acquire();
  await tick();
  assert.equal(calls.filter((c) => c === "start").length, 1, "does not start while the old session is logging off");
  gate.resolve();
  await releasing;
  const b = await pb;
  assert.equal(b.ok, true);
  assert.equal(b.session.sessionId, 2, "a new session, not the one being logged off");
});

test("EPEA-TBD-17 AC4: a failed start is returned with its reason, holds nothing, and is cleaned up", async () => {
  const m = fakeMachine({ startResult: { ok: false, reason: "session-timeout", cause: "No session within 90s", sessionId: 7 } });
  const lease = createSessionLease(m);
  const got = await lease.acquire();
  assert.equal(got.ok, false);
  assert.equal(got.reason, "session-timeout");
  assert.equal(got.cause, "No session within 90s");
  assert.equal(got.release, undefined);
  assert.deepEqual(lease.snapshot(), { state: State.IDLE, holders: 0, sessionId: null });
  assert.deepEqual(m.calls, ["logoff:any", "start", "logoff:7"], "the half-started session is logged off");
});

test("EPEA-TBD-17 AC4: a start that throws is reported, not left as an unhandled rejection", async () => {
  const lease = createSessionLease({
    start: async () => { throw new Error("powershell missing"); },
    logoff: async () => ({ ok: true }),
  });
  const got = await lease.acquire();
  assert.equal(got.ok, false);
  assert.equal(got.reason, "start-failed");
  assert.match(got.cause, /powershell missing/);
});

test("EPEA-TBD-17 AC4: after a failed start the next run tries again", async () => {
  let attempt = 0;
  const lease = createSessionLease({
    start: async () => (++attempt === 1 ? { ok: false, reason: "session-timeout" } : { ok: true, sessionId: 5 }),
    logoff: async () => ({ ok: true }),
  });
  assert.equal((await lease.acquire()).ok, false);
  const second = await lease.acquire();
  assert.equal(second.ok, true);
  assert.equal(second.session.sessionId, 5);
});

test("EPEA-TBD-17 AC5: a logoff that fails still leaves the lease usable, and the next start clears up first", async () => {
  const calls = [];
  let next = 1;
  const logged = [];
  const lease = createSessionLease({
    start: async () => { calls.push("start"); return { ok: true, sessionId: next++ }; },
    logoff: async (s) => {
      calls.push(s ? `logoff:${s.sessionId}` : "logoff:any");
      if (s && s.sessionId === 1) throw new Error("WTSLogoffSession failed");
      return { ok: true };
    },
    log: (m) => logged.push(m),
  });
  const a = await lease.acquire();
  const outcome = await a.release();
  assert.equal(outcome.result.ok, false);
  assert.match(logged.join("\n"), /WTSLogoffSession failed/);
  assert.equal(lease.snapshot().state, State.IDLE);

  await lease.acquire();
  assert.deepEqual(calls, ["logoff:any", "start", "logoff:1", "logoff:any", "start"]);
});

test("EPEA-TBD-17 AC6: sweep at service start logs off whatever is there", async () => {
  const m = fakeMachine();
  const lease = createSessionLease(m);
  const swept = await lease.sweep();
  assert.equal(swept.swept, true);
  assert.deepEqual(m.calls, ["logoff:any"]);
});

test("EPEA-TBD-17 AC6: sweep never logs off a session a run is using", async () => {
  const m = fakeMachine();
  const lease = createSessionLease(m);
  await lease.acquire();
  const swept = await lease.sweep();
  assert.equal(swept.swept, false);
  assert.ok(!m.calls.includes("logoff:10"));
});

// ─── runWithLease ───

test("EPEA-TBD-17 AC5: a run starts in the leased session and logs it off when it finishes", async () => {
  const m = fakeMachine();
  const lease = createSessionLease(m);
  const child = fakeChild();
  let sessionSeen = null;
  const run = runWithLease({ lease, startRun: (s) => { sessionSeen = s; return child; } });
  const out = collect(run.stdout);
  const closed = new Promise((r) => run.on("close", r));

  await tick(); await tick();
  assert.equal(sessionSeen.sessionId, 10);
  assert.equal(run.pid, 4242);
  child.stdout.write("step 1 passed\n");
  child.emit("close", 0);

  assert.equal(await closed, 0);
  assert.ok(m.calls.includes("logoff:10"), "logged off before close is reported");
  assert.match(out(), /Starting the automation session/);
  assert.match(out(), /Automation session 10 ready/);
  assert.match(out(), /step 1 passed/);
  assert.match(out(), /Automation session logged off/);
});

test("EPEA-TBD-17 AC5: a failing run still logs the session off and keeps its exit code", async () => {
  const m = fakeMachine();
  const lease = createSessionLease(m);
  const child = fakeChild();
  const run = runWithLease({ lease, startRun: () => child });
  const closed = new Promise((r) => run.on("close", r));
  await tick(); await tick();
  child.emit("close", 1);
  assert.equal(await closed, 1);
  assert.ok(m.calls.includes("logoff:10"));
});

test("EPEA-TBD-17 AC5: Stop during the run kills it and the session is still logged off", async () => {
  const m = fakeMachine();
  const lease = createSessionLease(m);
  const child = fakeChild();
  const run = runWithLease({ lease, startRun: () => child });
  const closed = new Promise((r) => run.on("close", r));
  await tick(); await tick();
  run.kill();
  assert.equal(child.killed, true);
  child.emit("close", 1);
  await closed;
  assert.ok(m.calls.includes("logoff:10"));
});

test("EPEA-TBD-17 AC5: Stop while the session is still starting never launches the run, and logs off", async () => {
  const gate = deferred();
  const calls = [];
  const lease = createSessionLease({
    start: async () => { await gate.promise; return { ok: true, sessionId: 4 }; },
    logoff: async (s) => { calls.push(s ? `logoff:${s.sessionId}` : "logoff:any"); return { ok: true }; },
  });
  let launched = false;
  const run = runWithLease({ lease, startRun: () => { launched = true; return fakeChild(); } });
  const closed = new Promise((r) => run.on("close", r));
  await tick();
  run.kill();
  gate.resolve();
  assert.equal(await closed, 1);
  assert.equal(launched, false);
  assert.ok(calls.includes("logoff:4"));
});

test("EPEA-TBD-17 AC4: a session that cannot start fails the run with the reason, not a test error", async () => {
  const m = fakeMachine({ startResult: { ok: false, reason: "rdp-denied", cause: "RDP logon refused", hint: "Grant the right" } });
  const lease = createSessionLease(m);
  let launched = false;
  const run = runWithLease({ lease, startRun: () => { launched = true; return fakeChild(); } });
  const err = collect(run.stderr);
  const code = await new Promise((r) => run.on("close", r));
  assert.equal(code, 1);
  assert.equal(launched, false);
  assert.match(err(), /Could not start the automation session: RDP logon refused/);
  assert.match(err(), /Grant the right/);
});

test("EPEA-TBD-17 AC8: two runs through the lease share the session and only the second logs off", async () => {
  const m = fakeMachine();
  const lease = createSessionLease(m);
  const c1 = fakeChild();
  const c2 = fakeChild();
  const r1 = runWithLease({ lease, startRun: () => c1 });
  const r2 = runWithLease({ lease, startRun: () => c2 });
  const o1 = collect(r1.stdout);
  const done1 = new Promise((r) => r1.on("close", r));
  const done2 = new Promise((r) => r2.on("close", r));
  await tick(); await tick(); await tick();

  c1.emit("close", 0);
  await done1;
  assert.match(o1(), /left open for 1 other run/);
  assert.ok(!m.calls.includes("logoff:10"));

  c2.emit("close", 0);
  await done2;
  assert.ok(m.calls.includes("logoff:10"));
  assert.equal(m.calls.filter((c) => c === "start").length, 1);
});
