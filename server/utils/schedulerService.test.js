// server/utils/schedulerService.test.js
// Run: node --test server/utils/schedulerService.test.js

const test = require("node:test");
const assert = require("node:assert");

const { Reason, classifyFailure, hintFor } = require("./schedulerService");

test("classifies a missing service as not-installed", () => {
  // Windows: Start-Service when no such service is registered
  assert.strictEqual(
    classifyFailure(
      "Start-Service : Cannot find any service with service name 'Marvin Scheduler'."
    ),
    Reason.NOT_INSTALLED
  );

  // systemd equivalent
  assert.strictEqual(
    classifyFailure("Failed to start uts-scheduler.service: Unit uts-scheduler.service not found."),
    Reason.NOT_INSTALLED
  );
});

test("classifies an elevation failure as permission-denied", () => {
  assert.strictEqual(
    classifyFailure("Start-Service : Service 'Marvin Scheduler' cannot be started. Access is denied"),
    Reason.PERMISSION_DENIED
  );

  assert.strictEqual(
    classifyFailure("Failed to start uts-scheduler.service: Interactive authentication is required."),
    Reason.PERMISSION_DENIED
  );
});

test("classifies anything else as will-not-start", () => {
  assert.strictEqual(
    classifyFailure("The service did not respond to the start or control request in a timely fashion."),
    Reason.WILL_NOT_START
  );
});

test("classification is case insensitive and tolerates empty output", () => {
  assert.strictEqual(classifyFailure("ACCESS IS DENIED"), Reason.PERMISSION_DENIED);
  assert.strictEqual(classifyFailure(""), Reason.WILL_NOT_START);
  assert.strictEqual(classifyFailure(undefined), Reason.WILL_NOT_START);
});

test("not-installed is checked before permission-denied", () => {
  // A "cannot find" message that also mentions denial must not be misreported as
  // a permissions problem, or the user is sent to an admin instead of installing.
  assert.strictEqual(
    classifyFailure("Cannot find any service with service name 'Marvin Scheduler'. Access is denied."),
    Reason.NOT_INSTALLED
  );
});

test("each reason produces a distinct, actionable hint", () => {
  const reasons = [Reason.NOT_INSTALLED, Reason.PERMISSION_DENIED, Reason.WILL_NOT_START];
  const hints = reasons.map(hintFor);

  for (const hint of hints) {
    assert.ok(hint && hint.length > 0, "hint must not be empty");
  }
  assert.strictEqual(new Set(hints).size, reasons.length, "hints must differ per reason");

  assert.match(hintFor(Reason.NOT_INSTALLED), /install-service/);
  assert.match(hintFor(Reason.PERMISSION_DENIED), /administrator|sudo/i);
});
