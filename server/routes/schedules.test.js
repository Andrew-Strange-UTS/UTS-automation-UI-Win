// server/routes/schedules.test.js
// Run: node --test server/routes/schedules.test.js
//
// Black box: a real Express app with the real router, talking real HTTP to a
// stub standing in for the scheduler service. Nothing reaches past the seam the
// renderer uses, so a green test here cannot be guarding a dead code path.

const test = require("node:test");
const { before, after } = require("node:test");
const assert = require("node:assert");
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");

let upstream;          // stands in for the scheduler service on :5050
let upstreamHandler;   // swapped per test
let app;               // the Electron backend under test
let appUrl;
let dataDir;

function startServer(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}

before(async () => {
  // Isolate the per-user data dir before ../secrets is required: requiring it
  // creates the secrets file.
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "marvin-schedules-test-"));
  process.env.UTS_DATA_DIR = dataDir;

  upstream = http.createServer((req, res) => upstreamHandler(req, res));
  const upstreamPort = await startServer(upstream);
  process.env.UTS_SCHEDULER_URL = `http://127.0.0.1:${upstreamPort}`;

  // Required only now, so it picks up the stub's URL.
  const express = require("express");
  const schedulesRouter = require("./schedules");
  const server = express();
  server.use(express.json({ limit: "50mb" }));
  server.use("/api/schedules", schedulesRouter);
  app = http.createServer(server);
  const appPort = await startServer(app);
  appUrl = `http://127.0.0.1:${appPort}`;
});

after(async () => {
  await new Promise((r) => upstream.close(r));
  await new Promise((r) => app.close(r));
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function createBody(sequence = []) {
  return {
    name: "probe",
    time: "09:00",
    days: ["mon"],
    sequencePayload: { sequence },
  };
}

function post(body) {
  return fetch(`${appUrl}/api/schedules`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("an HTML error page from the service is reported as an upstream fault, not as the service being down", async () => {
  // The real failure: a healthy service threw EPERM on schedules.json, Express
  // answered with its HTML error page, and the proxy told the user the service
  // was not running.
  upstreamHandler = (req, res) => {
    res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
    res.end(
      "<!DOCTYPE html><html><head><title>Error</title></head><body><pre>Error: EPERM: " +
        "operation not permitted, open &#39;C:\\ProgramData\\uts-automation\\schedules.json&#39;" +
        "<br> &nbsp; at saveSchedules</pre></body></html>"
    );
  };

  const res = await post(createBody());
  const body = await res.json();

  assert.strictEqual(res.status, 502);
  assert.match(body.error, /returned a response Marvin could not read/);
  assert.doesNotMatch(body.error, /not running/, "a reachable service is never reported as down");
  assert.match(body.detail, /HTTP 500/);
  assert.match(body.detail, /EPERM/, "the real cause has to survive into the message");
  assert.ok(body.hint, "the user is told where to look");
});

test("a JSON error from the service is passed through untouched", async () => {
  upstreamHandler = (req, res) => {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "time must be in HH:MM format" }));
  };

  const res = await post(createBody());
  const body = await res.json();

  assert.strictEqual(res.status, 400);
  assert.strictEqual(body.error, "time must be in HH:MM format");
});

test("a successful create is proxied through with the bundled payload", async () => {
  let received = null;
  upstreamHandler = (req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      received = JSON.parse(raw);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ id: "abc12345", name: received.name }));
    });
  };

  const res = await post(createBody([{ builtin: "default-test", name: "default-test" }]));
  const body = await res.json();

  assert.strictEqual(res.status, 200);
  assert.strictEqual(body.id, "abc12345");
  assert.ok(received.bundledSecrets, "secrets are bundled locally before forwarding");
  assert.ok(received.bundledTestCode, "test code is bundled locally before forwarding");
});

test("a local bundling failure names the test and never blames the service", async (t) => {
  if (process.getuid && process.getuid() === 0) {
    // Root ignores the mode bits, so the unreadable directory cannot be staged.
    return t.skip("cannot stage an unreadable directory as root");
  }

  // An unreadable images/ folder threw inside the bundling loop and was
  // reported as "Scheduler service is not running".
  const testDir = path.join(dataDir, "repo", "tests", "locked-test");
  const imagesDir = path.join(testDir, "images");
  fs.mkdirSync(imagesDir, { recursive: true });
  fs.writeFileSync(path.join(testDir, "run.js"), "// test");
  fs.writeFileSync(path.join(imagesDir, "button.png"), "x");
  fs.chmodSync(imagesDir, 0o000);

  let upstreamWasCalled = false;
  upstreamHandler = (req, res) => {
    upstreamWasCalled = true;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end("{}");
  };

  try {
    const res = await post(createBody([{ name: "locked-test" }]));
    const body = await res.json();

    assert.strictEqual(res.status, 500);
    assert.match(body.error, /locked-test/, "the failing test is named");
    assert.doesNotMatch(body.error, /not running/);
    assert.match(body.detail, /EACCES|EPERM/);
    assert.strictEqual(upstreamWasCalled, false, "nothing is sent when bundling failed");
  } finally {
    fs.chmodSync(imagesDir, 0o700);
  }
});
