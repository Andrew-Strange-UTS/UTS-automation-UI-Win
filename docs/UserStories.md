# Marvin: User Stories

---

## Rename & Language Support

### EPEA-2486 — Rename UTS Automation UI to Marvin `13 pts`

**Description:** Replace all occurrences of the old product name (UTS Automation UI / UTS-win-automation-UI) with Marvin across the Electron window title, About screen, installer, README, and all user-facing strings. Adopt a Marvin-themed visual identity in the title bar and splash screen.

**Acceptance Criteria:**
- [x] AC1: Electron window title bar reads 'Marvin' on Windows and Linux.
- [x] AC2: Installer package and .exe are named marvin-setup-x.x.x.exe.
- [x] AC3: All in-app headings, labels, and About panel reference 'Marvin' — no legacy product name visible to the user.
- [x] AC4: README and docs/creating-tests.md updated with new name.
- [x] AC5: App tray icon tooltip reads 'Marvin'.

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
- [x] AC2: App launches via `npm run dev` on Ubuntu 22.04+ with `--no-sandbox` flag handled automatically.
- [x] AC3: Express backend starts on port 5000 as a forked child process; backend port is configurable.
- [x] AC4: A loading/splash screen is displayed until the backend health check passes.
- [x] AC5: App window is resizable, has a minimum size of 1200x700, and remembers last window position across restarts.

---

### EPEA-2488 — Desktop vs Web test mode toggle `8 pts`

**Description:** A toggle in the main UI allows switching between Desktop Tests (PowerShell + Win32) and Web Tests (Selenium + Chrome). Switching modes clears the current run sequence and shows/hides mode-specific options (e.g. OKTA environment for web, Win32 driver options for desktop). On Linux, desktop mode is disabled and the toggle is replaced with an informational message.

**Acceptance Criteria:**
- [x] AC1: Toggle is visible on the main dashboard below the Scheduled Sequences panel.
- [x] AC2: Switching mode clears the current run sequence and prompts for confirmation if the sequence is non-empty.
- [x] AC3: Web mode shows OKTA environment selector and Visual Browser option on test cards; Desktop mode hides them.
- [x] AC4: On Linux, the desktop toggle is disabled with a tooltip explaining it requires Windows.
- [x] AC5: Selected mode persists across app restarts.

---

### EPEA-2489 — Startup diagnostics screen `8 pts`

**Description:** On every launch, Marvin runs a health check sequence and displays results in a diagnostics screen before showing the main UI. Checks include: Node.js, OS platform, Git, Google Chrome/Chromium, ChromeDriver, PowerShell (Windows only), and Scheduler Service. Each check shows a pass/fail/warning badge. Users can click Continue when satisfied or click a help link next to any failed item.

**Acceptance Criteria:**
- [x] AC1: Diagnostics screen appears on every launch before the main dashboard.
- [x] AC2: All 7 checks (Node.js, OS, Git, Chrome, ChromeDriver, PowerShell, Scheduler) are shown with status badges.
- [x] AC3: PowerShell check shows N/A on Linux rather than a failure.
- [x] AC4: Failed checks display a short remediation hint and, where applicable, a clickable link to install instructions.
- [x] AC5: Continue button is always enabled — users can proceed even with failed checks.
- [x] AC6: Results are re-evaluated on each launch (not cached from previous run).

---

### EPEA-2490 — Chrome / Chromium auto-detection `8 pts`

**Description:** The Chrome finder checks a priority-ordered list of known binary locations (Linux PATH: google-chrome, google-chrome-stable, chromium-browser, chromium; Windows: Program Files\Google\Chrome, Program Files\Chromium). The detected binary is used by the web runner, sequence runner, and scheduler service. The detected path is shown in the diagnostics screen. Snap-installed Chromium is detected and flagged with a warning on Ubuntu.

**Acceptance Criteria:**
- [x] AC1: Diagnostics screen shows detected Chrome binary path when found.
- [x] AC2: Snap Chromium is detected and shows a warning about Selenium sandbox restrictions on Ubuntu.
- [x] AC3: If no Chrome is found, diagnostics shows a clear failure with install instructions.
- [x] AC4: Detected binary is used automatically — no manual config needed.
- [x] AC5: Chrome finder result is used consistently by the web runner, sequence runner, and scheduler service.

---

### EPEA-TBD-2 — Packaged app fails to start its backend, silently `8 pts`

**Description:** In the installed app the Express backend on port 5000 never starts and the UI reports "backend not found". Running the dev server separately on the same machine makes the installed app work, confirming that only the forked child fails. The cause is invisible today: `backend-manager.js` pipes the child's stdout/stderr to a console a packaged app does not have, and `startBackend` resolves on a 10s timeout regardless of whether the child died, so startup continues as if nothing is wrong.

**Acceptance Criteria:**
- [x] AC1: Backend stdout/stderr is written to a log file under `userData`, so failures are diagnosable on an installed app.
- [x] AC2: If the backend child fails to spawn or exits early, the error is captured rather than swallowed by the 10s timeout.
- [x] AC3: The UI shows the actual reason the backend is unavailable plus the log file path, instead of a generic "backend not found".
- [x] AC4: The root cause of the fork failing in the packaged app is identified and fixed. *(server/ was packed into app.asar, but the backend spawns plain `node` processes that cannot read an asar archive; server/ is now unpacked.)*
- [x] AC5: The installed app starts its own backend with no dev server running. *(Verified on the target VM: test 06 runs end to end from the installed app.)*

---

### EPEA-TBD-3 — Start the scheduler service automatically when it is not running `5 pts`

**Description:** Extends EPEA-2489. The Scheduler Service check currently reports a failure and tells the user to run a command by hand. When the service is not responding, Marvin should attempt to start it, re-check, and only report a failure if that attempt fails.

**Acceptance Criteria:**
- [x] AC1: When the scheduler check fails, Marvin attempts to start the service before reporting a problem.
- [x] AC2: After the attempt the check is re-run and the reported result reflects the retry.
- [x] AC3: If starting fails, the error distinguishes "not installed" from "installed but will not start" from "blocked by permissions".
- [x] AC4: A failed attempt never delays startup beyond a bounded timeout. *(15s start command, 5s grace for the port to bind.)*
- [x] AC5: The SchedulePanel "service is not running" banner reflects the same retry behaviour. *(Proxy attempts recovery and retries the request once; response carries reason and hint.)*

---

## Desktop Driver

### EPEA-TBD-7 — Backend must not collide on a fixed port for a second VM user `5 pts`

**Description:** The backend bound a fixed port 5000 and the renderer hardcoded `http://localhost:5000`. On a shared VM, only one process per machine can bind a port, so when a second user launched Marvin while the first still had it open, their backend failed with `EADDRINUSE` and the app reported "backend did not start". The backend now binds an OS-assigned free port and the renderer is told which one at runtime.

**Acceptance Criteria:**
- [x] AC1: The backend binds an OS-assigned free port (`PORT=0`), not a fixed 5000.
- [x] AC2: The backend reports its actual port back to the Electron main process.
- [x] AC3: The renderer learns the port at runtime (via preload) instead of hardcoding it; HTTP and WebSocket both use it.
- [x] AC4: Two users running Marvin on the same VM each get their own backend on distinct ports, with no collision.
- [ ] AC5: Verified on the VM: the second user's app starts and runs a test. *(Awaiting confirmation.)*

---

### EPEA-TBD-4 — Reuse a persistent PowerShell session for desktop actions `8 pts`

**Description:** Every desktop driver action spawned `cmd.exe` then `powershell.exe`. Measured on the target VM, that cost ~11.1s per action for the installed app and ~1.35s in dev, flat regardless of how much work the action did, so a 60-drag test took 12 minutes installed against 105s in dev. The cost is process creation, not the work, so one long-lived PowerShell process now serves a whole run.

**Acceptance Criteria:**
- [x] AC1: A single PowerShell process serves all driver actions for the duration of a test run.
- [x] AC2: Each action's output and errors are still returned individually and in order.
- [x] AC3: A failing action raises the same error shape and does not poison later actions.
- [x] AC4: The session is torn down at the end of a run, including on failure.
- [x] AC5: If the session dies mid-run it is restarted transparently rather than failing the test.
- [x] AC6: A per-action timeout is retained, so a hung command cannot hang the run.
- [x] AC7: Measured improvement is recorded against test 06 on the target VM. *(Confirmed fixed on the installed app. Baseline before the change: 11100ms per drag, 725s total draw; dev at the time was 1350ms per drag, 105s total.)*

---

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
- [x] AC1: `findControl` can locate a button by its accessible name (e.g. 'OK').
- [x] AC2: `findControl` can locate an edit field by class name (e.g. 'Edit').
- [x] AC3: `clickControl` sends a click to the located control.
- [x] AC4: `setControlText` sets the value of a text input control.
- [x] AC5: `getControlText` returns the current text value of a control.
- [x] AC6: Methods throw descriptive errors if the control is not found.

---

### EPEA-2493 — Desktop driver — keyboard and clipboard operations `13 pts`

**Description:** Add to the desktop driver: `sendShortcut(windowHandle, keys)` for keyboard combos (e.g. Ctrl+C, Alt+F4), `setClipboard(text)`, `getClipboard()`. Keyboard sending uses PowerShell SendKeys. Clipboard uses PowerShell Set-Clipboard / Get-Clipboard.

**Acceptance Criteria:**
- [x] AC1: `sendShortcut(handle, 'ctrl+a')` selects all content in the target window. *(Implemented as `driver.hotkey(modifier, key)`)*
- [x] AC2: `sendShortcut(handle, 'ctrl+c')` copies selected content to clipboard. *(Implemented as `driver.hotkey(modifier, key)`)*
- [x] AC3: `setClipboard('test value')` sets the Windows clipboard content.
- [x] AC4: `getClipboard()` returns the current clipboard text.
- [x] AC5: Shortcuts are expressed as human-readable strings ('ctrl+shift+s', 'alt+f4').

---

### EPEA-2494 — Desktop test sample and authoring guide `13 pts`

**Description:** Provide a built-in desktop-sample test (Notepad: launch, type, close, assert title). Update docs/creating-tests.md with a full Desktop Driver API reference, examples, and a copy-pasteable AI prompt for generating desktop tests.

**Acceptance Criteria:**
- [x] AC1: Built-in desktop sample test appears in the test list when no repo is loaded (Desktop mode).
- [x] AC2: Sample test runs successfully end-to-end on Windows without modification.
- [x] AC3: docs/creating-tests.md includes a Desktop Driver API reference table covering all methods.
- [x] AC4: A copy-pasteable AI prompt in the docs generates a valid desktop test when pasted into an AI tool.

---

## Image & OCR

### EPEA-2495 — Screen capture and region screenshot `13 pts`

**Description:** Add `driver.screenshot(options)` that captures: full screen, a specific window by handle, or a bounding-box region `{ x, y, width, height }`. Returns a base64 PNG buffer. On Windows, uses PowerShell + .NET System.Drawing. On Linux (web mode only), screenshots are handled by Selenium.

**Acceptance Criteria:**
- [x] AC1: `driver.screenshot()` returns a base64 PNG of the full primary screen.
- [x] AC2: `driver.screenshotWindow(outputPath, titlePattern)` returns a screenshot of the target window only.
- [x] AC3: `driver.screenshot({ region: { x, y, width, height } })` returns a cropped region. *(Implemented as `driver.screenshotRegion(outputPath, region)`)*
- [x] AC4: Returned value is a Buffer or base64 string usable with image matching.
- [x] AC5: Method works without requiring any external executable beyond PowerShell.

---

### EPEA-TBD-1 — Reference images must match the target screen resolution `3 pts`

**Description:** Image recognition compares reference images pixel-for-pixel against a screenshot of the live screen. A reference captured on a display with a different resolution or DPI scaling than the machine running the test will match unreliably or not at all. Document this for test authors and make a resolution mismatch diagnosable from the run log.

**Acceptance Criteria:**
- [x] AC1: `docs/creating-tests.md` states that reference images must be captured at the same resolution and DPI scaling as the screen Marvin runs against.
- [x] AC2: Guidance covers the common failure case of capturing locally then running on a VM at a different resolution.
- [x] AC3: A failed image match logs the screen resolution the test observed, so a mismatch is diagnosable. *(`findImage` returns `searchArea`/`reference` dimensions; failures name both.)*
- [x] AC4: The docs explain how to re-capture reference images against the target machine.

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
- [x] AC2: `driver.readText(null, { window: titlePattern })` reads all text from the target window.
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
- [x] AC2: `driver.drag({ from, to })` performs a mouse-down, move, mouse-up sequence.
- [x] AC3: `driver.scroll(x, y, delta)` scrolls up (positive delta) or down (negative delta) at the given coordinates.
- [x] AC4: Window-relative coordinates work when a `{ relativeTo: titlePattern }` option is passed.
- [x] AC5: Actions complete without requiring elevation or UAC prompts on standard user accounts.

---

### EPEA-2514 — Screenshot on test failure (automatic failure capture) `8 pts`

**Description:** When a desktop or web test throws an error, the runner automatically calls `driver.screenshot()` and saves the image to the per-run log directory. The path is included in the run log output. In the log viewer, a thumbnail of the failure screenshot is shown inline.

**Acceptance Criteria:**
- [x] AC1: A PNG screenshot is saved automatically when a test throws an error.
- [x] AC2: Screenshot path is logged in the test's log output.
- [x] AC3: The log viewer shows a thumbnail of the screenshot inline in the failed test's expanded log.
- [x] AC4: Screenshot is taken at the moment of failure, not at the end of the sequence.
- [x] AC5: Screenshots are saved per-run in a `failures/` subdirectory of the per-run sequence folder.
- [x] AC6: Failure screenshot is included in schedule export bundles.

---

### EPEA-TBD-5 — Stop a running sequence from the Run Sequence panel `5 pts`

**Description:** A running sequence can only be stopped by closing the app or waiting it out. Add a Stop control to the Run Sequence sidebar that halts the run and marks the log accordingly. Applications the test opened (Paint, a browser) are deliberately left running, matching how tests already leave them open for inspection.

**Acceptance Criteria:**
- [x] AC1: A Stop button is visible in the Run Sequence sidebar, enabled only while a sequence is running.
- [x] AC2: Clicking Stop halts the run within ~2 seconds.
- [x] AC3: Marvin's own runner process is terminated. Applications the test launched are left running, not killed.
- [x] AC4: The run log ends with a clear "Stopped by user" marker, distinct from a pass or a failure.
- [x] AC5: The UI returns to idle so a new sequence can be started straight away.
- [x] AC6: Stopping when nothing is running is a harmless no-op.
- [x] AC7: Closing the window or losing the connection stops the run the same way.
- [x] AC8: A stopped run does not post a pass/fail result to Zephyr.

---

## Web Runner

### EPEA-2500 — Selenium web runner with Chrome auto-detection `13 pts`

**Description:** Port the Selenium web runner from v2 to use the locally installed Chrome binary (detected by ChromeFinder). selenium-webdriver manages ChromeDriver automatically. Visual Browser option shows the browser window; headless mode hides it. Supports Windows and Ubuntu.

**Acceptance Criteria:**
- [x] AC1: Web tests run against locally installed Chrome without any manual ChromeDriver setup.
- [x] AC2: Visual Browser toggle shows/hides the Chrome window during test execution.
- [x] AC3: Headless mode works on both Windows and Ubuntu.
- [x] AC4: `SessionNotCreatedError` is caught and surfaced with a helpful message directing users to install Chrome.
- [x] AC5: Snap Chromium on Ubuntu shows a warning before attempting to run.

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
- [x] AC1: Schedule panel lists all schedules with name, next run time, status, and Zephyr keys.
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
- [x] AC3: Secrets file is stored in the per-user data directory, not the shared scheduler directory. *(App uses Electron userData via UTS_DATA_DIR, distinct from the shared scheduler ProgramData dir)*
- [x] AC4: A different user account on the same machine cannot read another user's secrets. *(Per-user userData dir + 0600 master key)*
- [x] AC5: Secrets persist across app restarts.

---

### EPEA-2506 — Secrets CRUD UI and secret injection into test parameters `5 pts`

**Description:** The Secrets panel provides add/edit/delete UI for secrets. Secrets are injected into test parameters at runtime using the `parameters.SECRET_NAME` syntax. A warning banner is shown on test cards that reference unknown secrets.

**Acceptance Criteria:**
- [x] AC1: Users can add a new secret by entering a name and value and clicking Save.
- [x] AC2: Users can update an existing secret's value.
- [x] AC3: Users can delete a secret with a confirmation prompt.
- [x] AC4: Secret references (`parameters.MY_SECRET`) are resolved at runtime before the test script runs.
- [x] AC5: A test card using an undefined secret reference shows a warning badge.
- [x] AC6: Secrets are never logged in the run output.

---

### EPEA-TBD-6 — Protect bundled schedule secrets at rest on a shared VM `5 pts`

**Description:** When a user creates a schedule, their decrypted secrets are bundled into it (the LocalSystem scheduler service cannot reach a user's per-user secret store at run time, so it needs its own copy). Those secrets were stored as plaintext in the shared `C:\ProgramData\uts-automation\schedules.json`. On a shared VM, default ProgramData ACLs let any standard user read that file, so one user could recover another's Okta/Zephyr/GitHub credentials. Encrypt the bundled secrets at rest with the service's machine key, and lock the shared data directory down to SYSTEM and Administrators.

**Acceptance Criteria:**
- [x] AC1: Bundled secrets are stored encrypted (AES-256-GCM, service machine key), not as plaintext, in `schedules.json`.
- [x] AC2: Schedules still run: the service decrypts bundled secrets at execution time.
- [x] AC3: Existing plaintext schedules are migrated to the encrypted form on startup.
- [x] AC4: The shared data directory ACL is restricted to SYSTEM and Administrators, so a standard user cannot read the files directly. *(Best-effort icacls at service startup on Windows; logged if it cannot be applied.)*
- [x] AC5: The API still never returns bundled secrets (encrypted or plaintext) in a schedule response.
- [ ] AC6: The export endpoint still exposes secrets to any local user by design; closing that requires per-user schedule ownership, tracked separately. *(Documented, not fixed here.)*

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

**Update (EPEA-3469):** the comment-line approach below is now a fallback. When an Atlassian account id is supplied, the native Zephyr `executedById` / `assignedToId` fields are populated instead. See EPEA-3469.

**Acceptance Criteria:**
- [x] Testers will put their name in the name field in Marvin.
- [x] All tests / automation that have the 3 Zephyr fields set will then add the name to the "Executed by" in the API call to Zephyr. *(Zephyr Cloud has no free-text executedBy field, so the name is sent in the execution comment as "Executed by: <name>")*
- [x] Name will not be mandatory.
- [x] Name can also be added to a scheduled test.

---

### EPEA-3469 — Populate Zephyr "Assigned To" and "Executed By" identity fields `5 pts`

**Description:** When Marvin publishes results to Zephyr it should set two separate native identity fields instead of leaving them "Unassigned": *Assigned To* (the user assigned to the case within the cycle) and *Executed By* (the user who ran the test). Both are populated from the person who triggered the execution in Marvin. The Zephyr Cloud API requires an Atlassian account id for these native fields, so Marvin gains an explicit "Atlassian account ID" field alongside the tester name; the existing "Executed by: <name>" comment (EPEA-2692) remains as a fallback when no account id is supplied.

**Acceptance Criteria:**
- [x] AC1: Marvin has an Atlassian account ID field (paired with the tester name) that persists across restarts. *(localStorage key `atlassianAccountId` in App.jsx; per-schedule field in SchedulePanel.jsx)*
- [x] AC2: When an account id is set, the Zephyr execution POST sets the native `executedById` field to it.
- [x] AC3: When an account id is set, the Zephyr execution POST sets `assignedToId` so the case is no longer "Unassigned" in the cycle.
- [x] AC4: When no account id is available, reporting still succeeds and falls back to the "Executed by: <name>" comment line, without crashing.
- [x] AC5: Both fields are populated for interactive runs (sequence.js) and for scheduled runs (scheduler-service.js).
- [x] AC6: Behaviour applies per test that has the three Zephyr keys configured. *(unchanged per-step Zephyr reporting path)*

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
- [x] AC4: Optional custom ntfy server URL is supported.
- [x] AC5: ntfy failure (e.g. network issue) is logged but does not affect the test run.

---

## Repo & Distribution

### EPEA-TBD-8 — Remember GitHub repo history for quicker reloading `2 pts`

**Description:** The repo URL, desktop/web mode, and Zephyr identity fields already persist per user across restarts (localStorage). Add a **history of recently used GitHub repos** so switching between repos is quick: successful clones are remembered and offered as suggestions and clickable chips.

**Acceptance Criteria:**
- [x] AC1: A repo URL that clones successfully is added to a per-user history (most recent first, deduped, capped).
- [x] AC2: The repo input suggests history entries as you type (datalist).
- [x] AC3: Recent repos show as clickable chips below the input; clicking one loads it into the field.
- [x] AC4: A Clear control empties the history.
- [x] AC5: History persists across restarts and survives an app rebuild.
- [x] AC6: Confirmed that mode, tester name, and Atlassian account ID already persist across restarts (no change needed, same localStorage mechanism as the repo URL).

---

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
- [x] AC1: docs/acceptance-web.md exists in the repo and is up to date with all Web mode stories.
- [x] AC2: Each checklist item references the relevant Jira story ID.
- [x] AC3: Checklist is structured as a markdown table: Step / Expected Result / Pass-Fail / Notes.
- [x] AC4: Checklist has a per-release sign-off section for a tester to complete.
- [x] AC5: A tester can execute the full checklist on a fresh install in under 60 minutes.

---

### EPEA-2513 — Tester onboarding — acceptance test checklist for Desktop mode `8 pts`

**Description:** Produce docs/acceptance-desktop.md covering: desktop driver basic control, element interaction, keyboard/clipboard, image recognition, OCR, wait methods, mouse control, template management, sample test run.

**Acceptance Criteria:**
- [x] AC1: docs/acceptance-desktop.md exists and covers all Desktop mode epic stories.
- [x] AC2: Each item references the relevant Jira story ID.
- [x] AC3: Checklist includes specific test apps to use (Notepad, Calculator, a sample WinForms app).
- [x] AC4: Pass/fail column present for tester to fill in.
- [x] AC5: Full checklist executable in under 45 minutes on Windows 10/11.

---

### EPEA-2516 — Test dry-run mode (validate without executing) `5 pts`

**Description:** Add a Dry Run button to the sequence runner sidebar. Dry run checks: all required parameters are populated, all referenced secrets exist, Zephyr keys are valid (format check), OKTA environment is accessible (optional ping). Returns a validation report per test with pass/warn/fail items. Does not execute any test scripts.

**Acceptance Criteria:**
- [x] AC1: Dry Run button is available in the Run Sequence sidebar.
- [x] AC2: Dry run completes within 5 seconds.
- [x] AC3: Reports a Fail for any test card with a missing (empty) required parameter.
- [x] AC4: Reports a Fail for any test card referencing an undefined secret.
- [x] AC5: Reports a Warning for Zephyr keys that do not match expected format (e.g. missing prefix).
- [x] AC6: Reports a Pass for each test card that has no configuration issues.
- [x] AC7: Dry run report is displayed in the log viewer in the same expandable format as a real run.

---

**Total stories:** 33
**Total points:** 308
**Assignee:** Andrew Strange

---

## Progress Summary

| Category | Stories | Fully Complete | Partially Complete | Not Started |
|----------|---------|----------------|--------------------|-------------|
| Rename & Language Support | 2 | 1 (EPEA-2486) | 0 | 1 (EPEA-1916) |
| Electron Shell & Startup | 4 | 4 (EPEA-2487, EPEA-2488, EPEA-2489, EPEA-2490) | 0 | 0 |
| Desktop Driver | 4 | 4 (EPEA-2491, EPEA-2492, EPEA-2493, EPEA-2494) | 0 | 0 |
| Image & OCR | 6 | 6 (EPEA-2495, EPEA-2496, EPEA-2497, EPEA-2498, EPEA-2499, EPEA-2514) | 0 | 0 |
| Web Runner | 2 | 2 (EPEA-2500, EPEA-2501) | 0 | 0 |
| Scheduling | 3 | 3 (EPEA-2502, EPEA-2503, EPEA-2504) | 0 | 0 |
| Secrets Management | 2 | 2 (EPEA-2505, EPEA-2506) | 0 | 0 |
| Reporting & Notifications | 5 | 5 (EPEA-2507, EPEA-2508, EPEA-2509, EPEA-2692, EPEA-3469) | 0 | 0 |
| Repo & Distribution | 2 | 2 (EPEA-2510, EPEA-2511) | 0 | 0 |
| Testing & Onboarding | 3 | 3 (EPEA-2512, EPEA-2513, EPEA-2516) | 0 | 0 |
| **Totals** | **33** | **32** | **0** | **1** |
