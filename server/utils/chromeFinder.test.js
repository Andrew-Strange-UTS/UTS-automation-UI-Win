// server/utils/chromeFinder.test.js
const test = require("node:test");
const assert = require("node:assert");

const { buildHeadlessUserAgent, getHeadlessUserAgent } = require("./chromeFinder");

test("headless User-Agent never advertises HeadlessChrome", () => {
  for (const platform of ["win32", "darwin", "linux"]) {
    const ua = buildHeadlessUserAgent("140.0.7339.80", platform);
    assert.ok(!/headless/i.test(ua), `UA still looks headless: ${ua}`);
  }
  assert.ok(!/headless/i.test(getHeadlessUserAgent()));
});

test("uses the installed Chrome's major version", () => {
  const ua = buildHeadlessUserAgent("126.0.6478.127", "win32");
  assert.match(ua, /Chrome\/126\.0\.0\.0 Safari\/537\.36$/);
});

test("falls back to a plausible version when Chrome's version is unknown", () => {
  for (const version of [null, undefined, "installed", ""]) {
    const ua = buildHeadlessUserAgent(version, "win32");
    assert.match(ua, /Chrome\/\d+\.0\.0\.0 Safari\/537\.36$/);
  }
});

test("uses the platform token matching the host OS", () => {
  assert.match(buildHeadlessUserAgent("140.0.0.0", "win32"), /\(Windows NT 10\.0; Win64; x64\)/);
  assert.match(buildHeadlessUserAgent("140.0.0.0", "darwin"), /\(Macintosh; Intel Mac OS X/);
  assert.match(buildHeadlessUserAgent("140.0.0.0", "linux"), /\(X11; Linux x86_64\)/);
});
