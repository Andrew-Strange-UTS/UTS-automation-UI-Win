# Marvin — TODO

---

## Rename & Language Support

### EPEA-2486 — Rename UTS Automation UI to Marvin `13 pts`

**Description:** Replace all occurrences of the old product name (UTS Automation UI / UTS-win-automation-UI) with Marvin across the Electron window title, About screen, installer, README, and all user-facing strings. Adopt a Marvin-themed visual identity in the title bar and splash screen.

**Acceptance Criteria:**
- [x] AC1: Electron window title bar reads 'Marvin' on Windows and Linux.
- [x] AC2: Installer package and .exe are named marvin-setup-x.x.x.exe.
- [x] AC3: All in-app headings, labels, and About panel reference 'Marvin' — no legacy product name visible to the user.
- [x] AC4: README and docs/creating-tests.md updated with new name.
- [ ] AC5: App tray icon tooltip reads 'Marvin'.

---

### EPEA-1916 — Add new languages support C# .NET — Can different langs be run at the same time? `20 pts`

**Description:** To add more development languages to enable more people to use automation tools, more easily and drive adoption.

**Acceptance Criteria:** TBC
- [ ] Add ability to use tests in different languages.
- [ ] Adding a way of translating languages.

---

## Electron Shell & Startup

### EPEA-2487 — Electron app shell with startup window `13 pts`

**Description:** The app opens as a native Electron window on Windows 10/11 and Ubuntu. It forks the Express backend as a child process on startup. The React/Vite renderer is served from within the Electron window. A splash/loading screen is displayed while the backend initialises.

**Acceptance Criteria:**
- [x] AC1: App launches via `npm run dev` (dev) and the installed .exe (production) on Windows 10/11.
- [ ] AC2: App launches via `npm run dev` on Ubuntu 22.04+ with `--no-sandbox` flag handled automatically. *(--no-sandbox in dev script only, not handled in production Electron config)*
- [x] AC3: Express backend starts on port 5000 as a forked child process; backend port is configurable.
- [ ] AC4: A loading/splash screen is displayed until the backend health check passes. *(Not implemented)*
- [ ] AC5: App window is resizable, has a minimum size of 1200x700, and remembers last window position across restarts. *(Min size is 900x600; no window position memory)*

---

### EPEA-2488 — Desktop vs Web test mode toggle `8 pts`

**Description:** A toggle in the main UI allows switching between Desktop Tests (PowerShell + Win32) and Web Tests (Selenium + Chrome). Switching modes clears the current run sequence and shows/hides mode-specific options (e.g. OKTA environment for web, Win32 driver options for desktop). On Linux, desktop mode is disabled and the toggle is replaced with an informational message.

**Acceptance Criteria:**
- [x] AC1: Toggle is visible on the main dashboard below the Scheduled Sequences panel.
- [ ] AC2: Switching mode clears the current run sequence and prompts for confirmation if the sequence is non-empty. *(Clears sequence but no confirmation prompt)*
- [x] AC3: Web mode shows OKTA environment selector and Visual Browser option on test cards; Desktop mode hides them.
- [ ] AC4: On Linux, the desktop toggle is disabled with a tooltip explaining it requires Windows. *(Not implemented)*
- [x] AC5: Selected mode persists across app restarts.

---

### EPEA-2489 — Startup diagnostics screen `8 pts`

**Description:** On every launch, Marvin runs a health check sequence and displays results in a diagnostics screen before showing the main UI. Checks include: Node.js, OS platform, Git, Google Chrome/Chromium, ChromeDriver, PowerShell (Windows only), and Scheduler Service. Each check shows a pass/fail/warning badge. Users can click Continue when satisfied or click a help link next to any failed item.

**Acceptance Criteria:**
- [x] AC1: Diagnostics screen appears on every launch before the main dashboard.
- [x] AC2: All 7 checks (Node.js, OS, Git, Chrome, ChromeDriver, PowerShell, Scheduler) are shown with status badges.
- [x] AC3: PowerShell check shows N/A on Linux rather than a failure.
- [ ] AC4: Failed checks display a short remediation hint and, where applicable, a clickable link to install instructions. *(Shows status/details only, no remediation hints or install links)*
- [x] AC5: Continue button is always enabled — users can proceed even with failed checks.
- [x] AC6: Results are re-evaluated on each launch (not cached from previous run).

---

### EPEA-2490 — Chrome / Chromium auto-detection `8 pts`

**Description:** The Chrome finder checks a priority-ordered list of known binary locations (Linux PATH: google-chrome, google-chrome-stable, chromium-browser, chromium; Windows: Program Files\Google\Chrome, Program Files\Chromium). The detected binary is used by the web runner, sequence runner, and scheduler service. The detected path is shown in the diagnostics screen. Snap-installed Chromium is detected and flagged with a warning on Ubuntu.

**Acceptance Criteria:**
- [x] AC1: Diagnostics screen shows detected Chrome binary path when found.
- [ ] AC2: Snap Chromium is detected and shows a warning about Selenium sandbox restrictions on Ubuntu. *(Not implemented)*
- [x] AC3: If no Chrome is found, diagnostics shows a clear failure with install instructions.
- [x] AC4: Detected binary is used automatically — no manual config needed.
- [x] AC5: Chrome finder result is used consistently by the web runner, sequence runner, and scheduler service.

---

## Desktop Driver

### EPEA-2491 — PowerShell desktop driver — basic window control `13 pts`

**Description:** Implement a desktop driver that exposes an async API backed by PowerShell + Win32 APIs. Core operations: `launch(exePath)`, `findWindow(titlePattern)`, `closeWindow(handle)`, `sendKeys(handle, text)`, `click(handle, x, y)`. The driver is injected into desktop run.js files as the first argument (same signature as Selenium driver for web tests).

**Acceptance Criteria:**
- [x] AC1: `driver.launch('notepad.exe')` opens Notepad and returns a window handle.
- [x] AC2: `driver.findWindow('Notepad')` returns a handle for a window whose title contains the pattern.
- [x] AC3: `driver.closeWindow(handle)` closes the window gracefully.
- [x] AC4: `driver.sendKeys(handle, 'Hello world')` types text into the focused control of the target window. *(Implemented as `driver.type(text)`)*
- [x] AC5: `driver.click(handle, x, y)` sends a mouse click at screen coordinates relative to the window. *(Implemented as `driver.mouseClick(x, y)`)*
- [x] AC6: All methods are async and return Promises.
- [x] AC7: Errors from PowerShell (e.g. window not found) are surfaced as thrown Errors with descriptive messages.

---

### EPEA-2492 — Desktop driver — element interaction by control ID and class `13 pts`

**Description:** Extend the desktop driver with methods: `findControl(windowHandle, { className, controlId, name })`, `clickControl(controlHandle)`, `setControlText(controlHandle, text)`, `getControlText(controlHandle)`. Uses PowerShell + UI Automation (UIAutomation COM) for accessible element traversal.

**Acceptance Criteria:**
- [ ] AC1: `findControl` can locate a button by its accessible name (e.g. 'OK').
- [ ] AC2: `findControl` can locate an edit field by class name (e.g. 'Edit').
- [ ] AC3: `clickControl` sends a click to the located control.
- [ ] AC4: `setControlText` sets the value of a text input control.
- [ ] AC5: `getControlText` returns the current text value of a control.
- [ ] AC6: Methods throw descriptive errors if the control is not found.

---

### EPEA-2493 — Desktop driver — keyboard and clipboard operations `13 pts`

**Description:** Add to the desktop driver: `sendShortcut(windowHandle, keys)` for keyboard combos (e.g. Ctrl+C, Alt+F4), `setClipboard(text)`, `getClipboard()`. Keyboard sending uses PowerShell SendKeys. Clipboard uses PowerShell Set-Clipboard / Get-Clipboard.

**Acceptance Criteria:**
- [x] AC1: `sendShortcut(handle, 'ctrl+a')` selects all content in the target window. *(Implemented as `driver.hotkey(modifier, key)`)*
- [x] AC2: `sendShortcut(handle, 'ctrl+c')` copies selected content to clipboard. *(Implemented as `driver.hotkey(modifier, key)`)*
- [ ] AC3: `setClipboard('test value')` sets the Windows clipboard content. *(Not implemented)*
- [ ] AC4: `getClipboard()` returns the current clipboard text. *(Not implemented)*
- [x] AC5: Shortcuts are expressed as human-readable strings ('ctrl+shift+s', 'alt+f4').

---

### EPEA-2494 — Desktop test sample and authoring guide `13 pts`

**Description:** Provide a built-in desktop-sample test (Notepad: launch, type, close, assert title). Update docs/creating-tests.md with a full Desktop Driver API reference, examples, and a copy-pasteable AI prompt for generating desktop tests.

**Acceptance Criteria:**
- [x] AC1: Built-in desktop sample test appears in the test list when no repo is loaded (Desktop mode).
- [x] AC2: Sample test runs successfully end-to-end on Windows without modification.
- [x] AC3: docs/creating-tests.md includes a Desktop Driver API reference table covering all methods.
- [ ] AC4: A copy-pasteable AI prompt in the docs generates a valid desktop test when pasted into an AI tool. *(Not included in docs)*

---

## Image & OCR

### EPEA-2495 — Screen capture and region screenshot `13 pts`

**Description:** Add `driver.screenshot(options)` that captures: full screen, a specific window by handle, or a bounding-box region `{ x, y, width, height }`. Returns a base64 PNG buffer. On Windows, uses PowerShell + .NET System.Drawing. On Linux (web mode only), screenshots are handled by Selenium.

**Acceptance Criteria:**
- [x] AC1: `driver.screenshot()` returns a base64 PNG of the full primary screen.
- [ ] AC2: `driver.screenshot({ handle })` returns a screenshot of the target window only. *(Only full-screen capture implemented)*
- [x] AC3: `driver.screenshot({ region: { x, y, width, height } })` returns a cropped region. *(Implemented as `driver.screenshotRegion(outputPath, region)`)*
- [x] AC4: Returned value is a Buffer or base64 string usable with image matching.
- [x] AC5: Method works without requiring any external executable beyond PowerShell.

---

### EPEA-2496 — Image template matching (find element by image) `13 pts`

**Description:** Implement `driver.findByImage(templatePath, options)` using OpenCV (opencv4nodejs or sharp + custom template matching). Returns `{ x, y, width, height, confidence }` of the best match. Optional threshold parameter (default 0.85). Throws if no match above threshold. `driver.clickImage(templatePath)` combines find and click in one call.

**Acceptance Criteria:**
- [x] AC1: `driver.findByImage('./templates/ok-button.png')` returns coordinates when the button is visible on screen. *(Implemented as `driver.findImage()`)*
- [x] AC2: Returns a confidence score between 0 and 1.
- [x] AC3: Throws `ImageNotFoundError` with a descriptive message when confidence is below threshold.
- [x] AC4: `driver.clickImage('./templates/ok-button.png')` combines find and click in one call.
- [x] AC5: `threshold` option allows the caller to tighten or loosen matching sensitivity.
- [x] AC6: Works with PNG and JPEG template images.

---

### EPEA-2497 — OCR — read text from screen region `13 pts`

**Description:** Implement `driver.readText(options)` using Tesseract.js (pure Node, no external binary needed). Options: `region { x, y, width, height }` or `handle` for full-window OCR. Returns a string. Optional `lang` parameter (default 'eng').

**Acceptance Criteria:**
- [x] AC1: `driver.readText({ region })` returns a string containing the visible text in that region.
- [ ] AC2: `driver.readText({ handle })` reads all text from the target window. *(Window-handle OCR not implemented, only region-based)*
- [x] AC3: Result is trimmed and normalised (no excessive whitespace).
- [x] AC4: `lang` option accepts Tesseract language codes ('eng', 'fra', etc.).
- [x] AC5: Throws a descriptive error if the screenshot fails, rather than returning empty string silently.

---

### EPEA-2498 — Wait for image / wait for text (polling assertions) `8 pts`

**Description:** Add `driver.waitForImage(templatePath, options)` and `driver.waitForText(text, options)`. Both poll at a configurable interval (default 500ms) until the condition is met or a timeout is reached (default 10s). Returns the match result on success. Throws on timeout.

**Acceptance Criteria:**
- [x] AC1: `waitForImage` polls until the template appears or timeout is reached.
- [x] AC2: `waitForText` polls until the OCR result contains the given string or timeout is reached.
- [x] AC3: `timeout` option (ms) and `interval` option (ms) are configurable.
- [x] AC4: Both throw a `TimeoutError` with a clear message on timeout.
- [x] AC5: Both return the match result (coordinates or text) when the condition is met.

---

### EPEA-2499 — Mouse control — hover, drag, scroll `5 pts`

**Description:** Extend the desktop driver with: `driver.hover(x, y)`, `driver.drag({ from: {x,y}, to: {x,y} })`, `driver.scroll(x, y, delta)`. Uses PowerShell + SendInput Win32 API. All coordinates are screen-absolute unless a window handle is provided, in which case they are window-relative.

**Acceptance Criteria:**
- [x] AC1: `driver.hover(x, y)` moves the mouse cursor to the given screen coordinates. *(Implemented as `driver.mouseMove(x, y)`)*
- [ ] AC2: `driver.drag({ from, to })` performs a mouse-down, move, mouse-up sequence. *(Not implemented)*
- [ ] AC3: `driver.scroll(x, y, delta)` scrolls up (positive delta) or down (negative delta) at the given coordinates. *(Not implemented)*
- [ ] AC4: Window-relative coordinates work when a handle is passed. *(Not implemented)*
- [x] AC5: Actions complete without requiring elevation or UAC prompts on standard user accounts.

---

### EPEA-2514 — Screenshot on test failure (automatic failure capture) `8 pts`

**Description:** When a desktop or web test throws an error, the runner automatically calls `driver.screenshot()` and saves the image to the per-run log directory. The path is included in the run log output. In the log viewer, a thumbnail of the failure screenshot is shown inline.

**Acceptance Criteria:**
- [ ] AC1: A PNG screenshot is saved automatically when a test throws an error.
- [ ] AC2: Screenshot path is logged in the test's log output.
- [ ] AC3: The log viewer shows a thumbnail of the screenshot inline in the failed test's expanded log.
- [ ] AC4: Screenshot is taken at the moment of failure, not at the end of the sequence.
- [ ] AC5: Screenshots are saved per-run in a subdirectory named by run timestamp.
- [ ] AC6: Failure screenshot is included in schedule export bundles.

---

## Web Runner

### EPEA-2500 — Selenium web runner with Chrome auto-detection `13 pts`

**Description:** Port the Selenium web runner from v2 to use the locally installed Chrome binary (detected by ChromeFinder). selenium-webdriver manages ChromeDriver automatically. Visual Browser option shows the browser window; headless mode hides it. Supports Windows and Ubuntu.

**Acceptance Criteria:**
- [x] AC1: Web tests run against locally installed Chrome without any manual ChromeDriver setup.
- [x] AC2: Visual Browser toggle shows/hides the Chrome window during test execution.
- [x] AC3: Headless mode works on both Windows and Ubuntu.
- [ ] AC4: `SessionNotCreatedError` is caught and surfaced with a helpful message directing users to install Chrome. *(No explicit error handling)*
- [ ] AC5: Snap Chromium on Ubuntu shows a warning before attempting to run. *(Not implemented)*

---

### EPEA-2501 — OKTA login wrapping for web tests `8 pts`

**Description:** Port OKTA wrapping from v2. Test cards have an OKTA Environment selector (None, Prod, Pre-prod, Test). The sequence runner injects okta-login before and okta-login-finish after tests in the same OKTA group, reusing the browser session.

**Acceptance Criteria:**
- [x] AC1: OKTA Environment selector appears on test cards in Web mode.
- [x] AC2: Tests with the same OKTA environment share a browser session.
- [x] AC3: OKTA login step runs once per group, not before each test.
- [x] AC4: okta-login-finish runs after the last test in the group.
- [x] AC5: Tests with OKTA = None run in their own session without any login wrapping.

---

## Scheduling

### EPEA-2502 — Scheduler Service `13 pts`

**Description:** Implement scheduler-service.js as a standalone Express process on port 5050. It manages cron jobs, stores schedules in a shared data directory (`C:\ProgramData\uts-automation` on Windows, `/var/lib/uts-automation` on Linux). The Electron app proxies schedule API calls to this service. The service can be installed as a Windows Service (node-windows) or systemd unit.

**Acceptance Criteria:**
- [x] AC1: Scheduler service starts independently with `node scheduler-service.js`.
- [x] AC2: Service responds to `GET /api/health` with `{ status: 'ok', uptime, schedules }`.
- [x] AC3: Schedules run on time even when the Electron app is closed.
- [x] AC4: Data directory defaults to `C:\ProgramData\uts-automation` (Windows) and `/var/lib/uts-automation` (Linux).
- [x] AC5: `UTS_SCHEDULER_DATA_DIR` env var overrides the data directory.
- [x] AC6: Service installs as a Windows Service via `node scripts/install-service-win.js`.
- [x] AC7: Service installs as a systemd unit via `sudo bash scripts/install-service-linux.sh`.

---

### EPEA-2503 — Schedule creation, editing and management UI `8 pts`

**Description:** Port the Scheduled Sequences panel from v2 to the Electron app. Features: create schedule (name, time, days/presets), inline edit, run now, pause/resume, stop, countdown to next run, last run log viewer, Zephyr keys displayed on card.

**Acceptance Criteria:**
- [ ] AC1: Schedule panel lists all schedules with name, next run time, status, and Zephyr keys. *(Lists name, next run, status — but Zephyr keys not shown on schedule cards)*
- [x] AC2: Clicking '+ New Schedule' opens a creation form with name, time, days, and notification fields.
- [x] AC3: Inline edit allows changing name, time, days, and notification settings without a separate screen.
- [x] AC4: Run Now triggers an immediate execution without affecting the cron schedule.
- [x] AC5: Pause/Resume toggles the schedule without deleting it.
- [x] AC6: Last run log is accessible from the schedule card.
- [x] AC7: Countdown timer updates every second and shows time until next run.

---

### EPEA-2504 — Export and import schedules as encrypted .utsb bundles `8 pts`

**Description:** Port the export/import feature from v2. Export bundles test code, secrets, Zephyr config, schedule timing, image templates, and notification settings into an encrypted .utsb file (PBKDF2 + AES-256-GCM). Import extracts the bundle, writes test code to disk, and merges secrets into the local store.

**Acceptance Criteria:**
- [x] AC1: Clicking Export on a schedule prompts for a password and downloads a .utsb file.
- [x] AC2: The .utsb file is not readable as plain text (encrypted).
- [x] AC3: Importing a .utsb on a different machine with the correct password restores the schedule exactly.
- [x] AC4: Import fails gracefully (descriptive error) if the password is wrong.
- [x] AC5: Image templates are included in the exported bundle and restored on import.
- [x] AC6: Bundled secrets are merged into the local secrets store on import without overwriting unrelated secrets.

---

## Secrets Management

### EPEA-2505 — User encrypted secrets store `8 pts`

**Description:** Secrets are stored AES-256-GCM encrypted using a machine+user-specific master key in the per-user data directory (%APPDATA% on Windows, ./data on Linux/dev). Default secrets (ZEPHYR_API_TOKEN, GITHUB_PERSONAL_ACCESS_TOKEN, GITHUB_USERNAME) are created with blank values on first run. Values are never shown in the UI after entry.

**Acceptance Criteria:**
- [x] AC1: Opening Secrets Manager shows the three default secrets with blank values on first run.
- [x] AC2: Secret values are not displayed once saved — only a masked indicator is shown.
- [ ] AC3: Secrets file is stored in the per-user data directory, not the shared scheduler directory. *(Currently uses shared data directory)*
- [ ] AC4: A different user account on the same machine cannot read another user's secrets. *(Shared store, not per-user isolated)*
- [x] AC5: Secrets persist across app restarts.

---

### EPEA-2506 — Secrets CRUD UI and secret injection into test parameters `5 pts`

**Description:** The Secrets panel provides add/edit/delete UI for secrets. Secrets are injected into test parameters at runtime using the `parameters.SECRET_NAME` syntax. A warning banner is shown on test cards that reference unknown secrets.

**Acceptance Criteria:**
- [x] AC1: Users can add a new secret by entering a name and value and clicking Save.
- [x] AC2: Users can update an existing secret's value.
- [x] AC3: Users can delete a secret with a confirmation prompt.
- [x] AC4: Secret references (`parameters.MY_SECRET`) are resolved at runtime before the test script runs.
- [ ] AC5: A test card using an undefined secret reference shows a warning badge. *(Not implemented)*
- [x] AC6: Secrets are never logged in the run output.

---

## Reporting & Notifications

### EPEA-2507 — Zephyr Scale result reporting per test `5 pts`

**Description:** Port Zephyr Scale integration from v2. Each test card has Project Key, Case Key, and Cycle Key fields. After each test, the sequence runner posts pass/fail and per-step zephyrLog results to the Zephyr Scale Cloud API using ZEPHYR_API_TOKEN.

**Acceptance Criteria:**
- [x] AC1: Project Key, Case Key, and Cycle Key fields appear on each test card.
- [x] AC2: A passing test posts a Pass result to the specified Zephyr case.
- [x] AC3: A failing test posts a Fail result with step details.
- [x] AC4: Per-step results (from zephyrLog calls) are included in the execution record.
- [x] AC5: Missing or invalid ZEPHYR_API_TOKEN is caught and reported in the UI without crashing the run.
- [x] AC6: Zephyr reporting is optional — tests without a Cycle Key skip reporting silently.

---

### EPEA-2692 — Test Executed by in Zephyr API call and from a name field in Marvin `13 pts`

**Description:** Add support for a tester name in Marvin and, when publishing results to Zephyr, pass that name through to Zephyr as Executed by.

**Acceptance Criteria:**
- [ ] Testers will put their name in the name field in Marvin.
- [ ] All tests / automation that have the 3 Zephyr fields set will then add the name to the "Executed by" in the API call to Zephyr.
- [ ] Name will not be mandatory.
- [ ] Name can also be added to a scheduled test.

---

### EPEA-2508 — Microsoft Teams webhook notifications `5 pts`

**Description:** Schedules support two Teams webhook URLs: one for all results, one for failures only. A Teams Adaptive Card is posted with: schedule name, run time, pass/fail count, and a summary of failed tests. Notify setting per schedule: Always / Failure only / Never.

**Acceptance Criteria:**
- [x] AC1: Teams webhook URL field appears in schedule configuration.
- [x] AC2: A failure triggers a Teams card with schedule name, timestamp, and failed test names.
- [x] AC3: Always setting sends a card for every run regardless of outcome.
- [x] AC4: Never setting suppresses all notifications for the schedule.
- [x] AC5: Invalid webhook URL is caught and logged without crashing the scheduler.
- [x] AC6: Two separate URL fields available: All results and Failures only.

---

### EPEA-2509 — ntfy push notifications `5 pts`

**Description:** Schedules support an ntfy topic name. When a run completes (or fails, per notify setting), a push notification is sent to ntfy.sh/{topic}. Notification includes schedule name and pass/fail summary. No account required — uses the public ntfy.sh server by default, with an optional custom server URL.

**Acceptance Criteria:**
- [x] AC1: ntfy topic field appears in schedule notification settings.
- [x] AC2: A notification is sent to ntfy.sh/{topic} on the configured trigger event.
- [x] AC3: Notification title is the schedule name; body includes pass/fail count.
- [ ] AC4: Optional custom ntfy server URL is supported. *(Hardcoded to ntfy.sh)*
- [x] AC5: ntfy failure (e.g. network issue) is logged but does not affect the test run.

---

## Repo & Distribution

### EPEA-2510 — Clone test repos (public and private) `5 pts`

**Description:** Port Git integration from v2. Users paste a GitHub URL and optionally tick Private repository. Marvin clones the repo using GITHUB_USERNAME + GITHUB_PERSONAL_ACCESS_TOKEN from the secrets store. A PAT setup popup guides users through token creation if secrets are missing. The tests/ directory is scanned and test cards are rendered for each found test.

**Acceptance Criteria:**
- [x] AC1: Pasting a public GitHub URL and clicking Refresh Tests clones the repo and shows test cards.
- [x] AC2: Private repo checkbox enables PAT-based authentication.
- [x] AC3: If PAT secrets are missing, a setup popup explains how to create a GitHub PAT with repo scope.
- [x] AC4: Tests are shown as cards with title from metadata.json (or folder name as fallback).
- [x] AC5: Refresh Tests re-clones or pulls the latest version of the repo.
- [x] AC6: Clone errors (e.g. wrong URL, auth failure) are shown as inline error messages.

---

### EPEA-2511 — Windows Installer & Distribution `13 pts`

**Description:** electron-builder with NSIS packages the app into a single .exe installer. The installer bundles the Electron binary, all npm dependencies, and built renderer assets. A portable Git binary is included for machines without Git installed.

**Acceptance Criteria:**
- [x] AC1: `npm run dist` produces a marvin-setup-x.x.x.exe in the dist/ folder on Windows.
- [x] AC2: Installer can be run on a clean Windows 10/11 machine with no dev tools installed.
- [x] AC3: After installation, Marvin launches correctly from the Start menu shortcut.
- [x] AC4: Scheduler service is installable via `node scripts/install-service-win.js` after installation.
- [x] AC5: Uninstaller cleanly removes the app and shortcuts.

---

## Testing & Onboarding

### EPEA-2512 — Tester onboarding — acceptance test checklist for Web mode `8 pts`

**Description:** Produce a living acceptance test checklist document (docs/acceptance-web.md) covering: startup, Chrome detection, repo loading, test card config, sequence execution, OKTA wrapping, Zephyr reporting, Secrets Manager, scheduling, ntfy/Teams notifications, export/import. Each item maps to a Jira story AC.

**Acceptance Criteria:**
- [ ] AC1: docs/acceptance-web.md exists in the repo and is up to date with all Web mode stories.
- [ ] AC2: Each checklist item references the relevant Jira story ID.
- [ ] AC3: Checklist is structured as a markdown table: Step / Expected Result / Pass-Fail / Notes.
- [ ] AC4: Checklist is reviewed and signed off by a tester before each release.
- [ ] AC5: A tester can execute the full checklist on a fresh install in under 60 minutes.

---

### EPEA-2513 — Tester onboarding — acceptance test checklist for Desktop mode `8 pts`

**Description:** Produce docs/acceptance-desktop.md covering: desktop driver basic control, element interaction, keyboard/clipboard, image recognition, OCR, wait methods, mouse control, template management, sample test run.

**Acceptance Criteria:**
- [ ] AC1: docs/acceptance-desktop.md exists and covers all Desktop mode epic stories.
- [ ] AC2: Each item references the relevant Jira story ID.
- [ ] AC3: Checklist includes specific test apps to use (Notepad, Calculator, a sample WinForms app).
- [ ] AC4: Pass/fail column present for tester to fill in.
- [ ] AC5: Full checklist executable in under 45 minutes on Windows 10/11.

---

### EPEA-2516 — Test dry-run mode (validate without executing) `5 pts`

**Description:** Add a Dry Run button to the sequence runner sidebar. Dry run checks: all required parameters are populated, all referenced secrets exist, Zephyr keys are valid (format check), OKTA environment is accessible (optional ping). Returns a validation report per test with pass/warn/fail items. Does not execute any test scripts.

**Acceptance Criteria:**
- [ ] AC1: Dry Run button is available in the Run Sequence sidebar.
- [ ] AC2: Dry run completes within 5 seconds.
- [ ] AC3: Reports a Fail for any test card with a missing required parameter.
- [ ] AC4: Reports a Fail for any test card referencing an undefined secret.
- [ ] AC5: Reports a Warning for Zephyr keys that do not match expected format (e.g. missing prefix).
- [ ] AC6: Reports a Pass for each test card that has no configuration issues.
- [ ] AC7: Dry run report is displayed in the log viewer in the same expandable format as a real run.

---

**Total stories:** 33
**Total points:** 303
**Assignee:** Andrew Strange

---

## Progress Summary

| Category | Stories | Fully Complete | Partially Complete | Not Started |
|----------|---------|----------------|--------------------|-------------|
| Rename & Language Support | 2 | 0 | 1 (EPEA-2486) | 1 (EPEA-1916) |
| Electron Shell & Startup | 4 | 0 | 4 | 0 |
| Desktop Driver | 4 | 0 | 3 | 1 (EPEA-2492) |
| Image & OCR | 6 | 2 (EPEA-2496, EPEA-2498) | 3 | 1 (EPEA-2514) |
| Web Runner | 2 | 1 (EPEA-2501) | 1 | 0 |
| Scheduling | 3 | 2 (EPEA-2502, EPEA-2504) | 1 | 0 |
| Secrets Management | 2 | 0 | 2 | 0 |
| Reporting & Notifications | 4 | 2 (EPEA-2507, EPEA-2508) | 1 | 1 (EPEA-2692) |
| Repo & Distribution | 2 | 2 (EPEA-2510, EPEA-2511) | 0 | 0 |
| Testing & Onboarding | 3 | 0 | 0 | 3 |
| **Totals** | **33** | **9** | **15** | **7** |
