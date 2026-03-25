// server/builtins/okta-login.js
// Built-in OKTA login step. Navigates to the given OKTA URL and polls
// until the user has authenticated (dashboard search input appears).
// The oktaUrl is passed via parameters.oktaUrl by the sequence runner.

const { By } = require("selenium-webdriver");

function log(msg) {
  process.stdout.write(`${msg}\n`);
}

module.exports = async function (driver, parameters = {}) {
  const oktaUrl = parameters.oktaUrl || "https://login.uts.edu.au";
  const timeoutMs = 60000;
  const pollInterval = 2000;

  log("🔐 OKTA Login starting...");
  log(`🌐 Navigating to ${oktaUrl}`);

  try {
    await driver.get(oktaUrl);

    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      log("⏳ Waiting for user login...");
      try {
        const searchInputs = await driver.findElements(
          By.id("dashboard-search-input")
        );
        if (searchInputs.length > 0) {
          log("✅ Login successful: dashboard search input detected.");
          return;
        }
      } catch (err) {
        process.stderr.write(`⚠️ Poll error: ${err.message}\n`);
      }
      await driver.sleep(pollInterval);
    }

    throw new Error(
      "Login failed: dashboard search input not detected within timeout."
    );
  } catch (err) {
    process.stderr.write(`🔥 OKTA Login error: ${err.message}\n`);
    throw err;
  }
};
