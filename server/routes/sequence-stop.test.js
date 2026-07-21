// server/routes/sequence-stop.test.js
// Run: node --test server/routes/sequence-stop.test.js
//
// Covers stopping an interactive run end to end against a real child process,
// so the thing under test is actual process termination rather than a mock.

const test = require("node:test");
const assert = require("node:assert");
const express = require("express");
const { spawn } = require("child_process");

const sequenceRouter = require("./sequence");

function startServer() {
  const app = express();
  app.use(express.json());
  app.use("/api/sequence", sequenceRouter);
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve({ server, port: server.address().port }));
  });
}

async function post(port, path, body) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

test("stopping with nothing running is a no-op, not an error", async () => {
  const { server, port } = await startServer();
  try {
    const res = await post(port, "/api/sequence/stop", {});
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.stopped, 0);
  } finally {
    server.close();
  }
});

test("stopping an unknown run id is a no-op", async () => {
  const { server, port } = await startServer();
  try {
    const res = await post(port, "/api/sequence/stop", { runId: "does-not-exist" });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.stopped, 0);
  } finally {
    server.close();
  }
});

// The stop path itself, exercised directly against a long-running process.
// A sequence run needs a compiled test folder, so drive stopChild's contract
// rather than standing up a whole run.
test("stopChild terminates the runner and marks it a user stop", async () => {
  const { stopChild } = sequenceRouter.__test;

  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"]);
  const run = { child, stoppedByUser: false };

  const exited = new Promise((resolve) => child.on("exit", resolve));
  assert.strictEqual(stopChild(run), true);
  await exited;

  // The flag is what makes the log say "Stopped by user" rather than
  // reporting a failure exit code.
  assert.strictEqual(run.stoppedByUser, true);
  assert.ok(child.exitCode !== null || child.signalCode !== null, "process must be gone");
});

test("stopChild on an already-exited run is a no-op", async () => {
  const { stopChild } = sequenceRouter.__test;

  const child = spawn(process.execPath, ["-e", ""]);
  await new Promise((resolve) => child.on("exit", resolve));

  const run = { child, stoppedByUser: false };
  assert.strictEqual(stopChild(run), false);
  assert.strictEqual(run.stoppedByUser, false, "a finished run was not stopped by the user");
});

test("stop with no runId stops every active run", async () => {
  const { activeRuns } = sequenceRouter.__test;
  const { server, port } = await startServer();

  const children = [
    spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"]),
    spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"]),
  ];
  const runs = children.map((child) => ({ child, stoppedByUser: false }));
  activeRuns.set("run-a", runs[0]);
  activeRuns.set("run-b", runs[1]);

  try {
    const exits = children.map((c) => new Promise((resolve) => c.on("exit", resolve)));
    const res = await post(port, "/api/sequence/stop", {});

    assert.strictEqual(res.body.stopped, 2, "a bare stop is a stop-everything");
    await Promise.all(exits);
    assert.ok(runs.every((r) => r.stoppedByUser));
  } finally {
    activeRuns.delete("run-a");
    activeRuns.delete("run-b");
    for (const c of children) { try { c.kill("SIGKILL"); } catch {} }
    server.close();
  }
});

test("stop with a runId leaves other runs alone", async () => {
  const { activeRuns } = sequenceRouter.__test;
  const { server, port } = await startServer();

  const target = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"]);
  const other = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"]);
  const targetRun = { child: target, stoppedByUser: false };
  const otherRun = { child: other, stoppedByUser: false };
  activeRuns.set("target", targetRun);
  activeRuns.set("other", otherRun);

  try {
    const targetExit = new Promise((resolve) => target.on("exit", resolve));
    const res = await post(port, "/api/sequence/stop", { runId: "target" });

    assert.strictEqual(res.body.stopped, 1);
    await targetExit;

    assert.strictEqual(otherRun.stoppedByUser, false);
    assert.strictEqual(other.exitCode, null, "the other run must still be running");
  } finally {
    activeRuns.delete("target");
    activeRuns.delete("other");
    for (const c of [target, other]) { try { c.kill("SIGKILL"); } catch {} }
    server.close();
  }
});

test("a killed runner exits promptly", async () => {
  // Guards the assumption the stop path relies on: killing the runner ends it
  // quickly, so the stream can close and the UI return to idle.
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"]);
  const started = Date.now();
  const exited = new Promise((resolve) => child.on("exit", resolve));

  child.kill();
  await exited;

  assert.ok(Date.now() - started < 2000, "runner should exit well within the 2s force window");
});
