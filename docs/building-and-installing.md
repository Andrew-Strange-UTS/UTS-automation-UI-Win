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

## Scheduler service (optional)

To keep scheduled sequences running when the Marvin window is closed, install the
scheduler as a Windows Service. Run once from an elevated prompt after installing:

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
