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
- [Building and Installing](building-and-installing.html): build the Windows
  installer (`.exe`), install it, and set up the scheduler service.
- [Acceptance Checklist: Web mode](acceptance-web.html): tester sign-off checklist
  for web features.
- [Acceptance Checklist: Desktop mode](acceptance-desktop.html): tester sign-off
  checklist for desktop features.
- [Design: C# / .NET test support](design-dotnet-support.html): proposed design for
  adding a second test language (EPEA-1916).

## Quick start

1. Launch Marvin (installed `.exe` or `npm run dev`).
2. Review the startup diagnostics screen, then continue.
3. Choose Desktop or Web mode.
4. Paste a GitHub repo URL and refresh tests, or use the built-in sample test.
5. Add tests to the run sequence and click Run Sequence, or schedule them.

See [Creating Tests](creating-tests.html) to author your own.
