---
title: Home
nav_order: 1
---

# Marvin

Marvin is a desktop and web test automation tool. It runs Selenium web tests and
PowerShell/Win32 desktop tests from a native Electron app, with scheduling, Zephyr
Scale reporting, secrets management, and encrypted schedule bundles.

## Documentation

- [Creating Tests](creating-tests.html): how to write `run.js` tests, the full web
  and desktop driver API, secrets, parameters, Zephyr reporting, OCR and image
  matching, and a copy-pasteable AI prompt.
- [Example Tests](example-tests.html): a ready-made set of eight worked examples
  from the `win-marvin-tests` repo, including the image-recognition resolution note.
- [How to: Secrets](how-to-secrets.html): add, use, and store secrets safely.
- [How to: Zephyr reporting](how-to-zephyr.html): connect Marvin to Zephyr Scale
  and post results to a test cycle.
- [How to: Schedules](how-to-schedules.html): run test sequences on a timetable
  with the scheduler service.
- [Building and Installing](building-and-installing.html): build the Windows
  installer (`.exe`) and the packaging details, for developers.
- [Installing on a VM](installing-on-a-vm.html): deploy Marvin to one or more
  Windows VMs, including shared multi-user machines, the scheduler service, and
  troubleshooting on locked-down machines.
- [C# / .NET support](design-dotnet-support.html): coming soon.

## Quick start

1. Launch Marvin (installed `.exe` or `npm run dev`).
2. Review the startup diagnostics screen, then continue.
3. Choose Desktop or Web mode.
4. Paste a GitHub repo URL and refresh tests, or use the built-in sample test. To
   try the worked examples, paste `https://github.com/Perpaterb/win-marvin-tests`.
5. Add tests to the run sequence and click Run Sequence, or schedule them.

See [Creating Tests](creating-tests.html) to author your own, or the
[Example Tests](example-tests.html) page for a ready-made set to try.
