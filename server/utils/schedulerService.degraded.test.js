// server/utils/schedulerService.degraded.test.js
// Run: node --test server/utils/schedulerService.degraded.test.js
//
// Its own file because schedulerService reads UTS_SCHEDULER_URL once, at
// require time, and node --test gives each file its own process.

const test = require("node:test");
const { before, after } = require("node:test");
const assert = require("node:assert");
const http = require("http");

let server;
let handler;
let schedulerService;

before(async () => {
  server = http.createServer((req, res) => handler(req, res));
  const port = await new Promise((r) => server.listen(0, "127.0.0.1", () => r(server.address().port)));
  process.env.UTS_SCHEDULER_URL = `http://127.0.0.1:${port}`;
  schedulerService = require("./schedulerService");
});

after(async () => {
  await new Promise((r) => server.close(r));
});

function respond(status, body) {
  handler = (req, res) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };
}

test("a healthy service is reported as running, with its schedule count", async () => {
  respond(200, { status: "ok", uptime: 120.5, schedules: 2, dataDir: { read: true, write: true } });

  const result = await schedulerService.checkWithRecovery();

  assert.strictEqual(result.ok, true);
  assert.match(result.detail, /2 schedule\(s\) loaded/);
});

test("a service that cannot use its data directory is degraded, not down", async () => {
  // The deliberate break: this is the startup check going red. Before this, a
  // service that could not read schedules.json reported zero schedules with a
  // 200 and showed a green tick for two months.
  respond(503, {
    status: "degraded",
    uptime: 101732,
    schedules: null,
    dataDir: {
      path: "C:\\ProgramData\\uts-automation",
      read: false,
      write: false,
      failingPath: "C:\\ProgramData\\uts-automation\\schedules.json",
    },
    detail: "Cannot read C:\\ProgramData\\uts-automation\\schedules.json (EPERM).",
    hint: 'From an elevated PowerShell: takeown /F "..." /A; icacls "..." /reset',
  });

  const result = await schedulerService.checkWithRecovery();

  assert.strictEqual(result.ok, false, "a service that cannot do its job is not ok");
  assert.strictEqual(result.reason, schedulerService.Reason.DEGRADED);
  assert.match(result.detail, /EPERM/);
  assert.match(result.hint, /takeown/, "the service's own repair hint reaches the user");
});

test("no start is attempted for a service that answered the probe", async () => {
  // Starting a running service cannot fix a permissions problem, and reporting
  // "will not start" for a service with 28 hours of uptime sends people to the
  // Event Viewer for nothing.
  respond(503, { status: "degraded", uptime: 10, schedules: null, detail: "locked" });

  const result = await schedulerService.checkWithRecovery();

  assert.strictEqual(result.attempted, false);
  assert.notStrictEqual(result.reason, schedulerService.Reason.WILL_NOT_START);
});

test("a reachable service that answers with nonsense is not called degraded either", async () => {
  handler = (req, res) => {
    res.writeHead(500, { "Content-Type": "text/html" });
    res.end("<!DOCTYPE html><html><body>Error</body></html>");
  };

  const result = await schedulerService.checkWithRecovery();

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.attempted, false, "it answered, so it is not down");
  assert.match(result.detail, /HTTP 500/);
});

test("the probe separates reachable from ok", async () => {
  respond(200, { status: "ok", uptime: 1, schedules: 0 });
  const healthy = await schedulerService.probe();
  assert.deepStrictEqual([healthy.ok, healthy.reachable], [true, true]);

  respond(503, { status: "degraded", detail: "locked" });
  const degraded = await schedulerService.probe();
  assert.deepStrictEqual([degraded.ok, degraded.reachable, degraded.degraded], [false, true, true]);
});
