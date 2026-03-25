# UTS Windows Automation UI

A self-contained Windows desktop application for automating both **desktop applications** and **web browsers**. Built with Electron, it provides the same interface as the Docker-based UTS Automation UI but runs natively on any Windows machine — no Docker required.

---

## What It Does

- **Desktop automation** — Control Windows apps (click, type, launch, close) using PowerShell + Win32 APIs
- **Web automation** — Run Selenium browser tests against a locally installed Chrome
- **GitHub integration** — Clone test repos and manage tests through version control
- **Zephyr Scale reporting** — Automatically report test results to Zephyr Scale Cloud
- **Teams notifications** — Send pass/fail alerts to Microsoft Teams channels
- **Scheduling** — Run test sequences on a cron schedule (daily, specific days, etc.)
- **Secrets management** — Encrypted storage for API tokens and credentials

---

## Requirements

### For running the app
- **Windows 10 or 11** (desktop automation requires Windows)
- **Node.js 18+** — https://nodejs.org
- **Git** — https://git-scm.com (for cloning test repos)

### For web tests (optional)
- **Google Chrome** — desktop tests don't need Chrome, only web tests do

### For development/building
- **npm** (comes with Node.js)

---

## Quick Start

### 1. Install dependencies

```bash
cd UTS-win-automation-UI
npm install
cd renderer && npm install && cd ..
cd server && npm install && cd ..
```

### 2. Run in development mode

```bash
npm run dev
```

This starts the Vite dev server (hot reload) and the Electron app simultaneously. The backend Express server starts automatically inside the app.

### 3. Run without dev tools

```bash
npm start
```

> **Linux users**: Add `--no-sandbox` flag: `npx electron . --no-sandbox`
> Desktop tests (PowerShell) won't work on Linux, but the UI and web tests will.

---

## Building the Windows Installer

On a Windows machine, run:

```bash
npm run dist
```

This produces a `.exe` installer in the `dist/` folder using NSIS. The installer includes everything — users don't need to install Node.js or Git separately on their machines.

---

## Project Structure

```
UTS-win-automation-UI/
|
|-- main/                          Electron main process
|   |-- main.js                    Creates the app window, starts backend
|   |-- backend-manager.js         Forks Express server as a child process
|   |-- preload.js                 Secure bridge between UI and system
|
|-- renderer/                      Frontend (Vite + React)
|   |-- src/
|   |   |-- App.jsx                Main page — test cards, toolbar, toggle
|   |   |-- config.js              Backend URL config (localhost:5000)
|   |   |-- components/
|   |   |   |-- TestCard.jsx       Individual test display + config
|   |   |   |-- RunSequence.jsx    Sequence sidebar + execution
|   |   |   |-- SchedulePanel.jsx  Cron scheduling UI
|   |   |   |-- SecretsPanel.jsx   Encrypted secrets manager
|   |   |   |-- LogGroup.jsx       Collapsible log viewer
|   |   |   |-- PATPopup.jsx       GitHub PAT setup helper
|   |   |   +-- ...
|   |   +-- styles/
|   +-- index.html
|
|-- server/                        Express backend
|   |-- app.js                     Express setup, routes, WebSocket
|   |-- index.js                   Server entry point
|   |-- secrets.js                 Encrypted secrets store
|   |-- scheduler.js               Cron job manager
|   |-- scheduleStore.js           Schedule persistence
|   |-- controllers/
|   |   +-- gitController.js       GitHub repo cloning
|   |-- routes/
|   |   |-- sequence.js            Sequence compiler + runner
|   |   |-- schedules.js           Schedule CRUD API
|   |   |-- secrets.js             Secrets API
|   |   +-- ...
|   |-- runners/
|   |   |-- desktop-runner.js      PowerShell + Win32 desktop driver
|   |   +-- web-runner.js          Local Chrome Selenium driver
|   |-- builtins/
|   |   |-- default-test.js        Sample web test (UTS Handbook)
|   |   |-- desktop-sample.js      Sample desktop test (Notepad)
|   |   +-- ...
|   +-- utils/
|       |-- paths.js               Data directory resolution
|       |-- zephyr.js              Zephyr Scale API client
|       +-- encryption.js          AES-256-GCM encryption
|
+-- resources/                     Icons, portable Git (build time)
```

---

## How It Works

### Architecture

```
+-------------------------------------------+
|  Electron Window                          |
|  (Vite + React UI)                        |
|    |                                      |
|    +-- http://localhost:5000 -----------+ |
|                                         | |
+-------------------------------------------+
                                          |
+-------------------------------------------+
|  Express Backend (forked child process)   |
|    |                                      |
|    +-- Web tests --> Selenium + Chrome    |
|    +-- Desktop tests --> PowerShell       |
|    +-- Zephyr Scale API                   |
|    +-- Teams Webhooks                     |
|    +-- GitHub (clone repos)               |
+-------------------------------------------+
```

The Electron main process forks the Express backend as a child process. The React UI talks to it on `localhost:5000`, exactly like the Docker version — but everything runs locally.

### Desktop vs Web Tests

Use the toggle at the top of the app to switch modes:

| | Desktop Tests | Web Tests |
|---|---|---|
| **What it controls** | Windows applications | Web browsers |
| **Driver** | PowerShell + Win32 APIs | Selenium WebDriver |
| **Requires** | Windows 10/11 | Google Chrome |
| **Example** | Open Notepad, type text | Navigate to a URL, click buttons |

### Desktop Driver API

Desktop test scripts receive a `driver` object with these methods:

```javascript
module.exports = async function (driver, parameters, zephyrLog) {

  // Launch an application
  await driver.launch("notepad.exe");

  // Type text
  await driver.type("Hello World");

  // Press keys (supports Ctrl, Alt, Shift, Enter, Tab, F1-F12, etc.)
  await driver.keyPress("Ctrl", "s");
  await driver.keyPress("Enter");

  // Keyboard shortcut (alias for keyPress)
  await driver.hotkey("Ctrl", "a");

  // Mouse operations
  await driver.mouseClick(500, 300);
  await driver.doubleClick(500, 300);
  await driver.mouseMove(100, 200);

  // Window management
  await driver.focusWindow("Notepad");
  const title = await driver.getWindowTitle();
  const handle = await driver.findWindow("Notepad");

  // Close current window (Alt+F4)
  await driver.closeWindow();

  // Wait
  await driver.pause(2000);

  // Take a screenshot
  await driver.screenshot("C:\\temp\\screenshot.png");

  // Zephyr logging (same as web tests)
  zephyrLog("Step completed successfully", "Pass");
  zephyrLog("Something failed", "Fail");
};
```

### Web Driver API

Web tests use the standard Selenium WebDriver API:

```javascript
const { By } = require("selenium-webdriver");

module.exports = async function (driver, parameters, zephyrLog) {
  await driver.get("https://example.com");
  const element = await driver.findElement(By.css("#login"));
  await element.sendKeys("username");
  await driver.findElement(By.css("#submit")).click();

  zephyrLog("Login completed", "Pass");
};
```

---

## Writing Tests

### Test repo structure

Tests live in a GitHub repo with this structure:

```
your-test-repo/
+-- tests/
    |-- Login-Test/
    |   |-- run.js            Test script
    |   +-- metadata.json     Test info (optional)
    |-- Dashboard-Check/
    |   |-- run.js
    |   +-- metadata.json
    +-- ...
```

### Test script format

Every test exports an async function with three parameters:

```javascript
module.exports = async function (driver, parameters, zephyrLog) {
  // driver    — Desktop driver or Selenium WebDriver (depends on mode)
  // parameters — Key-value pairs from the UI + injected secrets
  // zephyrLog  — Function to log step results for Zephyr Scale

  // Your test logic here...

  // Log results for Zephyr (optional)
  zephyrLog("Description of what passed", "Pass");
  zephyrLog("Description of what failed", "Fail");
};
```

### Using parameters and secrets

Parameters set in the UI and secrets from the Secrets Manager are available in the `parameters` object:

```javascript
module.exports = async function (driver, parameters, zephyrLog) {
  const username = parameters.GITHUB_USERNAME;
  const token = parameters.ZEPHYR_API_TOKEN;
  const customParam = parameters.myCustomParam;
};
```

Reference secrets in parameter fields using `${{ secrets.SECRET_NAME }}` syntax.

---

## Zephyr Scale Integration

Each test card has fields for Zephyr Scale:
- **Project Key** — Your Jira project key (e.g., `EPEA`)
- **Case Key** — Test case ID (e.g., `EPEA-T123`)
- **Cycle Key** — Test cycle ID (e.g., `EPEA-R45`)

You also need to add a `ZEPHYR_API_TOKEN` secret in the Secrets Manager.

Test results are automatically reported after each test runs:
- **Pass** — All `zephyrLog` calls reported "Pass" and no errors thrown
- **Fail** — Any `zephyrLog` call reported "Fail" OR the test threw an error

---

## Teams Notifications

Schedules support two Teams webhook URLs:
- **All results** — Sends a card for every run (pass or fail)
- **Failures only** — Sends a card with full logs only when tests fail

Set up a webhook in Teams and paste the URL into the schedule configuration.

---

## Secrets Manager

The Secrets Manager stores sensitive values (API tokens, passwords) encrypted on disk using AES-256-GCM. Secrets are:
- Encrypted at rest with a machine-specific master key
- Injected into test parameters automatically
- Never logged or displayed in the UI

Default secrets created on first run:
- `ZEPHYR_API_TOKEN`
- `GITHUB_PERSONAL_ACCESS_TOKEN`
- `GITHUB_USERNAME`

You can add custom secrets for use in your tests.

---

## Data Storage

All user data is stored in the Electron `userData` directory:

| OS | Location |
|---|---|
| **Windows** | `%APPDATA%/uts-win-automation-ui/` |
| **Linux** (dev) | `./data/` (project-relative) |

This includes:
- `secrets.json.enc` — Encrypted secrets
- `secrets_master_key` — Encryption key
- `schedules.json` — Saved schedules
- `repo/` — Cloned test repositories

---

## Development

### Dev mode (hot reload)

```bash
npm run dev
```

Runs Vite dev server on `http://localhost:5173` with hot module replacement, and opens Electron pointing at it.

### Building for production

```bash
# Build the renderer (static files)
npm run build:renderer

# Build the Windows installer
npm run dist
```

### Project dependencies

| Component | Key Packages |
|---|---|
| **Electron shell** | electron, electron-builder |
| **Frontend** | react, react-dom, vite |
| **Backend** | express, ws, node-cron, simple-git, selenium-webdriver, uuid |
| **Encryption** | Node.js built-in crypto (AES-256-GCM) |
| **Desktop automation** | PowerShell (built into Windows, no npm package needed) |

---

## Troubleshooting

### "Port 5000 already in use"
Another application (or the Docker version) is using port 5000. Stop it first, or change the port in `main/backend-manager.js`.

### Desktop tests don't work on Linux/Mac
Expected — the PowerShell desktop driver requires Windows. The UI, web tests, scheduling, and all other features work on any OS.

### Chrome not found (web tests)
Install Google Chrome. The app uses your locally installed Chrome via Selenium WebDriver.

### Electron sandbox error on Linux
Run with `--no-sandbox`:
```bash
npx electron . --no-sandbox
```
