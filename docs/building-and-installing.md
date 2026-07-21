---
title: Building and Installing
nav_order: 3
---

# Building and installing the Windows installer

Marvin ships as a single NSIS `.exe` installer that bundles Electron, the Node
server and its dependencies, the built renderer, and a portable Git. Target
machines do not need Node.js or Git installed.

## Build the installer

Build on a Windows 10/11 machine. NSIS packaging, native dependencies, and code
signing are far more reliable building on Windows than cross-building from Linux.

Prerequisites on the build machine: Node.js 20+ and Git.

```powershell
# From the repo root
npm install
cd renderer; npm install; cd ..

# Build the installer
npm run dist
```

`npm run dist` runs:

1. `predist`: builds the renderer (Vite, into `renderer/dist`) and installs the
   server production dependencies.
2. `electron-builder --win`: packages an NSIS installer into `dist/`.

### Output

The installer is written to `dist/Marvin Setup <version>.exe` (for example
`dist/Marvin Setup 1.0.0.exe`).

To produce a `marvin-setup-<version>.exe` filename instead, add an `artifactName`
to the `nsis` block in `package.json`:

```json
"nsis": {
  "oneClick": false,
  "allowToChangeInstallationDirectory": true,
  "artifactName": "marvin-setup-${version}.${ext}"
}
```

## Install

Double-click the `Setup` `.exe`. Because the build sets `oneClick: false` and
`allowToChangeInstallationDirectory: true`, the wizard lets the user pick an
install folder. After installation, Marvin launches from its Start Menu shortcut.
The uninstaller removes the app and shortcuts.

The build sets `perMachine: true`, so the installer always installs for **all
users**. It prompts for administrator elevation, installs into `Program Files`,
and writes the Desktop and Start Menu shortcuts to the all-users profile. Every
account that logs into the machine sees the icon and can launch Marvin. A
per-user install is not offered.

### What is shared and what is not

Each user gets their own test repo, saved sequences, and secrets, under their own
`%APPDATA%\Marvin` (see `getDataDir()` in `main/backend-manager.js`).

Schedules are the exception: they are shared machine-wide. The Electron backend
does not run cron jobs, it proxies all schedule operations to the scheduler
service, which stores everything in `C:\ProgramData\uts-automation`. So every
user sees and can edit the same set of scheduled sequences, and each schedule
fires once regardless of how many users are logged in.

Schedules carry a bundled copy of their test code, so a schedule still runs, and
is still visible, for users whose own test repo does not contain that test.

## Scheduler service (required for shared schedules)

The scheduler service owns schedule storage and execution. Without it installed,
the schedules screen has nothing to talk to and no user sees any schedules.
Install it once per machine, from an elevated prompt after installing Marvin:

```powershell
node scripts\install-service-win.js
```

To remove it:

```powershell
node scripts\uninstall-service-win.js
```

On Linux the equivalent is a systemd unit:

```bash
sudo bash scripts/install-service-linux.sh
```

## Notes

- Building on Linux: electron-builder can target Windows via wine/mono, but it is
  fragile and the result is unsigned. Build on Windows for any real release.
- Code signing: the default build produces an unsigned installer, so Windows
  SmartScreen will warn users on first run. For wide distribution, sign the
  installer with a code-signing certificate (configure `win.certificateFile` and
  `win.certificatePassword`, or an EV/HSM signer) in `package.json`.
