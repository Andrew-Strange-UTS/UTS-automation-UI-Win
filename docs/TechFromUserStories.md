# Marvin: Technical Log (from User Stories)

Technical companion to [`UserStories.md`](UserStories.md). One entry per user story ID, with a brief description of what was actually built and the files created or modified. Updated continuously as stories are worked, so this file plus `UserStories.md` always show exactly where the project is up to.

Entries below cover the 31 completed stories, backfilled from the current codebase.

---

## Rename & Language Support

### EPEA-2486 — Rename UTS Automation UI to Marvin
Electron window `title` set to "Marvin" on both windows; tray tooltip and menu labels use "Marvin" (`tray.setToolTip("Marvin")`, "Show Marvin"); packaging metadata set to `name: "marvin"` / `productName: "Marvin"` with NSIS installer naming; README H1 and service name renamed.
- `main/main.js`, `package.json`, `README.md`, `docs/creating-tests.md`

### EPEA-1916 — Add C# .NET language support
Not started. Design groundwork exists in `docs/design-dotnet-support.md`; no implementation yet.

---

## Electron Shell & Startup

### EPEA-2487 — Electron app shell with startup window
On `app.whenReady()` a frameless transparent splash is shown, then `backend-manager.js` `fork`s the Express server on `PORT=5000` as an IPC child (resolves on `"ready"`, 10s fallback). Main process polls `/api/health` (300ms interval, 15s timeout) before creating the main `BrowserWindow` (`minWidth:1200`, `minHeight:700`), destroying the splash on `ready-to-show`. Window bounds persist to `window-state.json` in `userData` (debounced), restored only when still visible on a connected display.
- `main/main.js`, `main/backend-manager.js`, `main/splash.html`, `main/preload.js`

### EPEA-2488 — Desktop vs Web test mode toggle
`App.jsx` holds `testType` state (defaults to `"web"` on Linux, `"desktop"` otherwise). `handleSwitchTestType` confirms and clears the run sequence when switching would discard queued tests, blocks `"desktop"` on Linux, and toggles mode-specific options. Desktop button is `disabled` on Linux with an explanatory tooltip and warning banner; platform detected via Electron/`navigator.userAgent`.
- `renderer/src/App.jsx`

### EPEA-2489 — Startup diagnostics screen (7 checks)
`GET /api/health` returns `{ checks, features, platform }`, running seven probes: Node, OS, Git (`git --version`), Chrome (via chromeFinder), ChromeDriver (`chromedriver --version` with selenium auto-manage fallback), PowerShell (`$PSVersionTable` on Windows / `pwsh` probe elsewhere), and Scheduler (fetches `SCHEDULER_URL/api/health`, 3s AbortController). `StartupChecks.jsx` renders a status table with pass/fail/warn icons, hints, and install links.
- `server/routes/health.js`, `renderer/src/components/StartupChecks.jsx`

### EPEA-2490 — Chrome / Chromium auto-detection
`findChromeBinary` scans priority-ordered locations per platform (Windows env paths for Chrome then Chromium; macOS `.app` paths; Linux commands via `which`) without launching the browser. Results are cached; `isSnapChromium` flags snap-confined binaries (`/snap/` in path or realpath) which callers surface as a warning.
- `server/utils/chromeFinder.js`

---

## Desktop Driver

### EPEA-2491 — PowerShell desktop driver, basic window control
Driver spawns hidden PowerShell (base64 `-EncodedCommand`) via `child_process.exec`. `launch` uses `Start-Process`; `findWindow`/`focusWindow`/`maximizeWindow`/`getWindowTitle` match `Get-Process` `MainWindowTitle` and call user32.dll P/Invokes (`SetForegroundWindow`, `ShowWindow`, `GetWindowText`); `type` uses `SendKeys`; `mouseClick` uses `SetCursorPos` + `mouse_event`; `closeWindow` sends Alt+F4. All methods async, errors surfaced as thrown Errors.
- `server/runners/desktop-runner.js`

### EPEA-2492 — Element interaction by control ID / class (UIAutomation)
`buildControlScript` emits PowerShell loading `UIAutomationClient`/`UIAutomationTypes`, resolving a root (window by partial Name or desktop `RootElement`) and `FindFirst` on `PropertyCondition`s (Name/ClassName/AutomationId, combined via `AndCondition`). `clickControl` uses `InvokePattern` (falls back to `GetClickablePoint` + `mouse_event`); `setControlText`/`getControlText` use `ValuePattern`. Elements are re-found per call since COM handles can't cross process boundaries.
- `server/runners/desktop-runner.js`

### EPEA-2493 — Keyboard + clipboard operations
`hotkey(modifier, key)` builds a SendKeys combo string (`^`/`%`/`+` for Ctrl/Alt/Shift, special-key map, WScript.Shell for Win) sent via `SendKeys`. `setClipboard`/`getClipboard` wrap `Set-Clipboard -Value` / `Get-Clipboard -Raw`.
- `server/runners/desktop-runner.js`

### EPEA-2494 — Desktop test sample + authoring guide
Built-in Notepad sample (launch, type, verify title, close without saving) with a `zephyrLog` pass/fail pattern, plus a richer OCR + range-select showcase. Authoring guide documents the full `driver` API (window/mouse/keyboard/clipboard/screenshot/OCR/image/control) with option tables and examples.
- `server/builtins/desktop-sample.js`, `server/builtins/desktop-showcase.js`, `docs/creating-tests.md`

---

## Image & OCR

### EPEA-2495 — Screen capture / region screenshot
`screenshot` uses .NET `System.Drawing.Bitmap` + `Graphics.CopyFromScreen` over `PrimaryScreen.Bounds`. `screenshotWindow` reads window bounds via `GetWindowRect` P/Invoke then copies that rectangle. `screenshotRegion` takes a temp full-screen shot and crops via jimp (`cropAndSave`). Paths resolve to a per-test screenshots folder.
- `server/runners/desktop-runner.js`, `server/utils/image-utils.js`

### EPEA-2496 — Image template matching
`findImage`/`clickImage` capture a temp screenshot then run `findImageOnScreen`, a pure-JS normalized cross-correlation matcher: images read with jimp, converted to grayscale Float32 arrays, slid window-by-window computing NCC from per-patch mean/std (first-row-mean fast-reject). A match above `threshold` (default 0.85) returns coordinates/centerX/centerY/confidence; `clickImage` clicks the returned center.
- `server/utils/image-utils.js`, `server/runners/desktop-runner.js`

### EPEA-2497 — OCR, read text from screen region
`readText` screenshots (or crops a region, or captures a window) then runs `ocrImage`, which on Windows defaults to the native **Windows.Media.Ocr** engine via WinRT PowerShell interop (`BitmapDecoder` → `SoftwareBitmap` → `OcrEngine.RecognizeAsync`), falling back to **Tesseract.js** (lazily-reused worker, `eng`, optional jimp preprocessing, PSM/whitelist) on non-Windows or Windows-OCR failure. `eng.traineddata` is the bundled Tesseract model; `scripts/test-winocr.ps1` is a standalone Windows-OCR probe.
- `server/runners/desktop-runner.js`, `server/utils/image-utils.js`, `eng.traineddata`, `scripts/test-winocr.ps1`

### EPEA-2498 — Wait for image / wait for text (polling assertions)
Both are JS polling loops on `driver.pause`: `waitForImage` repeatedly calls `findImage` until `match.found` or timeout (default 10000ms / 1000ms interval); `waitForText` repeatedly calls `readText` and checks substring (or `exact`, case-insensitive). Both throw on timeout.
- `server/runners/desktop-runner.js`

### EPEA-2499 — Mouse control, hover / drag / scroll
`mouseMove` sets `Cursor.Position`; `drag` presses left button then interpolates `steps` moves via `mouse_event` (MOUSEEVENTF_MOVE) + `SetCursorPos` before release; `scroll` uses `mouse_event` MOUSEEVENTF_WHEEL (`delta * 120`). All support `options.relativeTo` offsetting by a window's top-left via `getWindowRect`. Uses user32 `mouse_event`/`SetCursorPos` P/Invokes.
- `server/runners/desktop-runner.js`

### EPEA-2514 — Screenshot on test failure
The generated sequence runner wraps each step in try/catch; on failure `captureFailureScreenshot` creates a per-run `failures/` dir, saves `<test>-<timestamp>.png` (desktop uses `driver.screenshot`, web uses base64 `takeScreenshot`), and logs a `[[SCREENSHOT]]<path>` marker. The log viewer matches that marker (`SCREENSHOT_RE`) and renders an inline thumbnail. Also wired into scheduled runs.
- `server/routes/sequence.js`, `server/scheduler-service.js`, `renderer/src/components/LogContent.jsx`

---

## Web Runner

### EPEA-2500 — Selenium web runner with Chrome auto-detection
`web-runner.js` generates the WebDriver bootstrap, injecting `setChromeBinaryPath(...)` from `getChromeBinary()`, adding `--no-sandbox`/`--disable-dev-shm-usage`, and headless args (`--headless=new`) unless `VISUAL_BROWSER === "true"`; supports local and remote (`SELENIUM_REMOTE_URL`) builds. `sequence.js` wraps `Builder().build()` in try/catch detecting `SessionNotCreatedError` (and chrome/chromedriver message patterns) to throw a user-friendly install hint.
- `server/runners/web-runner.js`, `server/routes/sequence.js`

### EPEA-2501 — OKTA login wrapping for web tests
Queued tests carry an `oktaEnv` (prod/preprod/test); `App.jsx` buckets them into `envGroups` and, per non-empty group, prepends a shared `okta-login` step (env-specific `oktaUrls`, `visualBrowser:true`) and appends `okta-login-finish`, so one browser session serves the group. `okta-login.js` navigates to `parameters.oktaUrl` and polls up to 60s for `#dashboard-search-input`; `okta-login-finish.js` is a marker (runner owns teardown).
- `renderer/src/App.jsx`, `server/builtins/okta-login.js`, `server/builtins/okta-login-finish.js`, `server/routes/sequence.js`

---

## Scheduling

### EPEA-2502 — Scheduler Service
Standalone Express app on `UTS_SCHEDULER_PORT` (default 5050) using `node-cron`, spawning child `node run.js` per run. On boot it bootstraps builtins/runners/utils into a shared data dir and `restoreSchedules()` re-arms active crons; `SIGTERM`/`SIGINT` graceful shutdown. Data dir resolves to `C:\ProgramData\uts-automation` (Windows) or `/var/lib/uts-automation` (Linux), overridable via `UTS_SCHEDULER_DATA_DIR`. OS service install via `node-windows` (Windows) or a generated systemd unit (Linux).
- `server/scheduler-service.js`, `server/scheduler-service-paths.js`, `scripts/install-service-win.js`, `scripts/uninstall-service-win.js`, `scripts/install-service-linux.sh`

### EPEA-2503 — Schedule creation, editing and management UI
`SchedulePanel.jsx` polls `/api/schedules` every 5s and renders cards with status pills, driving create (POST), inline edit (PATCH), and per-schedule `/run`, `/pause`, `/resume`, `/stop`, DELETE. A `Countdown` component computes next run from `time`+`days` (1s ticker); a service-down banner shows on HTTP 503. Electron backend is a thin proxy to the :5050 service which does the CRUD + cron arming.
- `renderer/src/components/SchedulePanel.jsx`, `server/routes/schedules.js`, `server/scheduler-service.js` (legacy in-process path: `server/scheduler.js`, `server/scheduleStore.js`)

### EPEA-2504 — Export / import schedules as encrypted .utsb bundles
`portableEncryption.js` derives a 256-bit key via PBKDF2 (100k iterations, SHA-256, random 16-byte salt) and encrypts a JSON bundle with AES-256-GCM into a `UTSB`-magic binary (`MAGIC+salt+iv+tag+ciphertext`). `/api/schedules/:id/export` bundles schedule meta, sequencePayload, secrets, test code, images, and failure screenshots, and streams a `.utsb` attachment; `/import` decrypts, writes tests/images, merges secrets, creates the schedule.
- `server/utils/portableEncryption.js`, `server/scheduler-service.js`, `renderer/src/components/SchedulePanel.jsx`

---

## Secrets Management

### EPEA-2505 — User encrypted secrets store
`encryption.js` generates/loads a random 32-byte master key (mode 0600) and encrypts JSON with AES-256-GCM (`iv:tag:ciphertext`). `secrets.js` loads/decrypts on startup, seeds default blank secrets (`ZEPHYR_API_TOKEN`, `GITHUB_PERSONAL_ACCESS_TOKEN`, `GITHUB_USERNAME`), and exposes list/get/set/delete with 0600 writes in the per-user data dir. The scheduler service keeps its own equivalent store in the shared data dir.
- `server/utils/encryption.js`, `server/secrets.js`, `server/utils/paths.js`, `server/scheduler-service.js`

### EPEA-2506 — Secrets CRUD UI + secret injection into test parameters
`routes/secrets.js` exposes GET (names only, values never returned), POST/PUT, DELETE. `SecretsPanel.jsx` + `SecretRow.jsx` provide the add form (name uppercased, validated), masked value inputs, and per-row edit/delete. At run time secrets are merged into each step's parameters (`{...parameters, ...allSecrets}`) so generated `run.js` receives them as `parameters`; undefined references get a warning badge.
- `server/routes/secrets.js`, `renderer/src/components/SecretsPanel.jsx`, `renderer/src/components/SecretRow.jsx`, `server/scheduler-service.js`, `server/scheduler.js`

---

## Reporting & Notifications

### EPEA-2507 — Zephyr Scale result reporting per test
Test cards add Project/Case/Cycle Key inputs (Project Key defaults to "EPEA") serialized into a `zephyr` object on the step. The generated runner gives each step a `zephyrLog(actualResult, status)` callback collecting per-step results, then `sendZephyrResult` POSTs overall Pass/Fail plus `testScriptResults[]` to the Zephyr Scale Cloud API (`/v2/testexecutions`). `ZEPHYR_API_TOKEN` is validated before the run; missing Cycle Key skips reporting.
- `renderer/src/components/TestCard.jsx`, `server/routes/sequence.js`, `server/utils/zephyr.js`

### EPEA-2692 — Test "Executed by" in Zephyr + name field in Marvin
A "Tester name (optional)" input persists to localStorage (`testerName`) and is passed as `executedBy` into RunSequence and the sequence request body. Since the Zephyr Cloud API only accepts an Atlassian account id for native `executedById`, `postTestExecution` prepends the free-text name as an `Executed by: <name>` line in the execution comment. Name is optional and also settable on a scheduled test.
- `renderer/src/App.jsx`, `server/routes/sequence.js`, `server/utils/zephyr.js`

### EPEA-3469 — Populate Zephyr "Assigned To" and "Executed By" identity fields
`server/utils/zephyr.js` was refactored to expose a pure `buildExecutionPayload(opts)`: when a non-empty `accountId` is passed it sets the native `executedById` and `assignedToId` (trimmed, same id for both) and suppresses the fallback comment; with no account id it keeps the EPEA-2692 "Executed by: \<name\>" comment behaviour. The account id is threaded from a new localStorage-backed "Atlassian account ID" field in `App.jsx` through `RunSequence.jsx` (request body) into `sequence.js` (injected `ACCOUNT_ID` const passed to `postTestExecution`), and equivalently through a per-schedule field in `SchedulePanel.jsx` into `scheduler-service.js` (create/update/export/import persistence + injected `ACCOUNT_ID`). Covered by `server/utils/zephyr.test.js` (11 `node --test` cases); `server/data/utils/zephyr.js` is the bootstrap-regenerated runtime copy.
- `server/utils/zephyr.js`, `server/utils/zephyr.test.js`, `server/routes/sequence.js`, `server/scheduler-service.js`, `renderer/src/App.jsx`, `renderer/src/components/RunSequence.jsx`, `renderer/src/components/SchedulePanel.jsx`, `server/package.json`

### EPEA-2508 — Microsoft Teams webhook notifications
SchedulePanel exposes two webhook URL fields (`teamsWebhookAll`, `teamsWebhookFail`) on the schedule. After a scheduled run, `sendNotifications` posts a card to the "all results" webhook every run and a separate failure card (with logs) to the "failures only" webhook on non-zero exit. Invalid URLs are caught and logged without crashing.
- `renderer/src/components/SchedulePanel.jsx`, `server/scheduler.js`, `server/scheduler-service.js`

### EPEA-2509 — ntfy push notifications
SchedulePanel adds an ntfy topic field plus optional custom server URL (placeholder `https://ntfy.sh`). `sendNotifications` builds the base URL from `ntfyServer` (defaults to ntfy.sh, trailing slashes stripped) and POSTs the run result to `<base>/<topic>` (title = schedule name, body = pass/fail count). ntfy failures are logged but don't affect the run.
- `renderer/src/components/SchedulePanel.jsx`, `server/scheduler.js`, `server/scheduler-service.js`

---

## Repo & Distribution

### EPEA-2510 — Clone test repos (public and private)
`gitController.cloneTestRepo` uses `simple-git` to clone into `CLONE_TARGET`; private repos inject `https://USER:PAT@host` from `GITHUB_USERNAME`/`GITHUB_PERSONAL_ACCESS_TOKEN` (env or secrets store), returning 403 if missing, with EBUSY-retry removal on locked folders. `listTests` scans the cloned `tests/` dir for subfolders; the UI toggles private mode via `PrivateRepoCheckbox.jsx` and guides token setup via `PATPopup.jsx`.
- `server/controllers/gitController.js`, `server/routes/git.js`, `renderer/src/components/PrivateRepoCheckbox.jsx`, `renderer/src/components/PATPopup.jsx`, `renderer/src/App.jsx`

### EPEA-2511 — Windows Installer & Distribution
`package.json` `build` config: `appId com.uts.marvin`, `productName Marvin`, NSIS Windows target (non-oneClick, user-selectable dir, custom icon), packs `main/`, `renderer/dist/`, `server/` into an asar (chromedriver unpacked), ships portable Git via `extraResources`. `predist`/`dist` scripts build the renderer, install production server deps, then run `electron-builder --win`.
- `package.json`, `resources/portable-git/`, `resources/icons/icon.ico`

---

## Testing & Onboarding

### EPEA-2512 — Acceptance test checklist for Web mode
Living markdown checklist covering the full web epic (startup/diagnostics, Chrome detection, repo/PAT loading, sequence execution, OKTA wrapping, Zephyr reporting, secrets, notifications, export/import) as step/expected-result tables keyed to Jira ACs, with a per-release sign-off section.
- `docs/acceptance-web.md`

### EPEA-2513 — Acceptance test checklist for Desktop mode
Windows-only checklist for the desktop epic (window control, element interaction, keyboard/clipboard, image matching, OCR, wait methods, mouse control, screenshots, built-in sample) with specific test apps and a pass/fail column.
- `docs/acceptance-desktop.md`

### EPEA-2516 — Test dry-run mode (validate without executing)
Client-side `handleDryRun` in RunSequence iterates the wrapped sequence (skipping builtins) and validates without executing: flags empty required parameters, resolves `${{ secrets.NAME }}` references against available secrets, and checks Zephyr keys against regex format patterns. Aggregates PASS/WARN/FAIL per test into a report surfaced via `onDryRunReport`, triggered by a "Dry Run (validate only)" button.
- `renderer/src/components/RunSequence.jsx`, `renderer/src/App.jsx`
