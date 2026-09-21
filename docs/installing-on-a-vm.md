---
title: Installing on a VM
nav_order: 8
---

# Installing Marvin on a Windows VM

**Follow the steps.** They are the whole install, in order, for a shared Windows
VM. Everything under [Reference](#reference) explains why a step exists and what
to do when one goes wrong; you do not need to read it to install Marvin.

If you are building the installer rather than deploying it, see
[Building and Installing](building-and-installing.html).

## Before you start

- **Node.js 20+ and Git, installed for _all users_.** A "just me" install is
  invisible to other profiles and to the scheduler service, which is the single
  most common problem on a shared VM. See
  [What you need on the VM first](#what-you-need-on-the-vm-first).
- **Administrator rights.** The install is machine-wide.
- **Never delete `C:\ProgramData\uts-automation`.** It holds every schedule and
  `secrets_master_key`. Every secret, stored or bundled into a schedule, is
  encrypted with that key and cannot be recovered without it. Nothing in this
  guide asks you to remove it.

## Install it: the steps

All of this runs in **one elevated PowerShell window** (right-click PowerShell,
**Run as administrator**). Every step has a **Check**. If a check does not look
right, stop and read the matching part of [Reference](#reference).

Prove the window is elevated before you start. Without this, service commands
fail quietly and you will get halfway through with nothing having happened:

```powershell
([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
```

It must print `True`.

Steps 6 and 7 are only for **scheduled desktop tests**. Skip them if you only
schedule web tests.

### 1. Close Marvin

Close it in every session on the VM. A running copy locks its own files and the
install will fail.

### 2. Update the clone you build from

The clone is your **build source**. It is not where the installed app runs.

```powershell
cd C:\Users\<you>\UTS-win-automation-UI
git pull
npm install
cd renderer; npm install; cd ..
cd server; npm install; cd ..
```

### 3. Remove the old service

Skip this on a VM that has never had Marvin installed.

This must happen **before** you install. First see what is registered and stop
it. No `-ErrorAction SilentlyContinue` here on purpose: if stopping fails, you
need to see it rather than carry on.

```powershell
Get-CimInstance Win32_Service -Filter "Name like 'marvin%'" | Select Name, State, PathName | Format-List
Stop-Service -DisplayName "Marvin Scheduler"
Get-Service -DisplayName "Marvin Scheduler"
```

The second command must show **Stopped** before you go on.

Now remove the registration. `sc.exe` is the reliable way: it does not care
where the service's files are or whether they still exist. Use the `Name` from
the first command (it usually ends in `.exe`):

```powershell
sc.exe delete "marvinscheduler.exe"
```

**Check** — this should return nothing at all:

```powershell
Get-Service -DisplayName "Marvin Scheduler" -ErrorAction SilentlyContinue
```

**Only once that check is clean**, delete the old daemon folder:

```powershell
Remove-Item -Recurse -Force C:\Users\<you>\UTS-win-automation-UI\server\daemon
```

Deleting it earlier removes the service's own executable and logs while it is
still registered, which leaves a service that cannot start and cannot easily be
removed.

There is also `node scripts\uninstall-service-win.js --script "<the PathName's
server\scheduler-service.js>"`, which unregisters it the same way it was
registered. It needs `node-windows`, which lives in `server/node_modules`, so
run `cd server && npm install` first if it complains. `sc.exe delete` needs
nothing and is the safer choice when an install is already part-dismantled.

### 4. Build

```powershell
npm run dist
```

A few minutes.

> **This step is expected to end in what looks like a failure.** On a managed
> VM you will see something like:
>
> ```
> ⨯ spawn EPERM     failedTask=build
> ✖ Build failed after 132s (exit code 1).
> ```
>
> That is only the **NSIS installer** step, which machine policy blocks from
> running `makensis.exe`. It happens *after* the app itself has been packaged,
> so the folder you actually deploy, `dist\win-unpacked`, is complete and
> correct. Step 5 installs from that folder and never touches the `.exe`
> installer. Carry on.

**Check** — this is what decides whether the build worked, not the exit code:

```powershell
Test-Path dist\win-unpacked\Marvin.exe
```

`True` means you have everything you need. If it is `False`, or the build failed
with something other than `spawn EPERM` on NSIS, that is a real failure: see
[Troubleshooting](#troubleshooting).

### 5. Install machine-wide

```powershell
powershell -ExecutionPolicy Bypass -File scripts\deploy-win.ps1
```

This copies the app to `C:\Program Files\Marvin`, creates the all-users
shortcuts, and registers the scheduler service against the copy it just
installed.

**Check** — `PathName` must be inside `C:\Program Files\Marvin`, not a user
profile, and the service must answer:

```powershell
Get-CimInstance Win32_Service -Filter "Name like 'marvin%'" | Select Name, StartName, PathName | Format-List
Invoke-RestMethod http://localhost:5050/api/health | Format-List
```

`status` should be `ok`, and `schedules` should be the number of schedules you
expect. A `degraded` status names the file it cannot read or write: fix that
before going further, because the service cannot list or save a schedule in that
state.

### 6. Create the automation account

**Scheduled desktop tests only.** They need a desktop, and the service does not
have one, so they run in a dedicated account's session that stays signed in. See
[Set up the automation account](#set-up-the-automation-account-scheduled-desktop-tests-only)
for what this does and why.

```powershell
powershell -ExecutionPolicy Bypass -File scripts\setup-automation-account.ps1 -AppDir "C:\Program Files\Marvin"
```

**Check** — read the `warnings` list it prints. A warning about
`InactivityTimeoutSecs` means a machine-wide policy will lock the automation
session and desktop schedules will fail once it fires; that VM needs an
exemption.

### 7. Reboot

The VM signs itself in as the automation account and stays signed in. That
session is the desktop your overnight runs use. Sign back in as yourself
afterwards as normal, then:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\setup-automation-account.ps1 -Mode settings
```

Only needed if step 6 said the profile did not exist yet. Running it again is
harmless.

### 8. Check it in the app

Open Marvin and look at the startup checks:

- **Scheduler Service** green, with your schedules loaded.
- **Desktop Session** green, naming a session (desktop schedules only).

A red row names the cause and the fix. There is a fuller list in
[Verify the install](#verify-the-install).

### 9. Prove it end to end

Schedule a **desktop** sequence a few minutes out, then disconnect your RDP
session and wait. Nothing else proves a run works with no human signed in, which
is the entire point of the automation account.

## Reference

Everything below is explanation and troubleshooting. Read the part you need.

### What you need on the VM first

| Requirement | Why | Check |
|---|---|---|
| **Node.js 20+** on the `PATH` | Tests run as `node run.js`; the scheduler service is a Node process | `node --version` |
| **Git** on the `PATH` | Cloning test repos uses the system `git` | `git --version` |
| **Administrator rights** for the install | The install is machine-wide, into `Program Files` | Run elevated |

Marvin will start without Node or Git, but it cannot run a test or clone a repo
without them, so treat both as hard prerequisites.

> **Install Node and Git for _all users_, not just your profile.** This is a
> common trip-up on a shared VM. Git for Windows offers "all users" (system
> `PATH`, in `Program Files`) or "just me" (your `%LOCALAPPDATA%`, your user
> `PATH` only). A "just me" install works for the account that installed it but
> is invisible to every other profile, and to the scheduler service (which runs
> as LocalSystem and uses the system `PATH`), so those users get "git not found"
> when pulling a test repo. Install both machine-wide, then have each user start
> a fresh session so the system `PATH` is picked up.

### How multi-user works

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

### Remove an older install first

Do this before reinstalling, especially if Marvin was previously run from a
**git clone in someone's profile** (for example
`C:\Users\<you>\UTS-win-automation-UI`). That layout registers the scheduler
service against that profile, so the service keeps running from there after a
reinstall, and you end up with the new app talking to an old service.

**Check what is actually registered before you remove anything:**

```powershell
Get-CimInstance Win32_Service -Filter "Name like 'marvin%'" | Select Name, StartName, PathName | Format-List
```

`PathName` tells you which copy owns the service. Then, from an **elevated**
prompt:

```powershell
# 1. Stop it, and confirm it stopped
Stop-Service -DisplayName "Marvin Scheduler"
Get-Service -DisplayName "Marvin Scheduler"

# 2a. Remove the registration. sc.exe does not depend on the service's files
#     still being intact, so it works even on a part-dismantled install.
#     Use the Name from the PathName check above.
sc.exe delete "marvinscheduler.exe"

# 2b. Or unregister it the way it was registered, naming the SAME script path.
#     node-windows derives the daemon directory from that path, so a service
#     registered from a clone has to be removed by pointing --script at it.
#     Needs node-windows, which lives in server/node_modules.
node scripts\uninstall-service-win.js --script "C:\Users\<you>\UTS-win-automation-UI\server\scheduler-service.js"

# 3. Confirm it is gone: this should return nothing
Get-Service -DisplayName "Marvin Scheduler" -ErrorAction SilentlyContinue
```

**Delete the `server\daemon` folder only after step 3 comes back empty.** It
holds the service's own executable and its logs, so removing it while the
service is still registered leaves something that cannot start and cannot
cleanly be removed. Then close Marvin in every session and delete the old app
folder.

**Do not delete `C:\ProgramData\uts-automation`.** It holds every schedule,
the encrypted secrets, and `secrets_master_key`. Every secret ever stored, and
every secret bundled into a schedule, is encrypted with that key and **cannot be
recovered without it**. A reinstall is meant to leave that directory alone.

What is safe to remove:

| Path | Remove? |
|---|---|
| The old app folder or clone | Yes, after the service is unregistered |
| `server\daemon` in the old location | Yes, if unregistering left it |
| `%APPDATA%\Marvin` (per-user tests, sequences, secrets) | Only if you want that user to start clean |
| `C:\ProgramData\uts-automation` | **No.** Losing the master key orphans every secret |

### Method 1: the NSIS installer (if it builds)

If you have a working `Marvin Setup <version>.exe` (80 to 150 MB, not a few
hundred KB, see the troubleshooting note below):

1. On the VM, right-click the `.exe` and **Run as administrator**.
2. Accept the elevation prompt. The wizard installs into `Program Files` and
   creates all-users shortcuts.
3. Install the scheduler service (next section).

### Method 2: the PowerShell deploy script (recommended on locked-down VMs)

On many managed/corporate machines the NSIS installer **cannot be built**,
because the security policy blocks the downloaded `makensis.exe` from running.
The build ends with `spawn EPERM` and `Build failed after Ns (exit code 1)`,
which looks fatal and is not: the packaging step before NSIS still succeeds, so
`dist\win-unpacked` is a complete, working app, and `scripts\deploy-win.ps1`
installs that folder machine-wide, doing the same job as the NSIS installer.
Judge the build by whether `dist\win-unpacked\Marvin.exe` exists, not by the
exit code.

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

### Install the scheduler service

**Required for schedules to work at all.** Without it, the schedules screen has
nothing to talk to and no user sees any schedules. `deploy-win.ps1` registers it
for you; if you used the NSIS installer, or need to (re)install it by hand, run
from an **elevated** prompt:

```powershell
node scripts\install-service-win.js
```

It installs as the **Marvin Scheduler** Windows service, runs as LocalSystem,
and stores its data in `C:\ProgramData\uts-automation`.

**Register the installed copy, not the clone you are standing in.** The script
registers the `server` folder next to itself unless told otherwise, so running
it from a clone in your profile registers that clone. That service then runs
from your profile: it breaks if the profile is removed, and the automation
account that runs scheduled desktop tests cannot read another user's profile at
all. `deploy-win.ps1` now passes the installed path for you. By hand it is:

```powershell
node scripts\install-service-win.js --script "C:\Program Files\Marvin\resources\app\server\scheduler-service.js"
```

Check what you ended up with:

```powershell
Get-CimInstance Win32_Service -Filter "Name like 'marvin%'" | Select Name, StartName, PathName | Format-List
```

`StartName` should be `LocalSystem` and `PathName` should point inside
`C:\Program Files\Marvin`. To remove it, name the same path it was installed
with:

```powershell
node scripts\uninstall-service-win.js --script "C:\Program Files\Marvin\resources\app\server\scheduler-service.js"
```

Marvin also tries to start the service automatically if it finds it stopped, so
in normal use you should not need to touch it after install.

### Set up the automation account (scheduled desktop tests only)

**Scheduled web tests need nothing here.** Scheduled *desktop* tests do, and
without it they cannot work at all.

The scheduler service runs as LocalSystem, which lives in Session 0. Session 0
has its own window station and no interactive desktop, so a desktop step run
from there fails with `Access is denied` on every keystroke and
`The handle is invalid` on every screenshot. The same sequence passes from Run
Sequence, because that runs in your own session.

Desktop automation needs a real desktop, and a desktop needs somebody signed
in. For runs at 3am with nobody at the machine, that means a dedicated local
account that is signed in permanently:

```powershell
# elevated
powershell -ExecutionPolicy Bypass -File scripts\setup-automation-account.ps1 `
  -AppDir "C:\Program Files\Marvin" -DataDir "C:\ProgramData\uts-automation"
```

What it does:

- Creates the local account `marvin-auto`, **not** an administrator, with a
  48-byte random password it generates and never shows anyone.
- Writes that password to the **LSA secret** Winlogon reads at boot, then
  discards it. It is not written to a file and not put in Marvin's secrets
  store. The service never needs it: `WTSQueryUserToken` hands LocalSystem a
  token for an already signed-in session without any credential.
- Denies that account network logon and Remote Desktop logon, and hides it from
  the sign-in screen. Nobody can sign in as it, not least because nobody knows
  the password.
- Turns off the screensaver, the secure screensaver and workstation locking
  **for that account only**. Input cannot be sent to a locked desktop, so a
  lock at 3am is a failed run.
- Grants it read and execute on the install directory, and read on the run
  directories under `C:\ProgramData\uts-automation`. The schedule store, the
  encrypted secrets and the master key stay restricted to SYSTEM and
  Administrators.

Then **reboot**. The account signs in by itself and stays signed in.

Two things to know:

- **The per-user lock settings need a profile**, which only exists after the
  first autologon. If the script says so, re-run it after the reboot with
  `-Mode settings`.
- **A machine-wide inactivity limit overrides all of this.** The script warns
  if `InactivityTimeoutSecs` is set, and deliberately does not change it:
  weakening a security baseline for the whole VM is not a script's call. If it
  is set, that VM needs an exemption or scheduled desktop tests will start
  failing whenever it fires.

Marvin's startup checks show a **Desktop Session** row. It goes green only when
Marvin can open that session's input desktop, which it proves by starting a
process in the session rather than assuming it from the account existing. If it
is red, the row names which of these is wrong.

Why the install directory matters: the run executes as `marvin-auto`, so
everything it loads, including `node_modules`, has to be readable by that
account. A machine-wide install under `C:\Program Files\Marvin` already is,
because Windows grants Users read and execute there. A clone under
`C:\Users\<someone>` is not, and no amount of configuration will make it
work.

### If the VM has a machine-wide inactivity limit

The setup script warns when it finds one:

```
WARNING: the machine-wide inactivity limit is set to 900 seconds. It will lock
the automation session too, and scheduled desktop tests will fail once it fires.
```

This is the **"Interactive logon: Machine inactivity limit"** security setting,
stored at
`HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System\InactivityTimeoutSecs`.
It applies to every session on the machine, including the automation account's,
and the per-user settings the setup script writes do not override it. Fifteen
minutes of no input and the session locks.

A locked desktop cannot be sent input, so every scheduled desktop run after that
point fails. It is also **unrecoverable without a reboot**: the account's
password is written to the LSA secret and discarded, by design, so nothing
holds a credential that could unlock the session. Autologon on the next boot is
the only way back in.

Check what is set, and whether it is local or pushed by policy:

```powershell
Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System" -Name InactivityTimeoutSecs
gpresult /scope computer /r
```

If a domain GPO applies it, clearing it locally is undone at the next policy
refresh (usually within 90 minutes), so it has to be fixed centrally.

In order of preference:

1. **Have the VM exempted** from that policy: its own OU, a WMI filter, or a
   scoped policy that sets the limit to `0`. This is the correct fix. The VM
   runs no interactive human sessions except administration, and the automation
   account cannot be signed into by a person: it is denied network and Remote
   Desktop logon, hidden from the sign-in screen, and nobody knows its password.
2. **The built-in keep-alive**, which the setup script registers for you. It
   runs in the automation session and injects a **zero-distance** mouse move
   every four minutes: Windows counts it as input and resets the idle timer, but
   the cursor does not move, so it cannot disturb a test that is driving the
   mouse at that moment. A one-pixel jiggle would, which is why it is not one.

   It is registered as a scheduled task triggered **at logon** for that account,
   so autologon after any reboot brings it back with the session. Nothing needs
   starting by hand.

   It writes a heartbeat each cycle, and the **Desktop Session** startup check
   reads it. If the keep-alive dies, the row still shows the session working but
   adds a warning saying so, while the session is still unlocked and the problem
   is still fixable. A scheduled task sitting in "Running" with a wedged script
   behind it would otherwise look identical to one that is working.

   Verify it, from an elevated prompt:

   ```powershell
   Get-ScheduledTask -TaskName "Marvin keep automation session awake" | Select TaskName, State
   Get-Content C:\ProgramData\uts-automation\tmp\keep-awake.heartbeat
   ```

   The heartbeat should be within the last few minutes. If the file does not
   exist, the keep-alive has never run in that session.

   Be straight with whoever owns the policy about this: it is an inactivity
   control being defeated for one account, even though that account cannot be
   used by a person. Exempting the VM is the cleaner answer, which is why it is
   still first on this list.
3. **A reboot scheduled shortly before the run.** Autologon produces a fresh,
   unlocked session, and the limit only fires after the idle period. This is
   fragile (a run starting more than the limit after boot is back to square one)
   and is a stopgap, not a fix.

Until one of those is in place, **scheduled web tests still work normally**.
Only desktop schedules depend on the session.

### Verify the install

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

### Upgrading an existing install

1. Close Marvin in every logged-in session.
2. Re-run `deploy-win.ps1` (or the new NSIS installer). The deploy script
   replaces the install directory rather than merging, so stale files from the
   old version do not linger.
3. Test data in `%APPDATA%\Marvin` and schedules in `C:\ProgramData\uts-automation`
   are left untouched by an upgrade.
4. Confirm the service is still registered against the install and not an old
   clone (`PathName` in the check above), and restart it so the new build is
   what is actually running:

   ```powershell
   Restart-Service -DisplayName "Marvin Scheduler"
   Invoke-RestMethod http://localhost:5050/api/health | Format-List
   ```

   `status` should be `ok` and `schedules` should be the number you expect. A
   `degraded` status names the file it cannot read or write, which is the point:
   a service that cannot reach its data directory used to report zero schedules
   and look healthy.

### Troubleshooting

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

**"Windows cannot access the specified device, path, or file" when launching
Marvin.** Windows is being blocked from running `Marvin.exe`. On a managed
machine this is usually **Microsoft Defender Attack Surface Reduction (ASR)**,
specifically the rule **"Block executable files from running unless they meet a
prevalence, age, or trusted list criterion"** (rule ID
`01443614-CD74-433A-B99E-2ECDC07BFC25`). It blocks Marvin because the executable
is **unsigned and low-prevalence** (Microsoft's cloud has not seen it on enough
machines to trust it). Classic symptom: it launches fine for a day or two, then
starts being blocked every time as the cloud reputation settles.

Confirm it on the machine (elevated):

```powershell
Get-WinEvent -LogName "Microsoft-Windows-Windows Defender/Operational" -MaxEvents 30 |
  Where-Object { $_.Id -eq 1121 } | Select-Object TimeCreated, Message | Format-List
```

Event **1121** naming `Marvin.exe` and that rule ID is the confirmation (the file
and its `Users:(RX)` permissions are fine; it is purely the ASR rule).

This rule is centrally managed, so no local user or admin can override it, **IT
must act**:

- **Immediate:** add an ASR exclusion for the whole install folder (not just the
  exe, so bundled binaries like `chromedriver.exe` are covered too):

  ```powershell
  Add-MpPreference -AttackSurfaceReductionOnlyExclusions "C:\Program Files\Marvin"
  ```

  (applied via Intune / GPO, or locally if tamper protection allows).
- **Durable:** **code-sign the app** (see Building and Installing, code signing).
  A signed binary from a trusted publisher satisfies the rule's "trusted list"
  criterion, so it is no longer treated as unknown, and usually removes the need
  for a per-path exclusion.

**Git or Node "not found" errors when running a test, or repo pulls fail for
some users but not others.** Node or Git was installed **"just me"** on one
profile, so it is only on that user's `PATH`. Check the **Git** row on each
user's startup diagnostics screen (green for the installer, red for others), or
run `where.exe git` (a path under `%LOCALAPPDATA%` means a per-user install).
Reinstall Git for Windows / Node **for all users** so they land on the system
`PATH`, then log off and on so each session picks it up. The scheduler service
(LocalSystem) also needs them on the system `PATH`.
