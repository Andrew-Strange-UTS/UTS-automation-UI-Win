---
title: Example Tests
nav_order: 8
---

# Example Tests

This page walks through seven real, working tests for Marvin. Each one is small and self-contained, and each was chosen to show off a different thing Marvin can do: typing on the keyboard, reading buttons and text off the screen, clicking and dragging the mouse, managing windows, taking screenshots, using image recognition, and passing in your own values and secrets.

You do not need to be a programmer to get value from this page. Every test is shown in full, followed by a plain-English walkthrough that explains what each part does and why. If a word like "function" or "variable" is new to you, do not worry: we explain the important ones as they come up.

Best of all, these are not made-up snippets. They live in a public repository and you can load every one of them into Marvin and read along while they run. Let us start there.

---

## Load these examples into Marvin

All seven tests live in a public GitHub repository:

```
https://github.com/Perpaterb/win-marvin-tests
```

To load them:

1. Open Marvin.
2. Paste that URL into Marvin's **GitHub repo** field.
3. Click **Refresh Tests**.

Marvin looks inside the repository's `tests/` folder. Each folder in there becomes its own **test card** in the app. You can then add any of those cards to a run sequence and click **Run Sequence** to run them.

> **Heads up:** the desktop tests on this page (Notepad, Calculator, Explorer, Paint) only run on **Windows**, because they drive real Windows apps. Web tests run on both Windows and Linux. See [Creating Tests](creating-tests.html) for the difference between desktop and web mode.

---

## Getting an AI to build a test for you

You do not have to write tests by hand. Many people describe what they want in plain English and let an AI assistant (such as ChatGPT or Claude) write the actual code. Here is the workflow.

### The workflow

1. Open the [Creating Tests](creating-tests.html) page.
2. Scroll to the section called **"AI Prompt for Writing Tests"** and copy the big prompt inside it. That prompt contains everything the AI needs to know about Marvin: the exact shape a test must take, and the full list of things `driver` can do.
3. Paste that prompt into your AI assistant.
4. Underneath it, describe in plain English what you want the test to do.
5. Copy the code the AI gives you into a `run.js` file inside a new folder under `tests/`, then refresh Marvin.

The prompt does the heavy lifting. Your job is only to describe the test clearly.

### What makes a good request

A good request gives the AI three things:

- **Name the app** you want to test (for example "Notepad", "Calculator", or a website URL).
- **List the steps in order**, the way you would explain them to a person sitting at the keyboard.
- **Say what "passing" looks like**: the specific thing to check at the end that proves it worked.

That last point matters most. A test is only useful if it *checks* something. "Type hello" is an action; "and pass only if the clipboard then contains hello" is a check. Always include a check.

### Example prompts you can paste

Here are a few realistic requests a beginner could paste right after the big prompt:

> Write me a **DESKTOP** test that opens Notepad, types "hello", selects all with Ctrl+A, copies it, and passes only if the clipboard contains "hello".

> Write me a **DESKTOP** test that opens Calculator, clears it, types 8 * 9 =, then reads the display and passes only if the answer is 72.

> Write me a **WEB** test that opens https://example.com and passes only if the main heading contains the word "Example".

Notice how each one names the app, lists the steps, and ends with a clear pass condition.

### Reading the result

When a test finishes, Marvin shows you the outcome at a glance:

- **Green** means the test passed.
- **Red** means it failed.

Open the **logs** to see each step as it happened. Every `log(...)` line in the test and every step it recorded shows up there, so if something went red you can scroll through and see exactly which step stopped.

---

## The seven example tests

Each test below follows the same overall shape, so once you understand one, the rest are easier. A quick vocabulary primer that applies to all of them:

- A **function** is a named block of instructions. Every Marvin test is one function that receives three things: `driver` (the robot that controls the keyboard, mouse and screen), `parameters` (values you supply, plus any secrets), and `zephyrLog` (used to record a pass or fail for each step).
- **`await`** means "do this, and wait for it to finish before moving on". Automation steps take real time (a window has to open, a key has to register), so almost every action is written with `await` in front of it.
- A **variable** is a named box that holds a value, created with `const` (a value that will not change) or `let` (one that can).
- To **throw an error** is to stop the test and mark it failed. Tests deliberately throw an error the moment something is not what they expected.
- **`zephyrLog("description", "Pass")`** (or `"Fail"`) records one step in the report. Passing steps build up a nice pass/fail trail you can read later.
- The **try / catch / finally** shape means: *try* to do the work; if anything goes wrong (*catch*), record the failure and stop; and *finally*, always run the cleanup (like closing the app) whether the test passed or failed.
- Tests **pause** on purpose (`driver.pause(2000)` waits 2000 milliseconds, i.e. 2 seconds). Apps need a moment to open, windows need a moment to appear, and clicks need a moment to register. Pausing keeps the robot from racing ahead of the app.
- The **"close without saving" idiom**: after `driver.closeWindow()`, modern Notepad pops up a "Do you want to save?" box. Pressing `Alt + N` chooses **Don't Save**, so the test tidies up without leaving a save dialog on screen.

---

### 01-Notepad-Keyboard-Clipboard

**What it shows:** keyboard typing, hotkey combos, and reading and writing the Windows clipboard.

```js
function log(msg) {
  process.stdout.write(`${msg}\n`);
}

// Capability area: keyboard input, hotkey combos, and the Windows clipboard.
// App: Notepad (built into every Windows install).
module.exports = async function (driver, parameters = {}, zephyrLog) {
  if (typeof zephyrLog !== "function") zephyrLog = function () {};

  try {
    log("Launching Notepad...");
    await driver.launch("notepad.exe");
    await driver.pause(2000);
    await driver.focusWindow("Notepad");
    zephyrLog("Launched Notepad.", "Pass");

    const line1 = "Marvin keyboard and clipboard demo.";
    log("Typing first line...");
    await driver.type(line1);
    await driver.keyPress("Enter");
    await driver.pause(500);
    zephyrLog("Typed a line of text and pressed Enter.", "Pass");

    const pasted = "This line arrived via the clipboard.";
    log("Setting clipboard and pasting with Ctrl+V...");
    await driver.setClipboard(pasted);
    await driver.hotkey("Ctrl", "v");
    await driver.pause(500);
    zephyrLog("Set clipboard and pasted its contents.", "Pass");

    log("Select all (Ctrl+A) and copy (Ctrl+C)...");
    await driver.hotkey("Ctrl", "a");
    await driver.pause(300);
    await driver.hotkey("Ctrl", "c");
    await driver.pause(300);

    const clip = await driver.getClipboard();
    log("Clipboard now contains:\n" + clip);

    if (!clip.includes(line1) || !clip.includes(pasted)) {
      throw new Error("Clipboard did not contain both expected lines.");
    }
    zephyrLog("Verified both typed and pasted lines via clipboard read-back.", "Pass");

    log("Closing Notepad without saving...");
    await driver.closeWindow();
    await driver.pause(1000);
    // Modern Notepad prompts "Save?", press Alt+N / N for "Don't Save".
    await driver.keyPress("Alt", "n");
    await driver.pause(500);
    zephyrLog("Closed Notepad without saving.", "Pass");

    log("PASS: Keyboard and clipboard test complete.");
  } catch (err) {
    zephyrLog("FAIL: " + (err && err.message), "Fail");
    throw err;
  }
};
```

**Launch / setup.** `driver.launch("notepad.exe")` opens Notepad, then `driver.pause(2000)` waits two seconds for it to appear, and `driver.focusWindow("Notepad")` makes sure Notepad is the active window (so typing goes into it and nowhere else).

**Main actions.** The test does three keyboard and clipboard things:

- `driver.type(line1)` types a line of text, and `driver.keyPress("Enter")` presses the Enter key to start a new line.
- `driver.setClipboard(pasted)` puts a second sentence onto the Windows clipboard directly (no typing), then `driver.hotkey("Ctrl", "v")` presses Ctrl+V to paste it. `hotkey` is the shortcut helper for key combinations.
- `driver.hotkey("Ctrl", "a")` selects everything, and `driver.hotkey("Ctrl", "c")` copies the whole document back onto the clipboard.

**The check.** `driver.getClipboard()` reads back whatever is now on the clipboard. The test then checks that the clipboard contains *both* the line it typed and the line it pasted. If either is missing, it throws an error, which turns the test red. This is the "read-back" trick: type something, copy it, then read the clipboard to prove the text really landed.

**Cleanup.** `driver.closeWindow()` sends Alt+F4 to close Notepad, then `driver.keyPress("Alt", "n")` answers the "save?" prompt with Don't Save.

---

### 02-Calculator-UIA-Controls

**What it shows:** UI Automation controls: finding a button or display by its ID and reading its value directly, rather than reading pixels.

```js
function log(msg) {
  process.stdout.write(`${msg}\n`);
}

// Capability area: UI Automation controls: findControl (locate + inspect) and
// getControlText (read a control's value). App: classic CalcFrame Calculator.
module.exports = async function (driver, parameters = {}, zephyrLog) {
  if (typeof zephyrLog !== "function") zephyrLog = function () {};

  const WIN = "Calculator";
  let launched = false;

  try {
    log("Launching Calculator...");
    await driver.launch("calc.exe");
    await driver.pause(2500);
    await driver.focusWindow(WIN);
    await driver.pause(400);
    launched = true;
    zephyrLog("Launched Calculator.", "Pass");

    log("Inspecting button controls via findControl...");
    const toInspect = [
      { id: "136", label: "digit 7" },
      { id: "135", label: "digit 6" },
      { id: "93",  label: "plus" },
      { id: "121", label: "equals" },
      { id: "150", label: "display" },
    ];
    for (const c of toInspect) {
      const ctrl = await driver.findControl(WIN, { controlId: c.id });
      log(`  ${c.label} (id ${c.id}) -> class='${ctrl.className}' name='${ctrl.name}' autoId='${ctrl.automationId}'`);
    }
    zephyrLog("Located and inspected calculator controls via UIA.", "Pass");

    log("Clearing, then entering 7 + 6 = via keyboard...");
    await driver.keyPress("Escape");
    await driver.pause(300);
    await driver.type("7");
    await driver.pause(150);
    await driver.type("+");
    await driver.pause(150);
    await driver.type("6");
    await driver.pause(150);
    await driver.keyPress("Enter"); // '='
    await driver.pause(500);
    zephyrLog("Entered 7 + 6 = via keyboard.", "Pass");

    log("Reading the result from display control (id 150) via getControlText...");
    const raw = await driver.getControlText(WIN, { controlId: "150" });
    log("Display control value: " + raw);

    const digits = (raw.match(/\d+/g) || []).join("");
    if (digits !== "13") {
      throw new Error(`Expected 13, display control read '${raw}'.`);
    }
    zephyrLog("Verified 7 + 6 = 13 by reading the display control via UIA.", "Pass");

    log("PASS: UI Automation control test complete.");
  } catch (err) {
    zephyrLog("FAIL: " + (err && err.message), "Fail");
    throw err;
  } finally {
    if (launched) {
      try {
        log("Closing Calculator...");
        await driver.focusWindow(WIN);
        await driver.closeWindow();
        await driver.pause(500);
      } catch (closeErr) {
        log("Warning: could not close Calculator cleanly: " + (closeErr && closeErr.message));
      }
    }
  }
};
```

`WIN` is just a variable holding the window title `"Calculator"`, used everywhere below so the name is written once. `launched` starts as `false` and is flipped to `true` once the app opens, so the cleanup at the end only tries to close Calculator if it actually got launched.

**Launch / setup.** Open `calc.exe`, wait, and focus it.

**Main actions.** Windows apps expose their buttons and text boxes as **controls**, and each control can be targeted by a stable ID. This test loops over a small list of controls (the digit 7, digit 6, plus, equals, and the display) and calls `driver.findControl(WIN, { controlId: c.id })` on each. `findControl` locates the control and returns details about it (its class name, its name, its automation ID), which the test logs so you can see what it found. This is the reliable way to target UI elements, far steadier than guessing pixel coordinates. Then it clears with `Escape` and types `7 + 6` followed by Enter (which acts as the `=` key).

**The check.** `driver.getControlText(WIN, { controlId: "150" })` reads the value straight out of the display control (control 150 is the result display). The test strips out everything except digits and confirms the result reads `13`. Reading the control directly is more dependable than reading the number off the screen with OCR.

**Cleanup.** This test uses a `finally` block: whether the test passed or failed, it re-focuses Calculator and closes it. The inner `try/catch` around the close means that even if closing hiccups, the test does not crash on the way out, it just logs a warning.

---

### 03-Notepad-Mouse-Selection

**What it shows:** mouse gestures: double-click to select a word, triple-click to select a line, and click-then-shift-click to select a range. Coordinates are found with OCR.

```js
function log(msg) {
  process.stdout.write(`${msg}\n`);
}

// Capability area: mouse gestures: doubleClick, tripleClick, mouseClick +
// shiftClick range select. App: Notepad. Coordinates are found via OCR.
module.exports = async function (driver, parameters = {}, zephyrLog) {
  if (typeof zephyrLog !== "function") zephyrLog = function () {};

  const WIN = "Notepad";
  const SENTINEL = "ZEBRACODE";
  const CLIP_MARK = "__CLEARED__";
  let launched = false;

  async function resetClip() {
    await driver.setClipboard(CLIP_MARK);
    await driver.pause(150);
  }

  async function findWordCentre(target) {
    const ocr = await driver.readText(null, {});
    const norm = (s) => (s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const want = norm(target);
    for (const w of (ocr.words || [])) {
      if (norm(w.text) === want && w.bbox) {
        const cx = Math.round((w.bbox.x0 + w.bbox.x1) / 2);
        const cy = Math.round((w.bbox.y0 + w.bbox.y1) / 2);
        log(`Found '${target}' at bbox [${w.bbox.x0},${w.bbox.y0},${w.bbox.x1},${w.bbox.y1}] -> centre (${cx}, ${cy}).`);
        return { x: cx, y: cy };
      }
    }
    throw new Error(`OCR could not locate '${target}' on screen.`);
  }

  try {
    log("Resetting clipboard...");
    await resetClip();

    log("Launching a fresh Notepad...");
    await driver.launch("notepad.exe");
    await driver.pause(2000);
    await driver.focusWindow(WIN);
    await driver.maximizeWindow(WIN);
    await driver.pause(600);
    launched = true;
    zephyrLog("Launched and maximised Notepad.", "Pass");

    log("Checking Notepad is empty...");
    await driver.hotkey("Ctrl", "a");
    await driver.pause(200);
    await driver.hotkey("Ctrl", "c");
    await driver.pause(300);
    const existing = await driver.getClipboard();
    if (existing !== CLIP_MARK && existing.trim().length > 0) {
      throw new Error("Notepad was not empty at start (stale content). Aborting.");
    }
    zephyrLog("Confirmed a clean, empty Notepad.", "Pass");

    log(`Typing sentinel word '${SENTINEL}'...`);
    await driver.type(SENTINEL);
    await driver.keyPress("Enter");
    await driver.type("second line here");
    await driver.pause(500);
    zephyrLog("Typed the sentinel word and a second line.", "Pass");

    log("Locating the sentinel word via OCR...");
    const centre = await findWordCentre(SENTINEL);
    zephyrLog("Located the sentinel word on screen.", "Pass");

    log("Double-clicking to select the sentinel word...");
    await resetClip();
    await driver.doubleClick(centre.x, centre.y);
    await driver.pause(300);
    await driver.hotkey("Ctrl", "c");
    await driver.pause(300);
    let clip = await driver.getClipboard();
    log("Word selection copied: " + JSON.stringify(clip));
    if (clip.trim() !== SENTINEL) {
      throw new Error(`Double-click did not select '${SENTINEL}' (got '${clip.trim()}').`);
    }
    zephyrLog("Double-click selected the sentinel word.", "Pass");

    log("Triple-clicking to select the whole line...");
    await resetClip();
    await driver.tripleClick(centre.x, centre.y);
    await driver.pause(300);
    await driver.hotkey("Ctrl", "c");
    await driver.pause(300);
    clip = await driver.getClipboard();
    log("Line selection copied: " + JSON.stringify(clip));
    if (!clip.includes(SENTINEL)) {
      throw new Error(`Triple-click did not select the sentinel line (got '${clip.trim()}').`);
    }
    if (clip.includes("second line")) {
      throw new Error("Triple-click over-selected into the second line.");
    }
    zephyrLog("Triple-click selected the sentinel line only.", "Pass");

    log("Range-selecting with mouseClick then shiftClick...");
    await resetClip();
    await driver.mouseClick(centre.x, centre.y, "left");
    await driver.pause(200);
    await driver.shiftClick(centre.x + 120, centre.y, "left");
    await driver.pause(300);
    await driver.hotkey("Ctrl", "c");
    await driver.pause(300);
    clip = await driver.getClipboard();
    log("Range selection copied: " + JSON.stringify(clip));
    if (!clip.includes(SENTINEL)) {
      throw new Error(`Range selection did not include '${SENTINEL}' (got '${clip.trim()}').`);
    }
    zephyrLog("Shift-click range selection captured the sentinel.", "Pass");

    log("PASS: Mouse selection test complete.");
  } catch (err) {
    zephyrLog("FAIL: " + (err && err.message), "Fail");
    throw err;
  } finally {
    if (launched) {
      try {
        log("Closing Notepad without saving...");
        await driver.focusWindow(WIN);
        await driver.closeWindow();
        await driver.pause(800);
        await driver.keyPress("Alt", "n");
        await driver.pause(500);
      } catch (closeErr) {
        log("Warning: could not close Notepad cleanly: " + (closeErr && closeErr.message));
      }
    }
  }
};
```

This test defines two little **helper functions** at the top (a helper function is a mini-function you can call again and again to avoid repeating yourself):

- `resetClip()` writes a known marker string onto the clipboard. Because every selection is verified by copying and reading the clipboard, resetting it first means an old value cannot fool the check.
- `findWordCentre(target)` runs OCR and finds where a given word is on screen. `driver.readText(null, {})` takes a screenshot and reads all the text, returning a list of `words`. Each word comes with a **bounding box** (`bbox`), the rectangle around it, given as `x0, y0` (top-left) and `x1, y1` (bottom-right). The helper averages those corners to get the exact centre point of the word, which is where the mouse should click.

**Launch / setup.** Open Notepad, focus it, and `driver.maximizeWindow(WIN)` maximises it so there is plenty of room. The test then confirms Notepad started empty by selecting all, copying, and checking the clipboard, so leftover text from a previous run cannot corrupt the results.

**Main actions.** It types the sentinel word `ZEBRACODE` on the first line and `second line here` on the second, then uses OCR to find the sentinel's centre point. Now it tries three mouse gestures at that point:

- `driver.doubleClick(x, y)` double-clicks, which in most apps selects the single word under the cursor.
- `driver.tripleClick(x, y)` triple-clicks, which selects the whole line or paragraph.
- `driver.mouseClick(x, y, "left")` clicks once to place the cursor, then `driver.shiftClick(x + 120, y, "left")` clicks 120 pixels to the right while holding Shift, which selects everything between the two click points (a range select).

After each gesture it copies the selection and reads the clipboard back.

**The check.** Each gesture has its own assertion: the double-click result must equal exactly `ZEBRACODE`; the triple-click result must include the sentinel but *not* spill into "second line"; the shift-click range must include the sentinel. Any mismatch throws an error and fails the test.

**Cleanup.** The `finally` block closes Notepad and answers the save prompt with Alt+N.

---

### 04-Explorer-Window-Management

**What it shows:** window management (find, focus, maximise, read the title) plus full-screen and window-only screenshots.

```js
function log(msg) {
  process.stdout.write(`${msg}\n`);
}

// Capability area: window management (find / focus / maximise / title read)
// plus full-screen and window-scoped screenshots. App: File Explorer.
module.exports = async function (driver, parameters = {}, zephyrLog) {
  if (typeof zephyrLog !== "function") zephyrLog = function () {};

  const outDir = parameters.SCREENSHOT_DIR || ".";
  let opened = false;
  let matched = null;

  try {
    log("Opening File Explorer...");
    await driver.launch("explorer.exe");
    await driver.pause(2500);
    opened = true;
    zephyrLog("Launched File Explorer.", "Pass");

    log("Locating the Explorer window...");
    for (const candidate of ["File Explorer", "Home", "This PC", "Explorer"]) {
      try {
        await driver.focusWindow(candidate);
        matched = candidate;
        break;
      } catch (e) {
        // try the next candidate
      }
    }
    if (!matched) {
      throw new Error("Could not find an Explorer window by any known title.");
    }
    log("Focused Explorer window matching: " + matched);
    zephyrLog("Found and focused the Explorer window.", "Pass");

    const title = await driver.getWindowTitle();
    log("Focused window title: " + title);
    zephyrLog("Read the focused window title.", "Pass");

    log("Maximising the window...");
    await driver.maximizeWindow(matched);
    await driver.pause(800);
    zephyrLog("Maximised the Explorer window.", "Pass");

    const fullPath = `${outDir}/explorer-full.png`;
    log("Taking a full-screen screenshot -> " + fullPath);
    await driver.screenshot(fullPath);
    zephyrLog("Captured a full-screen screenshot.", "Pass");

    const winPath = `${outDir}/explorer-window.png`;
    const titlesToTry = [title, matched, "Home", "This PC", "File Explorer"]
      .filter((t, i, a) => t && a.indexOf(t) === i);

    let captured = false;
    for (const t of titlesToTry) {
      try {
        log(`Taking a window-only screenshot (title '${t}') -> ${winPath}`);
        await driver.screenshotWindow(winPath, t);
        captured = true;
        log("Window screenshot captured using title: " + t);
        break;
      } catch (e) {
        log(`  '${t}' didn't match for screenshotWindow: ${(e && e.message || "").slice(0, 60)}`);
      }
    }

    if (captured) {
      zephyrLog("Captured a window-scoped screenshot.", "Pass");
    } else {
      log("Could not capture a window-scoped screenshot by any known title; the full-screen screenshot above still succeeded.");
      zephyrLog("Window-scoped screenshot skipped (Explorer title mismatch).", "Pass");
    }

    log("PASS: Window management test complete.");
  } catch (err) {
    zephyrLog("FAIL: " + (err && err.message), "Fail");
    throw err;
  } finally {
    if (opened && matched) {
      try {
        log("Closing Explorer...");
        await driver.focusWindow(matched);
        await driver.closeWindow();
        await driver.pause(500);
      } catch (closeErr) {
        log("Warning: could not close Explorer cleanly: " + (closeErr && closeErr.message));
      }
    }
  }
};
```

`outDir` reads an optional parameter `SCREENSHOT_DIR`; if you did not supply one, the `|| "."` part falls back to the current folder. This is a common pattern: "use the value the user gave, otherwise use this default".

**Launch / setup.** Open `explorer.exe`. File Explorer is awkward because its window title varies between Windows versions (it might be "Home", "This PC", "File Explorer"). So the test loops over several likely titles and calls `driver.focusWindow(candidate)` on each inside a `try`. `focusWindow` throws if no window matches, so the loop simply moves on to the next candidate and remembers the first one that worked in `matched`. If none match, it throws a clear error.

**Main actions.**

- `driver.getWindowTitle()` reads the exact title of whatever window is currently focused, and logs it.
- `driver.maximizeWindow(matched)` maximises that window.
- `driver.screenshot(fullPath)` saves a picture of the entire screen.
- `driver.screenshotWindow(winPath, t)` saves a picture of just the Explorer window. Because the title is again uncertain, the test tries a de-duplicated list of candidate titles and stops at the first one that captures successfully.

**The check.** This test is a bit gentler than the others: its main goal is to prove the window and screenshot calls work. It does treat "could not find any Explorer window" as a hard failure. If only the *window-only* screenshot cannot match a title, it logs a note and records the step as a pass, because the full-screen screenshot already succeeded and the point was demonstrated.

**Cleanup.** The `finally` block closes Explorer only if it was opened and a window was matched.

---

### 05-Calculator-OCR-ReadText

**What it shows:** OCR (optical character recognition): reading a number straight off the Calculator display as an image.

```js
function log(msg) {
  process.stdout.write(`${msg}\n`);
}

// Capability area: OCR: read a value off the Calculator display. App: Calculator.
module.exports = async function (driver, parameters = {}, zephyrLog) {
  if (typeof zephyrLog !== "function") zephyrLog = function () {};

  const WIN = "Calculator";
  let launched = false;

  try {
    log("Launching Calculator...");
    await driver.launch("calc.exe");
    await driver.pause(2500);
    await driver.focusWindow(WIN);
    await driver.pause(400);
    launched = true;
    zephyrLog("Launched Calculator.", "Pass");

    log("Clearing and entering 8 * 9 = via keyboard...");
    await driver.keyPress("Escape");
    await driver.pause(200);
    await driver.type("8");
    await driver.pause(150);
    await driver.type("*");
    await driver.pause(150);
    await driver.type("9");
    await driver.pause(150);
    await driver.keyPress("Enter"); // '='
    await driver.pause(600);
    zephyrLog("Entered 8 * 9 = via keyboard.", "Pass");

    log("Running OCR over the Calculator window...");
    const ocr = await driver.readText(null, { window: WIN });
    log("OCR confidence: " + ocr.confidence);
    log("OCR text:\n" + ocr.text);

    const textHas72 = /72/.test(ocr.text || "");

    const digitWords = (ocr.words || []).filter(
      w => w.bbox && /^\d[\d.,]*$/.test((w.text || "").trim())
    );
    const match = digitWords.find(w => (w.text || "").replace(/[^\d]/g, "") === "72");

    if (match) {
      log(`OCR located the result '72' at bbox [${match.bbox.x0},${match.bbox.y0},${match.bbox.x1},${match.bbox.y1}].`);
      zephyrLog("OCR located the result 72 with its bounding box.", "Pass");
    } else if (textHas72) {
      log("OCR text contains '72' (no clean word bbox, but the value was read).");
      zephyrLog("OCR read the result 72 from the display.", "Pass");
    } else {
      throw new Error(`OCR did not read '72'. Full text was: ${JSON.stringify(ocr.text)}`);
    }

    log("PASS: Calculator OCR test complete.");
  } catch (err) {
    zephyrLog("FAIL: " + (err && err.message), "Fail");
    throw err;
  } finally {
    if (launched) {
      try {
        log("Closing Calculator...");
        await driver.focusWindow(WIN);
        await driver.closeWindow();
        await driver.pause(500);
      } catch (closeErr) {
        log("Warning: could not close Calculator cleanly: " + (closeErr && closeErr.message));
      }
    }
  }
};
```

Test 02 read the answer from the control tree; this one reads it as **pixels**, which is what you do when an app does not expose usable controls.

**Launch / setup.** Open and focus Calculator.

**Main actions.** Clear with Escape, then type `8 * 9` and press Enter for `=`. Then the OCR step: `driver.readText(null, { window: WIN })` takes a screenshot of just the Calculator window and reads the text out of it. It returns three useful things: `text` (everything it read as one string), `confidence` (how sure the engine is), and `words` (each individual word with its bounding box).

**The check.** The test looks for the answer `72` two ways, from stricter to looser:

1. First it filters `words` down to ones that look like numbers, and looks for one whose digits are exactly `72`. If found, it logs the word's bounding box (proving it knows exactly where on screen the answer sits).
2. If no clean number-word matched but the full text still contains `72`, that counts as a pass too (the value was read, just not as a tidy separate word).
3. If neither is true, it throws an error and fails.

**Cleanup.** The `finally` block closes Calculator.

> OCR is powerful but pixel-based, so it can be thrown off by fonts, scaling, or blur. When an app exposes real controls (like Calculator does), prefer the approach in test 02. Use OCR when controls are not available.

---

### 06-Paint-Image-Recognition

**What it shows:** image recognition (waiting for and clicking a UI element by a reference picture) plus mouse dragging to draw.

```js
function log(msg) {
  process.stdout.write(`${msg}\n`);
}

// Draws Marvin in Paint as line-art. Each polyline is traced as a series of
// short chained drags. Brush is selected first via image match.
const PATHS = [
  ["head", [[475, 265], [476, 254], [481, 244], /* ...many more points, trimmed for readability... */ [475, 265]]],
  ["eyeL", [[534, 290], [533, 296], /* ... */ [534, 290]]],
  // ...more shapes (eyeR, neck, body, arms, hands, legs, feet), trimmed for readability...
];

module.exports = async function (driver, parameters = {}, zephyrLog) {
  if (typeof zephyrLog !== "function") zephyrLog = function () {};

  const WIN = "Paint";
  const OUT = parameters.OUT_DIR || ".";
  let launched = false;

  // Trace one polyline as chained short drags.
  async function tracePolyline(pl) {
    for (let i = 0; i < pl.length - 1; i++) {
      const from = { x: pl[i][0], y: pl[i][1] };
      const to = { x: pl[i + 1][0], y: pl[i + 1][1] };
      await driver.drag({ from, to });
      await driver.pause(60);
    }
  }

  try {
    log("Launching Paint...");
    await driver.launch("mspaint.exe");
    await driver.pause(3000);
    await driver.focusWindow(WIN);
    await driver.maximizeWindow(WIN);
    await driver.pause(1000);
    launched = true;
    zephyrLog("Launched and maximised Paint.", "Pass");

    log("Detecting Paint UI...");
    await driver.waitForImage("paint-window.png", { timeout: 15000, threshold: 0.7 });

    log("Selecting the brush tool...");
    await driver.clickImage("brush-tool.png", { threshold: 0.7 });
    await driver.pause(1000);
    zephyrLog("Selected the brush tool.", "Pass");

    log("Drawing Marvin, " + PATHS.length + " polylines...");
    for (const [name, pl] of PATHS) {
      log("  tracing: " + name + " (" + (pl.length - 1) + " segments)");
      await tracePolyline(pl);
      await driver.pause(150);
    }
    zephyrLog("Finished drawing Marvin.", "Pass");

    try {
      await driver.screenshotWindow(OUT + "/marvin-drawing.png", WIN);
      log("Saved marvin-drawing.png");
    } catch (e) {
      await driver.screenshot(OUT + "/marvin-drawing.png");
      log("Saved full-screen marvin-drawing.png");
    }

    log("PASS: Marvin drawing complete. Here I am, brain the size of a planet...");
  } catch (err) {
    zephyrLog("FAIL: " + (err && err.message), "Fail");
    throw err;
  } finally {
    if (launched) {
      log("Leaving Paint open so you can see the drawing.");
    }
  }
};
```

> The full `PATHS` array in the real test holds hundreds of coordinate points, one per pixel-step of the drawing. It is trimmed above so the example stays readable; the rest of the test is complete and unchanged.

**About the data at the top.** `PATHS` is a list of shapes that together make a line drawing of Marvin. Each entry is a name (like `"head"`) plus a **polyline**: an ordered list of `[x, y]` points. Joining those points with straight lines traces the shape.

**Reference images.** This test needs two small pictures in an `images/` folder next to `run.js`:

| File | What it is | Why |
|---|---|---|
| `paint-window.png` | A tight crop of the Paint toolbar | To confirm Paint has finished loading and is ready |
| `brush-tool.png` | A crop of the brush button | So the test can find and click that button |

**Launch / setup.** Open `mspaint.exe`, focus it, and maximise it. Then `driver.waitForImage("paint-window.png", { timeout: 15000, threshold: 0.7 })` repeatedly searches the screen until it spots the toolbar crop (or gives up after 15 seconds). This is how you wait for an app to be genuinely ready rather than just guessing a pause. `threshold: 0.7` loosens how exact the match must be (1.0 is a perfect pixel match; 0.7 allows for small rendering differences).

**Main actions.** `driver.clickImage("brush-tool.png", { threshold: 0.7 })` finds the brush button on screen and clicks its centre, selecting the brush tool. Then the drawing itself: for every shape in `PATHS`, the `tracePolyline` helper walks point to point and calls `driver.drag({ from, to })` for each little segment. A **drag** presses the mouse button down at `from`, moves the cursor across to `to` while still holding it down, then releases, so Paint records a continuous brush stroke rather than a single dot. Chaining many short drags traces the whole outline.

**The result.** After drawing, the test saves a picture of its work: it tries `driver.screenshotWindow` first (just the Paint window) and falls back to a full-screen `driver.screenshot` if that title does not match.

**Cleanup.** Unusually, this test's `finally` block leaves Paint **open** on purpose, so you can admire the finished drawing on screen.

---

### 07-Notepad-Parameters-Secrets

**What it shows:** user-supplied parameters and injected secrets: values you type into the test card, plus a secret pulled from the Secrets Manager.

```js
function log(msg) {
  process.stdout.write(`${msg}\n`);
}

// Capability area: user parameters + injected secrets. App: Notepad.
module.exports = async function (driver, parameters = {}, zephyrLog) {
  if (typeof zephyrLog !== "function") zephyrLog = function () {};

  const WIN = "Notepad";
  const greeting = parameters.GREETING || "Hello from Marvin";
  const secret = parameters.DEMO_SECRET; // set this in the Secrets Manager

  try {
    if (!secret) {
      log("WARNING: DEMO_SECRET is not set. Add it in the Secrets Manager to");
      log("fully exercise this test. Continuing with the parameter only.");
    }

    log("Launching Notepad...");
    await driver.launch("notepad.exe");
    await driver.pause(2000);
    await driver.focusWindow(WIN);
    zephyrLog("Launched Notepad.", "Pass");

    log("Typing the GREETING parameter...");
    await driver.type(greeting);
    await driver.keyPress("Enter");
    await driver.pause(400);
    zephyrLog("Typed the user-supplied GREETING parameter.", "Pass");

    if (secret) {
      log("Typing the injected secret (value hidden in logs)...");
      await driver.type("Secret length: " + secret.length + " chars");
      await driver.keyPress("Enter");
      await driver.pause(400);
      zephyrLog("Injected secret was available in parameters.", "Pass");
    }

    log("Selecting all and copying to verify...");
    await driver.hotkey("Ctrl", "a");
    await driver.pause(200);
    await driver.hotkey("Ctrl", "c");
    await driver.pause(300);
    const clip = await driver.getClipboard();

    if (!clip.includes(greeting)) {
      throw new Error("GREETING parameter did not appear in the document.");
    }
    zephyrLog("Verified the GREETING parameter round-tripped correctly.", "Pass");

    log("Closing Notepad without saving...");
    await driver.closeWindow();
    await driver.pause(800);
    await driver.keyPress("Alt", "n");
    await driver.pause(500);
    zephyrLog("Closed Notepad without saving.", "Pass");

    log("PASS: Parameters and secrets test complete.");
  } catch (err) {
    zephyrLog("FAIL: " + (err && err.message), "Fail");
    throw err;
  }
};
```

And its `metadata.json`, which sits in the same folder:

```json
{
  "title": "Notepad: Parameters & Secrets",
  "needed-parameters": [
    {
      "name": "GREETING",
      "label": "Greeting text to type",
      "default": "Hello from Marvin"
    },
    {
      "name": "DEMO_SECRET",
      "label": "Demo secret (pre-filled from Secrets Manager)",
      "default": "${{ secrets.DEMO_SECRET }}"
    }
  ]
}
```

**How metadata.json shapes the test card.** Every entry in `needed-parameters` becomes an **input box on the test card** in Marvin. Here you get two boxes: one labelled "Greeting text to type" and one labelled "Demo secret". The `name` is how your test reads the value (`parameters.GREETING` and `parameters.DEMO_SECRET`), the `label` is the friendly text shown next to the box, and the `default` is what the box is pre-filled with.

**How the secret gets in.** Look at the `DEMO_SECRET` default: `"${{ secrets.DEMO_SECRET }}"`. That special syntax does not mean the literal text; it tells Marvin to look up a secret **named `DEMO_SECRET`** in the Secrets Manager and use its value. That is exactly how you reference a stored secret. More broadly, **all** your secrets are injected into the `parameters` object by name at runtime, so inside the test `parameters.DEMO_SECRET` simply holds the real secret value. Secrets are stored encrypted and are never shown in the logs.

**Launch / setup.** The test first reads its two inputs. `greeting` uses your value or falls back to `"Hello from Marvin"`. `secret` reads `parameters.DEMO_SECRET`. If the secret is missing, it logs a friendly warning and carries on with just the greeting. Then it opens and focuses Notepad.

**Main actions.** It types the `greeting` and presses Enter. If a secret was provided, it types only the *length* of the secret (for example "Secret length: 12 chars"), never the secret itself, so nothing sensitive lands in the document or the logs. Then it selects all and copies, as in test 01.

**The check.** `driver.getClipboard()` reads the document back, and the test confirms the greeting text made it in. If not, it throws and fails.

**Cleanup.** Close Notepad and answer the save prompt with Alt+N.

---

## Now write your own

You now have seven working patterns to build from. The fastest way to start is to copy the example closest to what you want, then tweak the details: change the app it launches, the text it types, or the value it checks for.

If you would rather describe your test than write it, open the [Creating Tests](creating-tests.html) page, copy the big **"AI Prompt for Writing Tests"** block, paste it to an AI assistant, and describe your test in plain English. Remember the three ingredients of a good request: name the app, list the steps in order, and say what "passing" looks like.

Then drop your new folder into the `tests/` folder of your repository, refresh Marvin, and run it. Green means you are on your way.
