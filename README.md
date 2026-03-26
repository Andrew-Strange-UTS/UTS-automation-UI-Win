# UTS Automation UI

A self-contained desktop application for automating both **desktop applications** and **web browsers**. Built with Electron, it provides a native UI for running tests, scheduling sequences, and reporting results — no Docker required.

Runs on **Windows** and **Ubuntu/Linux**. Desktop automation requires Windows; the UI, web tests, and scheduling work on both.

---

## What It Does

- **Desktop automation** — Control Windows apps (click, type, launch, close) using PowerShell + Win32 APIs
- **Web automation** — Run Selenium browser tests against locally installed Google Chrome or Chromium
- **GitHub integration** — Clone test repos and manage tests through version control
- **Zephyr Scale reporting** — Automatically report test results to Zephyr Scale Cloud
- **Teams notifications** — Send pass/fail alerts to Microsoft Teams channels
- **Scheduling** — Run test sequences on a cron schedule via a shared background service
- **Secrets management** — Encrypted storage for API tokens and credentials
- **Multi-user support** — Shared scheduler service for Windows Server environments with multiple RDP users
- **Startup diagnostics** — On launch, checks all dependencies and shows what features are available

---

## Platform Support

| Feature | Windows 10/11 | Windows Server | Ubuntu/Linux |
|---|---|---|---|
| Web tests (Selenium) | Yes | Yes | Yes |
| Desktop tests (PowerShell) | Yes | Yes | No |
| Scheduling | Yes | Yes | Yes |
| Multi-user shared schedules | Yes | Yes | Yes |
| Visual browser mode | Yes | Yes | Yes |
| OKTA SSO login | Yes | Yes | Yes |

---

## Installation

### Windows

#### 1. Install prerequisites

- **Node.js 18+** — Download from https://nodejs.org (LTS recommended)
- **Git** — Download from https://git-scm.com
- **Google Chrome** — Download from https://www.google.com/chrome/
  - Alternatively: `choco install googlechrome` if you use Chocolatey
  - Chromium also works: `choco install chromium`

> Chrome/Chromium is only needed for web tests. Desktop tests work without it.

#### 2. Clone and install

```powershell
git clone <your-repo-url> UTS-win-automation-UI
cd UTS-win-automation-UI
npm install
cd renderer && npm install && cd ..
cd server && npm install && cd ..
```

#### 3. Run the app

```powershell
npm run dev
```

#### 4. (Optional) Start the scheduler service

For scheduled test sequences to run in the background:

```powershell
cd server
node scheduler-service.js
```

Or install as a Windows Service (runs on boot, shared by all RDP users):

```powershell
node scripts/install-service-win.js
```

### Ubuntu / Linux

#### 1. Install prerequisites

```bash
# Node.js 18+ (via NodeSource)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Git
sudo apt install -y git

# Google Chrome (recommended over snap Chromium — works better with Selenium)
wget -q -O /tmp/chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
sudo dpkg -i /tmp/chrome.deb
sudo apt-get -f install -y
```

> **Important:** Snap-installed Chromium (`snap install chromium`) has sandbox restrictions that prevent Selenium from connecting to it. Use Google Chrome from the .deb package above, or a non-snap Chromium.

#### 2. Clone and install

```bash
git clone <your-repo-url> UTS-win-automation-UI
cd UTS-win-automation-UI
npm install
cd renderer && npm install && cd ..
cd server && npm install && cd ..
```

#### 3. Run the app

```bash
npm run dev
```

The dev script includes `--no-sandbox` for Electron on Linux automatically.

> Desktop tests (PowerShell + Win32) are not available on Linux. The startup diagnostics screen will show this. Everything else works.

#### 4. (Optional) Start the scheduler service

For development:

```bash
cd server
UTS_SCHEDULER_DATA_DIR=./data node scheduler-service.js
```

Or install as a systemd service (runs on boot):

```bash
sudo bash scripts/install-service-linux.sh
```

### Windows Server (multi-user RDP)

Follow the Windows install steps above, then install the scheduler as a Windows Service:

```powershell
node scripts/install-service-win.js
```

This registers **UTS Automation Scheduler** as a Windows Service that:
- Starts automatically on boot
- Runs under the SYSTEM account (not tied to any RDP session)
- Is shared by all users — everyone sees the same schedules
- Continues running when users disconnect

Each user opens the Electron app in their RDP session. The app talks to the shared scheduler service on `localhost:5050`.

---

## Building the Windows Installer

On a Windows machine:

```powershell
npm run dist
```

This produces a `.exe` installer in `dist/` using NSIS. The installer bundles everything — users don't need to install Node.js or Git on their machines.

---

## Startup Diagnostics

On launch, the app checks all dependencies and shows a diagnostics screen:

| Check | What it verifies |
|---|---|
| **Node.js** | Runtime version |
| **Operating System** | Platform (Windows/Linux) |
| **Git** | Installed and in PATH |
| **Google Chrome** | Chrome or Chromium binary found (auto-detects location) |
| **ChromeDriver** | System chromedriver or selenium-webdriver auto-management |
| **PowerShell** | Available for desktop automation (Windows only) |
| **Scheduler Service** | Running on localhost:5050 |

The screen also shows which features are available based on the detected dependencies. Click **Continue** to proceed to the main UI.

---

## Project Structure

```
UTS-win-automation-UI/
|
|-- main/                              Electron main process
|   |-- main.js                        Creates the app window, starts backend
|   |-- backend-manager.js             Forks Express server as a child process
|   +-- preload.js                     Secure bridge between UI and system
|
|-- renderer/                          Frontend (Vite + React)
|   |-- src/
|   |   |-- App.jsx                    Main page — test cards, toolbar, toggle
|   |   |-- config.js                  Backend URL config (localhost:5000)
|   |   |-- theme.js                   Centralised colour theme
|   |   +-- components/
|   |       |-- StartupChecks.jsx      Startup diagnostics screen
|   |       |-- TestCard.jsx           Individual test display + config
|   |       |-- RunSequence.jsx        Sequence sidebar + execution
|   |       |-- SchedulePanel.jsx      Schedule UI + service status
|   |       |-- SecretsPanel.jsx       Encrypted secrets manager
|   |       +-- ...
|   +-- index.html
|
|-- server/                            Express backend
|   |-- app.js                         Express setup, routes, WebSocket
|   |-- index.js                       Server entry point (port 5000)
|   |-- secrets.js                     Per-user encrypted secrets store
|   |-- scheduler-service.js           Standalone scheduler service (port 5050)
|   |-- scheduler-service-paths.js     Shared data directory resolution
|   |-- scheduleStore.js               Schedule file persistence
|   |-- routes/
|   |   |-- health.js                  Startup diagnostics endpoint
|   |   |-- sequence.js                Sequence compiler + runner
|   |   |-- schedules.js               Proxy to scheduler service
|   |   |-- secrets.js                 Secrets API
|   |   +-- ...
|   |-- runners/
|   |   |-- desktop-runner.js          PowerShell + Win32 desktop driver
|   |   +-- web-runner.js              Chrome/Chromium Selenium driver
|   |-- builtins/
|   |   |-- default-test.js            Sample web test (UTS Handbook)
|   |   |-- desktop-sample.js          Sample desktop test (Notepad)
|   |   +-- ...
|   +-- utils/
|       |-- paths.js                   Per-user data directory resolution
|       |-- chromeFinder.js            Auto-detects Chrome or Chromium binary
|       |-- zephyr.js                  Zephyr Scale API client
|       |-- encryption.js              AES-256-GCM encryption
|       +-- portableEncryption.js      Password-based bundle encryption
|
|-- scripts/                           Service install scripts
|   |-- install-service-win.js         Install scheduler as Windows Service
|   |-- uninstall-service-win.js       Remove Windows Service
|   +-- install-service-linux.sh       Install scheduler as systemd service
|
|-- docs/                              Documentation
|   +-- creating-tests.md             Test authoring guide + AI prompt
|
+-- resources/                         Icons, portable Git (build time)
```

---

## Architecture

```
+----------------------------------------------------+
|  Electron Window (per user)                        |
|  Vite + React UI                                   |
|    |                                               |
|    +-- localhost:5000 (Express backend) ----------+|
|         |                                         ||
|         +-- Web tests --> Selenium + Chrome        ||
|         +-- Desktop tests --> PowerShell           ||
|         +-- Zephyr Scale API                       ||
|         +-- GitHub (clone repos)                   ||
|         +-- Schedules --> proxy to :5050           ||
+----------------------------------------------------+
                          |
+----------------------------------------------------+
|  Scheduler Service (system-wide, runs 24/7)        |
|  localhost:5050                                     |
|    |                                               |
|    +-- node-cron jobs                              |
|    +-- Compiles + runs test sequences              |
|    +-- Sends notifications (ntfy, Teams)           |
|    +-- Shared schedules.json for all users         |
+----------------------------------------------------+
```

The Electron main process forks the Express backend as a child process on port 5000. The React UI talks to it for all operations (tests, sequences, secrets, git).

Schedule operations are proxied from the Electron backend to the **standalone scheduler service** on port 5050. This service runs as a system-wide background process, shared by all users — schedules execute even when no one has the Electron app open.

### Browser auto-detection

The app automatically finds Chrome or Chromium on the system. It searches (in order):
- `google-chrome` / `google-chrome-stable` (Linux PATH)
- `chromium-browser` / `chromium` (Linux PATH)
- `Program Files\Google\Chrome\Application\chrome.exe` (Windows)
- `Program Files\Chromium\Application\chrome.exe` (Windows)

The detected binary is used by the sequence runner, web runner, and scheduler service. No configuration needed.

---

## Scheduler Service

The scheduler service is a standalone Node.js process that manages cron schedules independently of the Electron app. It runs system-wide so that:

- Schedules execute 24/7, even when no user is logged in
- All users on the machine see and manage the same schedules
- Multiple RDP users on a Windows Server share one set of schedules

### Shared data directory

| OS | Location |
|---|---|
| **Windows** | `C:\ProgramData\uts-automation\` |
| **Linux** | `/var/lib/uts-automation/` |

Override with the `UTS_SCHEDULER_DATA_DIR` environment variable.

The service stores:
- `schedules.json` — all schedule definitions
- `secrets.json.enc` — encrypted secrets (separate from per-user Electron secrets)
- `builtins/` — built-in test scripts (auto-copied on first run)
- `runners/` — test runner modules
- `logs/` — persistent run logs per schedule
- `repo/tests/` — bundled test code

### Running in development

```bash
# Linux
cd server
UTS_SCHEDULER_DATA_DIR=./data node scheduler-service.js

# Windows (PowerShell)
cd server
$env:UTS_SCHEDULER_DATA_DIR="./data"; node scheduler-service.js

# Windows (CMD)
cd server
set UTS_SCHEDULER_DATA_DIR=./data && node scheduler-service.js
```

### Installing as a Windows Service

```powershell
node scripts/install-service-win.js
```

This registers the scheduler as a Windows Service that starts automatically on boot. All RDP users share it. To remove:

```powershell
node scripts/uninstall-service-win.js
```

### Installing as a Linux systemd service

```bash
sudo bash scripts/install-service-linux.sh
```

This creates and starts a `uts-scheduler` systemd unit. Manage it with:

```bash
sudo systemctl status uts-scheduler       # Check status
sudo systemctl stop uts-scheduler         # Stop service
sudo systemctl restart uts-scheduler      # Restart service
sudo journalctl -u uts-scheduler -f       # View live logs

# To remove:
sudo systemctl disable uts-scheduler
sudo rm /etc/systemd/system/uts-scheduler.service
sudo systemctl daemon-reload
```

### Health check

```
GET http://localhost:5050/api/health
```

Returns `{ "status": "ok", "uptime": ..., "schedules": ... }`.

### Service status in the UI

The Schedule Panel shows a warning banner when the scheduler service is not running. All other app functionality (tests, sequences, secrets) works independently of the scheduler service.

---

## Desktop vs Web Tests

Use the toggle below the Scheduled Sequences panel to switch modes:

| | Desktop Tests | Web Tests |
|---|---|---|
| **What it controls** | Windows applications | Web browsers |
| **Driver** | PowerShell + Win32 APIs | Selenium WebDriver |
| **Requires** | Windows 10/11 | Google Chrome or Chromium |
| **Works on Linux** | No | Yes |
| **Example** | Open Notepad, type text | Navigate to a URL, click buttons |
| **Visual Browser option** | N/A | Yes (shows browser window) |
| **OKTA Environment option** | N/A | Yes |

Switching modes clears the current run sequence.

---

## Writing Tests

See **[docs/creating-tests.md](docs/creating-tests.md)** for the full test authoring guide, including:

- Test repo structure
- Web and desktop test examples
- Desktop Driver API reference
- metadata.json format
- Parameters and secrets usage
- Zephyr Scale reporting
- OKTA authentication
- Scheduled tests
- A copy-pasteable AI prompt for generating tests

### Quick overview

Tests live in a GitHub repo:

```
your-test-repo/
+-- tests/
    |-- Login-Test/
    |   |-- run.js            Test script
    |   +-- metadata.json     Test config (optional)
    +-- Dashboard-Check/
        |-- run.js
        +-- metadata.json
```

Every test exports an async function:

```javascript
module.exports = async function (driver, parameters, zephyrLog) {
  // driver     — Desktop driver or Selenium WebDriver (depends on mode)
  // parameters — Values from the UI + injected secrets
  // zephyrLog  — Log step results: zephyrLog("description", "Pass" or "Fail")
};
```

---

## Zephyr Scale Integration

Each test card has fields for Zephyr Scale:
- **Project Key** — Your Jira project key (e.g., `EPEA`)
- **Case Key** — Test case ID (e.g., `EPEA-T123`)
- **Cycle Key** — Test cycle ID (e.g., `EPEA-R45`)

Add a `ZEPHYR_API_TOKEN` secret in the Secrets Manager. Results are automatically reported after each test:
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

**Note:** The Electron app and the scheduler service maintain separate secrets stores. When you create a schedule, the app's current secrets are bundled into the schedule so the service can use them independently.

---

## Data Storage

### Per-user data (Electron app)

| OS | Location |
|---|---|
| **Windows (packaged)** | `%APPDATA%/uts-win-automation-ui/` |
| **Linux / dev** | `./data/` (project-relative) |

Contains: encrypted secrets, cloned repos, master key.

### Shared data (scheduler service)

| OS | Location |
|---|---|
| **Windows** | `C:\ProgramData\uts-automation\` |
| **Linux** | `/var/lib/uts-automation/` |

Contains: schedules, bundled test code, bundled secrets, run logs.

---

## Theming

The app's colour theme is defined in a single file:

```
renderer/src/theme.js
```

```javascript
const theme = {
  primary: "#e07070",        // main accent (buttons, borders, active states)
  primaryText: "#fff",       // text on primary backgrounds
  primaryLight: "#fdf2f2",   // light tint (panel backgrounds, badges)
  primaryBorder: "#f0c4c4",  // subtle border for tinted panels
  primaryMedium: "#fce8e8",  // mid-tone backgrounds
  primaryDark: "#c05050",    // darker accent for emphasis text
};
```

Change the values in `theme.js` to retheme the entire app.

---

## Development

### Dev mode (hot reload)

```bash
npm run dev
```

Runs Vite dev server on `http://localhost:5173` with hot module replacement, and opens Electron pointing at it. Changes to React components appear instantly. For server-side changes (routes, runners, etc.), restart `npm run dev`.

### Developing on Windows Server

You can dev test directly on the Windows Server — **no WSL2 or Linux needed**. The entire stack (Node.js, npm, Electron, Git, Chrome, PowerShell) runs natively on Windows.

**Prerequisites:** Install Node.js, Git, and Google Chrome from their official Windows installers.

```powershell
# Clone the repo
git clone <your-repo-url> UTS-win-automation-UI
cd UTS-win-automation-UI

# Install dependencies (one time)
npm install
cd renderer && npm install && cd ..
cd server && npm install && cd ..

# Start the scheduler service (separate terminal)
cd server
set UTS_SCHEDULER_DATA_DIR=./data && node scheduler-service.js

# Start the app with hot reload (separate terminal)
cd UTS-win-automation-UI
npm run dev
```

This gives you the full app with hot reload — same workflow as on Ubuntu. Only build the installer (`npm run dist`) when you're ready to distribute to machines where users won't have Node.js installed.

### Building for production

```bash
npm run build:renderer     # Build renderer static files
npm run dist               # Build Windows installer (.exe)
```

### Server scripts

```bash
cd server
npm start                          # Start the Electron backend (port 5000)
npm run start:scheduler            # Start the scheduler service (port 5050)
npm run install:service:win        # Install scheduler as Windows Service
npm run uninstall:service:win      # Remove Windows Service
npm run install:service:linux      # Install scheduler as systemd service
```

### Project dependencies

| Component | Key Packages |
|---|---|
| **Electron shell** | electron, electron-builder |
| **Frontend** | react, react-dom, vite |
| **Backend** | express, ws, simple-git, selenium-webdriver, uuid |
| **Scheduler** | express, node-cron, uuid |
| **Encryption** | Node.js built-in crypto (AES-256-GCM) |
| **Desktop automation** | PowerShell (built into Windows) |
| **Service install** | node-windows (optional, Windows only) |

---

## Troubleshooting

### Startup diagnostics shows Chrome as unavailable

**Ubuntu:** Install Google Chrome (not snap Chromium):
```bash
wget -q -O /tmp/chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
sudo dpkg -i /tmp/chrome.deb
sudo apt-get -f install -y
```

**Windows:** Install Chrome from https://www.google.com/chrome/ or run `choco install googlechrome`.

> Snap-installed Chromium (`snap install chromium`) does **not** work with Selenium due to sandbox restrictions. Use the Google Chrome .deb package instead.

### "Port 5000 already in use"
Another application is using port 5000. Stop it first, or change the port in `main/backend-manager.js`.

### "Scheduler service is not running" banner
Start the scheduler service:
- **Dev (Linux):** `cd server && UTS_SCHEDULER_DATA_DIR=./data node scheduler-service.js`
- **Dev (Windows):** `cd server && set UTS_SCHEDULER_DATA_DIR=./data && node scheduler-service.js`
- **Production:** Install as a system service (see [Scheduler Service](#scheduler-service))

### Desktop tests don't work on Linux
Expected — the PowerShell desktop driver requires Windows. The startup diagnostics screen shows this. The UI, web tests, scheduling, and all other features work on Linux.

### Electron sandbox error on Linux
The dev script already includes `--no-sandbox`. If running manually: `npx electron . --no-sandbox`.

### Permission denied creating `/var/lib/uts-automation`
The scheduler service needs write access to its data directory. Options:
- Install as a systemd service: `sudo bash scripts/install-service-linux.sh`
- Use a custom path: `UTS_SCHEDULER_DATA_DIR=./data node scheduler-service.js`
- Create the directory manually: `sudo mkdir -p /var/lib/uts-automation && sudo chown $USER /var/lib/uts-automation`

### "SessionNotCreatedError: DevToolsActivePort file doesn't exist"
This means Selenium can't connect to the browser. Common causes:
- **Snap Chromium on Ubuntu** — Switch to Google Chrome (see above)
- **Missing Chrome** — Install Google Chrome
- **Permissions** — Try adding `--no-sandbox` (the app does this automatically)
