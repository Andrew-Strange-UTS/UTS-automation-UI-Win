# Creating Tests for Marvin

## How Tests Work

Marvin loads tests from a GitHub repository. The app clones your repo and looks for a `tests/` folder at the root. Each subfolder inside `tests/` becomes a test card in the UI.

```
your-repo/
  tests/
    My-First-Test/
      run.js            <-- required: the test script
      metadata.json     <-- optional: title, parameters, description
    Login-Check/
      run.js
      metadata.json
    Another-Test/
      run.js
```

Each folder name becomes the test name shown in the UI. The app reads `run.js` (or `run.py`) and `metadata.json` from each folder.

---

## Web Tests vs Desktop Tests

Tests are **not** distinguished by their code. The **Desktop / Web toggle** in the UI controls which runner wraps your test:

- **Web mode** — Your `run.js` receives a **Selenium WebDriver** instance as `driver`. Selenium, Chrome options, and the browser lifecycle are handled for you.
- **Desktop mode** — Your `run.js` receives a **Desktop Driver** instance as `driver`. This provides keyboard, mouse, and window control via PowerShell + Windows APIs.

Your test script doesn't need to import Selenium or set up a browser — the runner does that. You just write what happens inside the test.

### Platform availability

| Test type | Windows | Ubuntu/Linux |
|---|---|---|
| Web tests | Yes | Yes |
| Desktop tests | Yes | No (requires PowerShell + Win32 APIs) |

The app's startup diagnostics screen shows which test types are available on the current machine.

---

## Prerequisites for Running Tests

### Web tests

The app auto-detects Chrome or Chromium on your system. Install one of:

**Ubuntu/Linux:**
```bash
# Google Chrome (recommended — snap Chromium has issues with Selenium)
wget -q -O /tmp/chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
sudo dpkg -i /tmp/chrome.deb
sudo apt-get -f install -y
```

**Windows:**
- Download from https://www.google.com/chrome/
- Or: `choco install googlechrome`
- Chromium also works: `choco install chromium`

ChromeDriver is auto-managed by selenium-webdriver — no manual install needed.

### Desktop tests (Windows only)

No additional install needed. PowerShell is built into Windows 10/11 and Windows Server.

---

## Test Script Format (`run.js`)

Every test exports a single async function with this signature:

```js
module.exports = async function (driver, parameters, zephyrLog) {
  // your test logic here
};
```

| Argument | Description |
|---|---|
| `driver` | The automation driver (Selenium WebDriver for web, Desktop Driver for desktop) |
| `parameters` | An object containing any user-supplied parameters + all decrypted secrets |
| `zephyrLog` | A function to log results to Zephyr Scale: `zephyrLog(description, "Pass"` or `"Fail")` |

### Logging output

Use `process.stdout.write()` or a helper `log()` function to write output that appears in the UI's log viewer:

```js
function log(msg) {
  process.stdout.write(`${msg}\n`);
}
```

Do **not** use `console.log()` for user-facing output — it writes to stderr in some contexts and may not appear in the UI logs.

### Throwing errors

If your test fails, **throw an error**. The runner catches it and marks the step as failed. Don't silently return on failure.

```js
if (!found) {
  throw new Error("Expected element not found on page.");
}
```

---

## Web Test Example

```js
const { By } = require("selenium-webdriver");

function log(msg) {
  process.stdout.write(`${msg}\n`);
}

module.exports = async function (driver, parameters = {}, zephyrLog) {
  if (typeof zephyrLog !== "function") zephyrLog = function () {};

  try {
    log("Navigating to https://example.com");
    await driver.get("https://example.com");
    await driver.sleep(2000);

    log("Looking for heading...");
    const heading = await driver.findElement(By.css("h1"));
    const text = await heading.getText();

    if (!text.includes("Example")) {
      throw new Error(`Expected heading to contain 'Example', got: '${text}'`);
    }

    log("PASS: Heading found.");
    zephyrLog("Navigated to example.com, heading is correct.", "Pass");
  } catch (err) {
    zephyrLog("FAIL: " + (err && err.message), "Fail");
    throw err;
  }
};
```

### What's available in web tests

The runner pre-imports Selenium and builds the browser for you. These are available in scope when your test runs inside a sequence:

- `By`, `Key`, `until` from `selenium-webdriver`
- `driver` — a fully initialised Chrome/Chromium WebDriver instance
- Headless by default; enable "Visual Browser" on the test card to see the browser window

You can also `require("selenium-webdriver")` yourself inside `run.js` if you need additional imports (e.g. `By`, `Key`) — the `selenium-webdriver` package is available from the server's `node_modules`.

### Browser auto-detection

The app automatically finds Chrome or Chromium on your system — no configuration needed. It checks (in order):
1. `google-chrome` / `google-chrome-stable`
2. `chromium-browser` / `chromium`
3. Standard Windows install paths (`Program Files\Google\Chrome\...`)

The detected binary is passed to Selenium automatically. The startup diagnostics screen shows which binary was found.

---

## Desktop Test Example

```js
function log(msg) {
  process.stdout.write(`${msg}\n`);
}

module.exports = async function (driver, parameters = {}, zephyrLog) {
  if (typeof zephyrLog !== "function") zephyrLog = function () {};

  try {
    log("Launching Notepad...");
    await driver.launch("notepad.exe");
    await driver.pause(2000);
    zephyrLog("Launched Notepad successfully.", "Pass");

    log("Typing test text...");
    await driver.type("Hello from Marvin!");
    await driver.pause(1000);
    zephyrLog("Typed text into Notepad.", "Pass");

    log("Closing Notepad without saving...");
    await driver.closeWindow();
    await driver.pause(1000);
    await driver.keyPress("Alt", "n");
    await driver.pause(500);
    zephyrLog("Closed Notepad without saving.", "Pass");
  } catch (err) {
    zephyrLog("FAIL: " + (err && err.message), "Fail");
    throw err;
  }
};
```

### Desktop Driver API

| Method | Description |
|---|---|
| `driver.type(text)` | Type text into the focused window using SendKeys |
| `driver.keyPress(...keys)` | Press key(s). Supports: `Enter`, `Tab`, `Escape`, `Backspace`, `Delete`, `Up`, `Down`, `Left`, `Right`, `Home`, `End`, `F1`-`F12` |
| `driver.hotkey(modifier, key)` | Shortcut for combos like `hotkey("Ctrl", "a")` |
| `driver.mouseMove(x, y)` | Move cursor to screen coordinates |
| `driver.mouseClick(x, y, button?)` | Click at coordinates. `button` is `"left"` (default) or `"right"` |
| `driver.doubleClick(x, y)` | Double-click at coordinates — selects the word under the cursor in most apps |
| `driver.tripleClick(x, y)` | Triple-click at coordinates — selects the whole line/paragraph in most apps |
| `driver.shiftClick(x, y, button?)` | Click while holding Shift. Combine with a prior `mouseClick` to range-select text from the first click point to here |
| `driver.findWindow(titlePattern)` | Find a window by partial title match, returns window handle |
| `driver.focusWindow(titlePattern)` | Bring a window to the foreground by partial title match |
| `driver.maximizeWindow(titlePattern?)` | Maximise a window matched by title (substring), or the current foreground window if no pattern is given |
| `driver.getWindowTitle()` | Get the title of the currently focused window |
| `driver.launch(exePath, args?)` | Launch an application (waits 2s after launch) |
| `driver.closeWindow()` | Send Alt+F4 to close the focused window |
| `driver.pause(ms)` | Wait for the given number of milliseconds |
| `driver.screenshot(outputPath)` | Take a screenshot and save to the given path |
| `driver.screenshotRegion(outputPath, region)` | Save a cropped region — `region = { x, y, width, height }` |
| `driver.readText(region?, options?)` | OCR the screen (or a region) using Tesseract. Returns `{ text, confidence, words: [{ text, confidence, bbox: { x0, y0, x1, y1 } }] }` |
| `driver.findImage(refImage, options?)` | Find a reference image on screen. Returns `{ found, confidence, centerX, centerY, ... }` |
| `driver.clickImage(refImage, options?)` | Find image and click its centre |
| `driver.waitForImage(refImage, options?)` | Poll until image appears or timeout |
| `driver.waitForText(text, region?, options?)` | Poll until OCR finds the text or timeout |
| `driver.quit()` | No-op (desktop driver has no persistent session) |

**Modifier keys for `keyPress`:** `"Ctrl"` / `"Control"`, `"Alt"`, `"Shift"`, `"Win"` / `"Meta"`

---

## Image OCR and Recognition (Desktop Tests)

Desktop tests can use image-based automation to read text from the screen (OCR) and find reference images on screen (template matching). This is useful for automating apps where you can't easily target elements by window title or coordinates.

### Test folder structure with images

Add an `images/` folder inside your test folder with reference images:

```
your-test-repo/
  tests/
    My-Desktop-Test/
      run.js
      metadata.json
      images/
        ok-button.png       <-- screenshot of the button you want to click
        save-dialog.png     <-- screenshot of a dialog you want to detect
        error-message.png
```

Reference images should be small, tightly cropped screenshots of the UI element you want to find. Smaller images = faster matching.

### Image Driver API

| Method | Description |
|---|---|
| `driver.readText(region?, options?)` | Take a screenshot, run OCR, return `{ text, confidence, words }`. If `region` is provided (`{ x, y, width, height }`), only that area is scanned. |
| `driver.findImage("ok-button.png", options?)` | Take a screenshot and find where the reference image appears. Returns `{ found, x, y, centerX, centerY, confidence }`. |
| `driver.waitForImage("dialog.png", options?)` | Poll `findImage` until the image appears or timeout. Throws if not found. |
| `driver.clickImage("ok-button.png", options?)` | Find the image on screen and click its center. Throws if not found. |
| `driver.waitForText("expected text", region?, options?)` | Poll OCR until the expected text appears on screen. Throws if not found within timeout. |
| `driver.screenshotRegion(outputPath, region)` | Capture a specific screen region and save to file. |

**Options for `findImage` / `clickImage`:**
- `threshold` — Match confidence threshold, 0 to 1 (default: `0.85`)
- `region` — Narrow the search area: `{ x, y, width, height }`
- `offsetX`, `offsetY` — Offset the click from the image center (clickImage only)

**Options for `waitForImage` / `waitForText`:**
- `timeout` — Max wait in ms (default: `10000`)
- `interval` — Poll interval in ms (default: `1000`)

**Options for `readText`:**
- `lang` — OCR language (default: `"eng"`)

### Image OCR Example

```js
function log(msg) {
  process.stdout.write(`${msg}\n`);
}

module.exports = async function (driver, parameters = {}, zephyrLog) {
  if (typeof zephyrLog !== "function") zephyrLog = function () {};

  try {
    log("Launching Calculator...");
    await driver.launch("calc.exe");
    await driver.pause(2000);

    // Read text from a specific screen region
    const result = await driver.readText({ x: 100, y: 200, width: 400, height: 50 });
    log("OCR result: " + result.text);

    // Wait for specific text to appear anywhere on screen
    await driver.waitForText("Calculator", null, { timeout: 5000 });
    log("PASS: Calculator text found on screen.");
    zephyrLog("Calculator text detected via OCR.", "Pass");
  } catch (err) {
    zephyrLog("FAIL: " + (err && err.message), "Fail");
    throw err;
  }
};
```

### Image Recognition Example

```js
function log(msg) {
  process.stdout.write(`${msg}\n`);
}

module.exports = async function (driver, parameters = {}, zephyrLog) {
  if (typeof zephyrLog !== "function") zephyrLog = function () {};

  try {
    log("Launching app...");
    await driver.launch("myapp.exe");
    await driver.pause(3000);

    // Wait for a dialog to appear (image must be in test's images/ folder)
    log("Waiting for login dialog...");
    await driver.waitForImage("login-dialog.png", { timeout: 15000 });
    zephyrLog("Login dialog appeared.", "Pass");

    // Click a button by its image
    log("Clicking OK button...");
    await driver.clickImage("ok-button.png");
    zephyrLog("Clicked OK button.", "Pass");

    // Find an image and check if it exists (without throwing)
    const match = await driver.findImage("error-icon.png", { threshold: 0.9 });
    if (match.found) {
      throw new Error("Error icon detected on screen!");
    }
    log("PASS: No error icons found.");
    zephyrLog("No error icons detected.", "Pass");
  } catch (err) {
    zephyrLog("FAIL: " + (err && err.message), "Fail");
    throw err;
  }
};
```

### Tips for reference images

- **Crop tightly** — Only include the exact UI element, not surrounding whitespace
- **Use PNG** — Lossless format avoids compression artefacts that hurt matching
- **Keep them small** — 20x20 to 200x200 pixels is ideal. Larger images are slower to match
- **Avoid dynamic content** — Don't include text that changes (timestamps, counters) in reference images
- **Test at the same resolution** — Reference images must match the screen resolution they'll run on
- **Lower threshold if needed** — If matching fails due to slight rendering differences, try `{ threshold: 0.75 }`

### Scheduled tests with images

When you create a schedule, all images from each test's `images/` folder are automatically bundled (base64 encoded) into the schedule. They're also included in `.utsb` export/import bundles. No extra steps needed.

---

## metadata.json (Optional)

Add a `metadata.json` file alongside `run.js` to configure the test card in the UI:

```json
{
  "title": "My Test — Short description of what it does",
  "needed-parameters": [
    {
      "name": "TARGET_URL",
      "label": "Target URL",
      "default": "https://example.com"
    },
    {
      "name": "USERNAME",
      "label": "Login username",
      "default": ""
    }
  ]
}
```

| Field | Description |
|---|---|
| `title` | Display name shown on the test card (defaults to folder name if omitted) |
| `needed-parameters` | Array of parameter definitions. Each creates an input field on the test card |
| `needed-parameters[].name` | Parameter key — accessed in your test as `parameters.TARGET_URL` |
| `needed-parameters[].label` | Human-readable label shown in the UI |
| `needed-parameters[].default` | Default value pre-filled in the input |

---

## Using Parameters and Secrets

### Parameters

Parameters defined in `metadata.json` appear as input fields on the test card. They are passed to your test function as `parameters`:

```js
module.exports = async function (driver, parameters, zephyrLog) {
  const url = parameters.TARGET_URL || "https://fallback.com";
  await driver.get(url);
};
```

### Secrets

Secrets are added via the Secrets Manager in the UI and are encrypted at rest. All secrets are automatically injected into the `parameters` object by their name:

```js
module.exports = async function (driver, parameters, zephyrLog) {
  const apiKey = parameters.MY_API_KEY; // from secrets manager
};
```

You can also reference secrets in parameter default values using `${{ secrets.SECRET_NAME }}` syntax.

---

## Zephyr Scale Reporting

Each test card has Zephyr Scale fields (Project Key, Case Key, Cycle Key). When these are filled in and a `ZEPHYR_API_TOKEN` secret is set, the runner automatically reports results after each test step.

Use `zephyrLog()` inside your test to create step-level results:

```js
// Log a passing step
zephyrLog("Navigated to the login page successfully.", "Pass");

// Log a failing step
zephyrLog("FAIL: Login button not found on page.", "Fail");
```

Each `zephyrLog()` call becomes one step result in the Zephyr Scale test execution. The overall test result is `Pass` if all steps pass, or `Fail` if any step fails or the test throws an error.

---

## OKTA Authentication (Web Tests Only)

For web tests that require OKTA SSO login, select an OKTA Environment on the test card (Prod, Pre-prod, or Test). The runner will:

1. Insert an OKTA Login step before your test (navigates to the login page, waits for you to authenticate)
2. Run your test(s) in the authenticated browser session
3. Insert an OKTA Finish step after your test

Your test code doesn't need to handle login — just write the test assuming you're already authenticated.

OKTA options are only shown on web test cards (not desktop).

---

## Scheduled Tests

Schedules are managed by a standalone **scheduler service** that runs as a system-wide background process (separate from the Electron app). When you create a schedule:

1. The app bundles your current secrets, test code, and images into the schedule
2. The schedule is sent to the scheduler service (running on port 5050)
3. The service runs your tests on the cron schedule, even when no one has the Electron app open

All users on the machine see the same schedules. The scheduler service stores data in a shared directory:

| OS | Location |
|---|---|
| **Windows** | `C:\ProgramData\uts-automation\` |
| **Linux** | `/var/lib/uts-automation/` (or `UTS_SCHEDULER_DATA_DIR` env var) |

### Setting up the scheduler service

**Development:**
```bash
# Linux
cd server && UTS_SCHEDULER_DATA_DIR=./data node scheduler-service.js

# Windows (PowerShell)
cd server; $env:UTS_SCHEDULER_DATA_DIR="./data"; node scheduler-service.js
```

**Production (Windows):**
```powershell
node scripts/install-service-win.js
```

**Production (Linux):**
```bash
sudo bash scripts/install-service-linux.sh
```

If the scheduler service is not running, the Schedule Panel in the UI shows a warning banner. All other features (running tests, sequences, secrets) work without it.

For more details, see the **Scheduler Service** section in the main [README](../README.md).

---

## Repo Structure Summary

```
your-test-repo/
  tests/
    Test-Name/
      run.js              # Required — your test script
      metadata.json       # Optional — title + parameter definitions
      images/             # Optional — reference images for OCR/recognition
        ok-button.png
        dialog.png
    Another-Test/
      run.js
      metadata.json
```

- Folder names = test names (shown in UI)
- Each test **must** have a `run.js` (or `run.py`)
- `metadata.json` is optional but recommended for titles and parameters
- The same test script works for both web and desktop — the toggle in the UI picks the runner
- Tests run in sequence in the order you add them

---

## AI Prompt for Writing Tests

Copy the prompt below and give it to any AI assistant when you need help writing a test. It contains all the context the AI needs to produce a working test script.

---

### Prompt

```
I'm writing a test for Marvin — an Electron desktop app that runs automated
tests via a Node.js backend. It runs on both Windows and Ubuntu/Linux.
Tests are stored in a GitHub repo under a tests/ folder.
Each test is a subfolder containing a run.js and optionally a metadata.json.

The run.js file must export a single async function with this exact signature:

  module.exports = async function (driver, parameters, zephyrLog) { ... };

Arguments:
- driver: the automation driver (I'll specify web or desktop below)
- parameters: an object with user-supplied values + all decrypted secrets (e.g. parameters.MY_SECRET)
- zephyrLog: a function to log step results — call zephyrLog("description", "Pass") or zephyrLog("description", "Fail")

Rules:
- Use process.stdout.write(`${msg}\n`) for logging (not console.log)
- Throw an error if the test fails — don't silently return
- Always guard zephyrLog: if (typeof zephyrLog !== "function") zephyrLog = function () {};
- Wrap test logic in try/catch — log failure with zephyrLog in the catch, then re-throw

FOR WEB TESTS (works on Windows and Linux):
- driver is a Selenium WebDriver instance (Chrome/Chromium). The browser is already launched for you.
- The app auto-detects Chrome or Chromium on the system — no binary config needed.
- You can require("selenium-webdriver") for By, Key, until, etc.
- Selenium is pre-imported in sequence mode: By, Key, until, Builder are available.
- The browser runs headless by default. Users can toggle "Visual Browser" in the UI.
- Do NOT create or quit the browser — the runner handles that.

FOR DESKTOP TESTS (Windows only):
- driver is a Desktop Driver with these methods:

  Keyboard & Mouse:
  - driver.type(text) — type text via SendKeys
  - driver.keyPress(...keys) — press keys. Modifiers: "Ctrl", "Alt", "Shift", "Win"
    Keys: "Enter", "Tab", "Escape", "Backspace", "Delete", "Up", "Down", "Left",
    "Right", "Home", "End", "F1"-"F12"
  - driver.hotkey(modifier, key) — shortcut for key combos like hotkey("Ctrl", "a")
  - driver.mouseMove(x, y) — move cursor to screen coordinates
  - driver.mouseClick(x, y, button?) — click at coordinates ("left" default, or "right")
  - driver.doubleClick(x, y) — double-click at coordinates

  Window management:
  - driver.findWindow(titlePattern) — find window by partial title, returns handle
  - driver.focusWindow(titlePattern) — bring window to foreground by partial title
  - driver.getWindowTitle() — get focused window title
  - driver.launch(exePath, args?) — launch an app (waits 2s after)
  - driver.closeWindow() — send Alt+F4

  Utilities:
  - driver.pause(ms) — wait ms milliseconds
  - driver.screenshot(outputPath) — take a screenshot

  Image OCR & Recognition (put reference images in tests/YourTest/images/):
  - driver.readText(region?, options?) — OCR: screenshot the screen (or a region
    {x,y,width,height}), returns { text, confidence, words }
  - driver.findImage("button.png", options?) — find a reference image on screen,
    returns { found, x, y, centerX, centerY, confidence }
  - driver.waitForImage("dialog.png", options?) — poll until image appears (timeout default 10s)
  - driver.clickImage("button.png", options?) — find image and click its center
  - driver.waitForText("expected", region?, options?) — poll OCR until text appears
  - driver.screenshotRegion(outputPath, {x,y,width,height}) — capture a screen region
  Options: threshold (0-1, default 0.85), timeout (ms), interval (ms), region, offsetX/Y

- Do NOT create or quit the driver — the runner handles that.

TEST FOLDER STRUCTURE:
  tests/MyTest/
    run.js           — test script
    metadata.json    — optional config
    images/          — optional reference images for OCR/recognition
      button.png
      dialog.png

METADATA (metadata.json) — optional, placed alongside run.js:
{
  "title": "Human-readable test name — shown in the UI",
  "needed-parameters": [
    { "name": "PARAM_NAME", "label": "Display label", "default": "default value" }
  ]
}
Parameters defined here become input fields on the test card and are passed as
parameters.PARAM_NAME in the test function.

Now please write me a [WEB / DESKTOP] test that does the following:
[DESCRIBE WHAT THE TEST SHOULD DO]
```
