---
title: Installing on a VM
nav_order: 8
---

# Installing Marvin on a Windows VM

This page is for whoever deploys Marvin to a Windows VM, especially a **shared,
multi-user VM** where several people log in and everyone needs the app and the
same set of scheduled tests. It covers prerequisites, the two install methods,
the scheduler service, verification, and the problems you are most likely to
hit on a managed (locked-down) machine.

If you are building the installer rather than deploying it, see
[Building and Installing](building-and-installing.html).

## What you need on the VM first

| Requirement | Why | Check |
|---|---|---|
| **Node.js 20+** on the `PATH` | Tests run as `node run.js`; the scheduler service is a Node process | `node --version` |
| **Git** on the `PATH` | Cloning test repos uses the system `git` | `git --version` |
| **Administrator rights** for the install | The install is machine-wide, into `Program Files` | Run elevated |

Marvin will start without Node or Git, but it cannot run a test or clone a repo
without them, so treat both as hard prerequisites.

## How multi-user works

Understanding this up front avoids surprises on a shared VM.

- **The install is machine-wide.** The build sets `perMachine: true`, so the app
  installs into `C:\Program Files\Marvin` with Desktop and Start Menu shortcuts
  in the all-users profile. **Every account that logs into the VM sees the icon
  and can launch Marvin.** There is no per-user install option.
- **Each user has their own tests, sequences, and secrets**, stored under their
  own `%APPDATA%\Marvin`. Users do not share these.
- **Users can run Marvin at the same time.** Each session starts its own backend
  on an automatically chosen free port, so two people logged into the VM at once
  do not clash.
- **Schedules are shared across all users.** The scheduler service stores them
  in `C:\ProgramData\uts-automation`, so every user sees and can edit the same
  scheduled sequences, and each schedule fires once no matter how many people
  are logged in. Schedules carry a bundled copy of their test code, so a
  schedule still runs for a user whose own test repo does not contain that test.

> **Security note.** A schedule carries the creating user's secrets so the
> service can run it. Those secrets are **encrypted at rest** with a machine key,
> and the scheduler service **restricts its data directory
> (`C:\ProgramData\uts-automation`) to SYSTEM and Administrators** on startup, so
> a standard user cannot read the schedule or secret files directly.
>
> One residual path remains by design: any local user can *export* a schedule
> (choosing their own password) and re-import it to recover its secrets, because
> schedules are shared and there is no per-user ownership yet. If that matters
> for your VM, restrict who can reach the app, and treat closing it as a
> follow-up (it needs per-user schedule ownership).

## Method 1: the NSIS installer (if it builds)

If you have a working `Marvin Setup <version>.exe` (80 to 150 MB, not a few
hundred KB, see the troubleshooting note below):

1. On the VM, right-click the `.exe` and **Run as administrator**.
2. Accept the elevation prompt. The wizard installs into `Program Files` and
   creates all-users shortcuts.
3. Install the scheduler service (next section).

## Method 2: the PowerShell deploy script (recommended on locked-down VMs)

On many managed/corporate machines the NSIS installer **cannot be built**,
because the security policy blocks the downloaded `makensis.exe` from running
(you get `spawn EPERM`). The packaging step before NSIS still succeeds, so
`dist\win-unpacked` is a complete, working app, and `scripts\deploy-win.ps1`
installs that folder machine-wide, doing the same job as the NSIS installer.

1. Copy the built `win-unpacked` folder (and the `scripts` folder next to it) to
   the VM, or to a network share reachable from the VM.
2. Open **PowerShell as administrator** on the VM.
3. Run:

   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts\deploy-win.ps1
   ```

   To deploy one build to many VMs from a share, point `-Source` at it:

   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts\deploy-win.ps1 -Source \\server\share\marvin\win-unpacked
   ```

The script copies the app to `C:\Program Files\Marvin`, creates all-users
Desktop and Start Menu shortcuts, registers the scheduler service, and refuses
to run if the build is missing its backend dependencies (so a broken build is
caught before it is installed, not after).

**Close Marvin on every logged-in session before running it.** A running
instance locks its own files and the copy will fail.

## Install the scheduler service

**Required for schedules to work at all.** Without it, the schedules screen has
nothing to talk to and no user sees any schedules. `deploy-win.ps1` registers it
for you; if you used the NSIS installer, or need to (re)install it by hand, run
from an **elevated** prompt:

```powershell
node scripts\install-service-win.js
```

It installs as the **Marvin Scheduler** Windows service, runs as LocalSystem,
and stores its data in `C:\ProgramData\uts-automation`. To remove it:

```powershell
node scripts\uninstall-service-win.js
```

Marvin also tries to start the service automatically if it finds it stopped, so
in normal use you should not need to touch it after install.

## Verify the install

Log in as a **second, non-administrator user** (this is the real test of a
multi-user deployment, the installing admin would see the icon either way) and
confirm:

1. The **Marvin** icon is on the Desktop and in the Start Menu.
2. Marvin launches, and the startup diagnostics screen shows **Node, Git,
   PowerShell, and Scheduler** all green (Chrome/ChromeDriver only matter for
   web tests).
3. A schedule created by another account is visible on the Schedules screen.
4. A test actually runs: add the built-in sample (or a test from
   `https://github.com/Perpaterb/win-marvin-tests`) to the run sequence and click
   **Run Sequence**.

## Upgrading an existing install

1. Close Marvin in every logged-in session.
2. Re-run `deploy-win.ps1` (or the new NSIS installer). The deploy script
   replaces the install directory rather than merging, so stale files from the
   old version do not linger.
3. Test data in `%APPDATA%\Marvin` and schedules in `C:\ProgramData\uts-automation`
   are left untouched by an upgrade.

## Troubleshooting

**"Marvin Setup .exe" is only a few hundred KB.** That is a leftover fragment,
not an installer. The NSIS build failed (see `spawn EPERM` above). A real
installer is 80 to 150 MB. Use Method 2 instead.

**The app opens but says the backend did not start.** Open the log it names,
`%APPDATA%\Marvin\logs\backend.log`. The most common cause is a build packaged
without the server's dependencies; the log will say so. Rebuild and redeploy. (A
second user getting this while the first had Marvin open was an older fixed bug,
a fixed port collision; make sure you are on a current build.)

**The Schedules screen says the service is not running.** The scheduler service
is not installed or will not start. Install it (above) from an elevated prompt.
If it is installed but a standard user cannot start it, ask an administrator to
start the **Marvin Scheduler** service or set it to start automatically.

**Everything is extremely slow (many seconds per action).** This was a known
issue on managed VMs and is fixed: Marvin now reuses a single PowerShell process
per test run instead of spawning one per action. Make sure you are running a
build from this version. As an escape hatch you can force the old behaviour by
setting the environment variable `UTS_POWERSHELL_SESSION=0`, but you should not
need to.

**Git or Node "not found" errors when running a test.** They are not on the
`PATH` for the account running Marvin. Install them machine-wide and re-check
`node --version` / `git --version` in a fresh session.
