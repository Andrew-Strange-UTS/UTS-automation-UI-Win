// The "Test session" button's route (EPEA-TBD-18 AC2), over real HTTP: the
// backend proxies to the scheduler service, which is the only process allowed
// to start a session. The service here is a stand-in that answers like the
// real one.

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const express = require("express");

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}

async function setup(handler) {
  const upstream = http.createServer(handler);
  const upstreamPort = await listen(upstream);
  process.env.UTS_SCHEDULER_URL = `http://127.0.0.1:${upstreamPort}`;
  for (const key of Object.keys(require.cache)) {
    if (key.includes("routes/health") || key.includes("utils/schedulerService")) delete require.cache[key];
  }
  const app = express();
  app.use("/api/health", require("./health"));
  const backend = http.createServer(app);
  const port = await listen(backend);
  return {
    url: `http://127.0.0.1:${port}/api/health/session-test`,
    close: () => { upstream.close(); backend.close(); },
  };
}

test("EPEA-TBD-18 AC2: Test session reaches the service and returns its result", async () => {
  let seen = null;
  const env = await setup((req, res) => {
    seen = `${req.method} ${req.url}`;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: true, sessionId: 4, readySeconds: 21, loggedOff: true }));
  });
  try {
    const res = await fetch(env.url, { method: "POST" });
    const body = await res.json();
    assert.equal(seen, "POST /api/session/test");
    assert.equal(res.status, 200);
    assert.deepEqual(body, { ok: true, sessionId: 4, readySeconds: 21, loggedOff: true });
  } finally {
    env.close();
  }
});

test("EPEA-TBD-18 AC2: a failed session start is passed through with its reason and fix", async () => {
  const env = await setup((req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: false, reason: "rdp-denied", cause: "not allowed", hint: "grant it" }));
  });
  try {
    const body = await (await fetch(env.url, { method: "POST" })).json();
    assert.equal(body.ok, false);
    assert.equal(body.reason, "rdp-denied");
    assert.equal(body.hint, "grant it");
  } finally {
    env.close();
  }
});

test("EPEA-TBD-18 AC2: an unreadable answer from the service is a failure, not a pass", async () => {
  const env = await setup((req, res) => {
    res.statusCode = 500;
    res.end("<html>oops</html>");
  });
  try {
    const res = await fetch(env.url, { method: "POST" });
    const body = await res.json();
    assert.equal(res.status, 502);
    assert.equal(body.ok, false);
    assert.match(body.cause, /HTTP 500/);
  } finally {
    env.close();
  }
});

test("EPEA-TBD-18 AC2: a service that is not running is reported as unreachable", async () => {
  const env = await setup(() => {});
  env.close();
  // Point at a port nothing listens on.
  process.env.UTS_SCHEDULER_URL = "http://127.0.0.1:1";
  for (const key of Object.keys(require.cache)) {
    if (key.includes("routes/health") || key.includes("utils/schedulerService")) delete require.cache[key];
  }
  const app = express();
  app.use("/api/health", require("./health"));
  const backend = http.createServer(app);
  const port = await listen(backend);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health/session-test`, { method: "POST" });
    const body = await res.json();
    assert.equal(res.status, 502);
    assert.match(body.cause, /could not be reached/);
  } finally {
    backend.close();
  }
});
