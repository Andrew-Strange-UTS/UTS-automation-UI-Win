// server/runners/web-runner.test.js
const test = require("node:test");
const assert = require("node:assert");

const { getWebDriverSetupCode } = require("./web-runner");

test("headless setup overrides the User-Agent so the WAF does not block the run", () => {
  const code = getWebDriverSetupCode();
  assert.match(code, /--headless=new/);
  assert.match(code, /--user-agent=Mozilla\/5\.0 .*Chrome\/\d+\.0\.0\.0 Safari\/537\.36/);
  assert.ok(!/headlesschrome/i.test(code));
});

test("the User-Agent override only applies to headless runs", () => {
  const code = getWebDriverSetupCode();
  // Both the headless args and the User-Agent live inside the same
  // VISUAL_BROWSER guard, so a visible browser keeps its own identity.
  const guard = code.indexOf('process.env.VISUAL_BROWSER !== "true"');
  assert.ok(guard > -1);
  assert.ok(code.indexOf("--user-agent=") > guard);
  assert.ok(code.indexOf("}", code.indexOf("--user-agent=")) > -1);
});
