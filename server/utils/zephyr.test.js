// server/utils/zephyr.test.js
// Unit tests for the Zephyr execution payload builder (EPEA-3469 / EPEA-2692).
// Run with: node --test

const { test } = require("node:test");
const assert = require("node:assert");
const { buildExecutionPayload } = require("./zephyr");

const base = {
  projectKey: "EPEA",
  testCaseKey: "EPEA-T1",
  testCycleKey: "EPEA-C1",
  statusName: "Pass",
};

test("carries the core execution fields", () => {
  const p = buildExecutionPayload(base);
  assert.equal(p.projectKey, "EPEA");
  assert.equal(p.testCaseKey, "EPEA-T1");
  assert.equal(p.testCycleKey, "EPEA-C1");
  assert.equal(p.statusName, "Pass");
});

test("EPEA-3469: an account id sets both native identity fields", () => {
  const p = buildExecutionPayload({ ...base, accountId: "5b10ac8d82e05b22cc7d4ef5", executedBy: "Jane Smith" });
  assert.equal(p.executedById, "5b10ac8d82e05b22cc7d4ef5");
  assert.equal(p.assignedToId, "5b10ac8d82e05b22cc7d4ef5");
});

test("EPEA-3469: an account id suppresses the fallback comment line", () => {
  const p = buildExecutionPayload({ ...base, accountId: "acct-123", executedBy: "Jane Smith" });
  assert.equal(p.comment, undefined);
});

test("account id is trimmed before use", () => {
  const p = buildExecutionPayload({ ...base, accountId: "  acct-123  " });
  assert.equal(p.executedById, "acct-123");
  assert.equal(p.assignedToId, "acct-123");
});

test("EPEA-2692 fallback: no account id records the name in the comment", () => {
  const p = buildExecutionPayload({ ...base, executedBy: "Jane Smith" });
  assert.equal(p.executedById, undefined);
  assert.equal(p.assignedToId, undefined);
  assert.equal(p.comment, "Executed by: Jane Smith");
});

test("a blank/whitespace account id is treated as absent (falls back)", () => {
  const p = buildExecutionPayload({ ...base, accountId: "   ", executedBy: "Jane Smith" });
  assert.equal(p.executedById, undefined);
  assert.equal(p.assignedToId, undefined);
  assert.equal(p.comment, "Executed by: Jane Smith");
});

test("fallback name line is combined with an explicit comment", () => {
  const p = buildExecutionPayload({ ...base, executedBy: "Jane Smith", comment: "Nightly run" });
  assert.equal(p.comment, "Executed by: Jane Smith\nNightly run");
});

test("no identity and no comment omits the comment field entirely", () => {
  const p = buildExecutionPayload(base);
  assert.equal(p.comment, undefined);
});

test("per-step results are included when present and omitted when empty", () => {
  const withSteps = buildExecutionPayload({ ...base, testScriptResults: [{ statusName: "Pass", actualResult: "ok" }] });
  assert.equal(withSteps.testScriptResults.length, 1);
  const noSteps = buildExecutionPayload({ ...base, testScriptResults: [] });
  assert.equal(noSteps.testScriptResults, undefined);
});
