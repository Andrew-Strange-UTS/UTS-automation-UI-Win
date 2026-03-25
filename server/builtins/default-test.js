// server/builtins/default-test.js
// Built-in default test: navigates to the UTS Course Handbook and
// verifies the UTS logo image is present on the page.

const { By } = require("selenium-webdriver");

function log(msg) {
  process.stdout.write(`${msg}\n`);
}

module.exports = async function (driver, parameters = {}, zephyrLog) {
  if (typeof zephyrLog !== "function") zephyrLog = function () {};

  try {
    log("🌏 Navigating to https://coursehandbook.uts.edu.au/");
    await driver.get("https://coursehandbook.uts.edu.au/");
    await driver.sleep(2000);

    log("🔎 Looking for UTS logo image...");
    const found = await driver.wait(async () => {
      const logos = await driver.findElements(
        By.css('img[alt="University of Technology Sydney"]')
      );
      return logos.length > 0;
    }, 10000);

    if (!found) {
      throw new Error("UTS logo image not found on page.");
    }

    log("✅ PASS: UTS logo is present and visible.");
    zephyrLog("Navigated to coursehandbook.uts.edu.au — UTS logo is present and visible.", "Pass");
  } catch (err) {
    zephyrLog("FAIL: " + (err && err.message), "Fail");
    process.stderr.write(`❌ FAIL: ${err && err.message}\n`);
    throw err;
  }
};
