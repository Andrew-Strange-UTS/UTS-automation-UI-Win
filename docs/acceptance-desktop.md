---
title: "Acceptance: Desktop mode"
nav_order: 5
---

# Marvin: Desktop Mode Acceptance Test Checklist

This is a living acceptance-test checklist for **Desktop mode** in Marvin (the Electron test-automation app). Desktop automation uses the PowerShell + Win32 driver, so this checklist runs only on **Windows 10/11**. It covers the full Desktop epic: basic window control, element interaction by control id/class, keyboard and clipboard, image template matching, OCR, wait-for-image and wait-for-text, mouse control (hover, drag, scroll), screenshots (full, region, window), template management, and running the built-in desktop sample test.

Each step references the Jira story it verifies (EPEA-####). Fill in the Pass/Fail column for every row and note anything unexpected. The full run is designed to take **under 45 minutes**. Where a method shown in a story differs from the shipped driver name, the actual driver method is noted in the step.

Tracks Jira story **EPEA-2513** (Tester onboarding, acceptance test checklist for Desktop mode).

---

## Prerequisites

Complete these before starting. They are setup, not acceptance steps.

- A **Windows 10 or Windows 11** machine with Marvin freshly installed (or `npm run dev` from a fresh clone). Desktop mode is not available on Linux.
- **PowerShell** available (built into Windows). Confirm the diagnostics PowerShell check passes.
- The Marvin **mode toggle set to Desktop** (below the Scheduled Sequences panel).
- The following **test apps** ready to launch:
  - **Notepad** (`notepad.exe`)
  - **Calculator** (`calc.exe`)
  - A **sample WinForms app** with named/classed controls (a small `.exe` exposing a labelled button such as "OK" and an Edit text field). Use any simple WinForms test harness; note its path in the row notes.
- A small **reference image** (tightly cropped PNG, e.g. a toolbar button) placed in the test's `images/` folder for the image-matching and wait-for-image steps.
- Screen resolution and scaling left at a fixed value for the session, so image and OCR coordinates stay stable.

---

## 1. Mode, diagnostics and the built-in sample test (EPEA-2488, EPEA-2489, EPEA-2494)

| Step | Expected Result | Pass/Fail | Notes |
|---|---|---|---|
| Set the toggle to Desktop mode (EPEA-2488 AC3) | OKTA Environment and Visual Browser options are hidden on test cards. | | |
| Check the diagnostics PowerShell row (EPEA-2489 AC2, AC3) | PowerShell check passes on Windows. | | |
| With no repo loaded, view the test list (EPEA-2494 AC1) | The built-in desktop sample test (Notepad) appears in the list. | | |
| Add the desktop sample test to the sequence and run it (EPEA-2494 AC2) | It runs end to end on Windows without modification: launches Notepad, types, closes, asserts. | | |
| Open docs/creating-tests.md and find the Desktop Driver API reference (EPEA-2494 AC3, AC4) | A method reference table is present and the copy-pasteable AI prompt is included. | | |

---

## 2. Basic window control (EPEA-2491)

Use **Notepad** for this section.

| Step | Expected Result | Pass/Fail | Notes |
|---|---|---|---|
| `driver.launch('notepad.exe')` (EPEA-2491 AC1, AC6) | Notepad opens; the call returns/awaits cleanly as a Promise. | | |
| `driver.findWindow('Notepad')` (EPEA-2491 AC2) | Returns a handle for the window whose title contains "Notepad". | | |
| `driver.type('Hello world')` (shipped name for sendKeys) (EPEA-2491 AC4) | Text is typed into Notepad's edit area. | | |
| `driver.mouseClick(x, y)` inside the window (shipped name for click) (EPEA-2491 AC5) | A click lands at the given screen coordinates. | | |
| `driver.closeWindow()` then dismiss the save prompt (EPEA-2491 AC3) | Notepad closes; closeWindow sends Alt+F4. | | |
| Call findWindow with a non-existent title (EPEA-2491 AC7) | A descriptive Error is thrown (window not found). | | |

---

## 3. Element interaction by control id and class (EPEA-2492)

Use the **sample WinForms app**.

| Step | Expected Result | Pass/Fail | Notes |
|---|---|---|---|
| `findControl(window, { name: 'OK' })` (EPEA-2492 AC1) | Locates the button by its accessible name "OK". | | |
| `findControl(window, { className: 'Edit' })` (EPEA-2492 AC2) | Locates the edit field by class name. | | |
| `clickControl(control)` on the OK button (EPEA-2492 AC3) | A click is sent to the located control. | | |
| `setControlText(editControl, 'value')` (EPEA-2492 AC4) | The text input's value is set. | | |
| `getControlText(editControl)` (EPEA-2492 AC5) | Returns the current text value of the control. | | |
| `findControl` with a control that does not exist (EPEA-2492 AC6) | A descriptive error is thrown. | | |

> Note: the shipped signatures are `findControl(windowTitle, { name, className, controlId })`, and `clickControl` / `setControlText` / `getControlText` take `(windowTitle, locator[, text])` and re-find the control internally (no live handle is passed across calls).

---

## 4. Keyboard and clipboard operations (EPEA-2493)

Use **Notepad** (type some text first so there is content to select/copy).

| Step | Expected Result | Pass/Fail | Notes |
|---|---|---|---|
| `driver.hotkey('Ctrl', 'a')` (shipped name for sendShortcut) (EPEA-2493 AC1) | All content in Notepad is selected. | | |
| `driver.hotkey('Ctrl', 'c')` (EPEA-2493 AC2) | Selected content is copied to the clipboard. | | |
| `driver.setClipboard('test value')` (EPEA-2493 AC3) | Windows clipboard content is set to "test value". | | |
| `driver.getClipboard()` (EPEA-2493 AC4) | Returns the current clipboard text. | | |
| Use a human-readable combo, e.g. `keyPress('Alt','F4')` (EPEA-2493 AC5) | Shortcut expressed as readable keys works (closes the window). | | |

---

## 5. Mouse control: hover, drag, scroll (EPEA-2499)

Use **Notepad** or the **sample WinForms app**.

| Step | Expected Result | Pass/Fail | Notes |
|---|---|---|---|
| `driver.mouseMove(x, y)` (shipped name for hover) (EPEA-2499 AC1) | Cursor moves to the given screen coordinates. | | |
| `driver.drag({ from, to })` (EPEA-2499 AC2) | Performs mouse-down, move, mouse-up. | | |
| `driver.scroll(x, y, delta)` (EPEA-2499 AC3) | Scrolls up on positive delta, down on negative. | | |
| Pass a window handle for window-relative coordinates (EPEA-2499 AC4) | Coordinates resolve relative to the window. | | |
| Run the above on a standard (non-admin) account (EPEA-2499 AC5) | Actions complete with no elevation/UAC prompt. | | |

> Note: window-relative coordinates use an options object, e.g. `driver.drag({ from, to }, { relativeTo: "Window Title" })` and `driver.scroll(x, y, delta, { relativeTo: "Window Title" })` (also accepted on `mouseMove` / `mouseClick`), rather than a raw window handle.

---

## 6. Screenshots: full, region and window (EPEA-2495)

Use **Calculator** as the visible target.

| Step | Expected Result | Pass/Fail | Notes |
|---|---|---|---|
| `driver.screenshot(outputPath)` (EPEA-2495 AC1, AC5) | A full primary-screen PNG is saved using only PowerShell (no external exe). | | |
| `driver.screenshotRegion(outputPath, { x, y, width, height })` (EPEA-2495 AC3) | A cropped region PNG is saved. | | |
| `driver.screenshotWindow(outputPath, "Window Title")` for a single window (EPEA-2495 AC2) | A screenshot of just the target window is saved. | | |
| Confirm the output is usable for image matching (EPEA-2495 AC4) | The saved image opens and can be fed to findImage. | | |

> Note: window-only capture is `driver.screenshotWindow(outputPath, titlePattern)` (matches the window by partial title), alongside full-screen `screenshot` and `screenshotRegion`.

---

## 7. Image template matching (EPEA-2496)

Use **Calculator** (or the sample app) with the prepared reference PNG in `images/`.

| Step | Expected Result | Pass/Fail | Notes |
|---|---|---|---|
| `driver.findImage('button.png')` with the element visible (shipped name for findByImage) (EPEA-2496 AC1, AC2) | Returns coordinates plus a confidence score between 0 and 1. | | |
| `driver.findImage('button.png', { threshold })` with the element hidden (EPEA-2496 AC3, AC5) | Throws ImageNotFoundError below threshold; threshold tunes sensitivity. | | |
| `driver.clickImage('button.png')` (EPEA-2496 AC4) | Finds the image and clicks its centre in one call. | | |
| Repeat with a JPEG template (EPEA-2496 AC6) | Matching works with both PNG and JPEG templates. | | |

---

## 8. OCR: read text from screen region (EPEA-2497)

Use **Calculator** (its display/buttons give readable text).

| Step | Expected Result | Pass/Fail | Notes |
|---|---|---|---|
| `driver.readText({ region })` over a text area (EPEA-2497 AC1, AC3) | Returns a trimmed, normalised string of the visible text. | | |
| Pass `lang: 'eng'` (EPEA-2497 AC4) | The lang option is accepted (Tesseract language code). | | |
| Force a screenshot failure (e.g. invalid region) (EPEA-2497 AC5) | A descriptive error is thrown, not a silent empty string. | | |
| `driver.readText(null, { window: "Window Title" })` for full-window OCR (EPEA-2497 AC2) | Reads all text from the target window. | | |

> Note: full-window OCR is done by passing `{ window: titlePattern }` as the options argument with no region, e.g. `driver.readText(null, { window: "Notepad" })`.

---

## 9. Wait for image / wait for text (EPEA-2498)

Use **Calculator** or the **sample WinForms app**.

| Step | Expected Result | Pass/Fail | Notes |
|---|---|---|---|
| `driver.waitForImage('button.png')` while the element is appearing (EPEA-2498 AC1, AC5) | Polls until the template appears, then returns the match coordinates. | | |
| `driver.waitForText('Calculator')` (EPEA-2498 AC2, AC5) | Polls until OCR contains the string, then returns the text result. | | |
| Set custom `timeout` and `interval` options (EPEA-2498 AC3) | Both options are honoured. | | |
| Wait for an image/text that never appears (EPEA-2498 AC4) | A TimeoutError with a clear message is thrown. | | |

---

## 10. Template management (EPEA-2494, EPEA-2504)

| Step | Expected Result | Pass/Fail | Notes |
|---|---|---|---|
| Add reference images to a test's `images/` folder and refresh tests | Templates are picked up and usable by findImage/waitForImage. | | |
| Create a schedule from a test that uses images | All images from the test's `images/` folder are bundled (base64) into the schedule. | | |
| Export the schedule to a `.utsb` and re-import (EPEA-2504 AC5) | Image templates are included in the bundle and restored on import. | | |

---

## Sign-off

Complete before each release. The release is approved for Desktop mode only when every required row above is marked Pass (or has an accepted, documented exception).

| Field | Value |
|---|---|
| Tester name | |
| Date (DD MMM YYYY) | |
| Release / version | |
| Build / commit | |
| Windows version (10 / 11) | |
| Result (Approved / Rejected) | |
| Exceptions / known issues | |

Tester signature: ______________________________
