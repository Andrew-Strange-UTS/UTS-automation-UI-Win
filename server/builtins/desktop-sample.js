// server/builtins/desktop-sample.js
// Sample desktop test: opens Notepad, types text, verifies, then closes.
// The `driver` object provides keyboard, mouse, and window control.

function log(msg) {
  process.stdout.write(`${msg}\n`);
}

module.exports = async function (driver, parameters = {}, zephyrLog) {
  if (typeof zephyrLog !== "function") zephyrLog = function () {};

  try {
    // Step 1: Launch Notepad
    log("Launching Notepad...");
    await driver.launch("notepad.exe");
    await driver.pause(2000);
    zephyrLog("Launched Notepad successfully.", "Pass");

    // Step 2: Type some text
    log("Typing test text...");
    const testText = "Hello from UTS Windows Automation!";
    await driver.type(testText);
    await driver.pause(1000);
    zephyrLog("Typed test text into Notepad.", "Pass");

    // Step 3: Verify the window title contains "Notepad"
    log("Checking window title...");
    const title = await driver.getWindowTitle();
    if (!title.includes("Notepad")) {
      throw new Error(`Expected window title to contain 'Notepad', got: '${title}'`);
    }
    log("PASS: Window title confirmed as Notepad.");
    zephyrLog("Window title contains 'Notepad'.", "Pass");

    // Step 4: Close without saving
    log("Closing Notepad without saving...");
    await driver.closeWindow();
    await driver.pause(1000);
    // Press "Don't Save" (Alt+N on Win10/11 dialog)
    await driver.keyPress("Alt", "n");
    await driver.pause(500);
    log("PASS: Notepad closed.");
    zephyrLog("Closed Notepad without saving.", "Pass");
  } catch (err) {
    zephyrLog("FAIL: " + (err && err.message), "Fail");
    process.stderr.write(`FAIL: ${err && err.message}\n`);
    throw err;
  }
};
