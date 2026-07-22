---
title: "Acceptance: Web mode"
nav_order: 5
---

# Marvin: Web Mode Acceptance Test Checklist

This is a living acceptance-test checklist for **Web mode** in Marvin (the Electron test-automation app). A tester runs through it on a fresh install before each release to confirm that every Web mode feature works end to end: startup and diagnostics, Chrome detection, repo loading, test card configuration, sequence execution, OKTA wrapping, Zephyr Scale reporting, the Secrets Manager, scheduling, ntfy and Teams notifications, and encrypted `.utsb` export/import.

Each step references the Jira story it verifies (EPEA-####). Mark every row Pass or Fail and add notes for anything unexpected. The full run is designed to take **under 60 minutes** on a clean machine. Sections are ordered so you can work top to bottom without backtracking.

Tracks Jira story **EPEA-2512** (Tester onboarding, acceptance test checklist for Web mode).

---

## Prerequisites

Complete these before starting. They are setup, not acceptance steps.

- A clean Windows 10/11 or Ubuntu 22.04+ machine with Marvin freshly installed (or `npm run dev` from a fresh clone).
- **Node.js 18+** and **Git** installed and on PATH.
- **Google Chrome** (or non-snap Chromium) installed. On Ubuntu, use the Google Chrome `.deb`, not snap Chromium.
- The Marvin **mode toggle set to Web** (below the Scheduled Sequences panel).
- A **public** GitHub test repo URL with a `tests/` folder, and a **private** repo URL for the PAT path.
- A GitHub **Personal Access Token** (repo scope) and the matching username, for the private-repo and secrets tests.
- A **Zephyr Scale API token** plus a Project Key, Case Key, and Cycle Key for a throwaway test cycle (optional but needed for the Zephyr section).
- An **ntfy topic** name and a **Microsoft Teams incoming webhook URL** (optional, for the notifications section).
- The scheduler service running (`node scheduler-service.js`) so the scheduling section can execute.

---

## 1. Startup, mode toggle and diagnostics (EPEA-2487, EPEA-2488, EPEA-2489)

| Step | Expected Result | Pass/Fail | Notes |
|---|---|---|---|
| Launch Marvin (installed `.exe` or `npm run dev`) (EPEA-2487 AC1) | App opens as a native window titled "Marvin"; the Express backend starts on port 5000. | | |
| Observe the diagnostics screen on launch (EPEA-2489 AC1) | A diagnostics screen appears before the main dashboard. | | |
| Review the diagnostics checks (EPEA-2489 AC2) | All 7 checks shown with status badges: Node.js, OS, Git, Chrome, ChromeDriver, PowerShell, Scheduler. | | |
| Check PowerShell row on the current OS (EPEA-2489 AC3) | On Linux it shows N/A (not a failure); on Windows it passes. | | |
| Inspect any failed/warning check (EPEA-2489 AC4) | A short remediation hint is shown, with an install link where applicable. | | |
| Click Continue with at least one non-pass check present (EPEA-2489 AC5) | Continue is always enabled and proceeds to the main dashboard. | | |
| Locate the Desktop/Web mode toggle (EPEA-2488 AC1) | Toggle is visible below the Scheduled Sequences panel. | | |
| Confirm Web mode is selected (EPEA-2488 AC3) | Test cards show OKTA Environment selector and Visual Browser option. | | |
| Restart the app and re-check mode (EPEA-2488 AC5) | Web mode persists across restart; diagnostics re-run fresh, not cached (EPEA-2489 AC6). | | |

---

## 2. Chrome / Chromium auto-detection (EPEA-2490)

| Step | Expected Result | Pass/Fail | Notes |
|---|---|---|---|
| Read the Chrome row on the diagnostics screen (EPEA-2490 AC1) | The detected Chrome/Chromium binary path is displayed. | | |
| (Ubuntu, if applicable) Detect snap Chromium (EPEA-2490 AC2) | Snap Chromium is flagged with a warning about Selenium sandbox restrictions. | | |
| (Optional) Rename/hide Chrome and relaunch (EPEA-2490 AC3) | With no Chrome found, diagnostics shows a clear failure plus install instructions. Restore Chrome afterwards. | | |
| Confirm no manual ChromeDriver setup was needed (EPEA-2490 AC4) | Detected binary is used automatically by the web runner. | | |

---

## 3. Repo loading: public, private and PAT (EPEA-2510)

| Step | Expected Result | Pass/Fail | Notes |
|---|---|---|---|
| Paste the public repo URL and click Refresh Tests (EPEA-2510 AC1) | Repo clones and test cards appear. | | |
| Inspect a rendered card (EPEA-2510 AC4) | Card title comes from metadata.json, or the folder name as fallback. | | |
| Tick "Private repository" and load the private repo URL (EPEA-2510 AC2) | Private checkbox enables PAT-based authentication. | | |
| Attempt a private clone with PAT secrets missing (EPEA-2510 AC3) | A setup popup explains how to create a GitHub PAT with repo scope. | | |
| Add the PAT + username (see section 7) then Refresh Tests again (EPEA-2510 AC5) | Private repo clones/pulls latest and shows cards. | | |
| Paste a wrong URL or bad credentials and Refresh (EPEA-2510 AC6) | A clear inline error message is shown, no crash. | | |

---

## 4. Test card configuration and sequence execution (EPEA-2500)

| Step | Expected Result | Pass/Fail | Notes |
|---|---|---|---|
| Configure a test card's parameters and add it to the run sequence | Card parameters are editable; the test is added to the sequence sidebar. | | |
| Run the sequence with Visual Browser OFF (EPEA-2500 AC1, AC3) | Test runs headless against locally installed Chrome with no manual ChromeDriver setup. | | |
| Re-run with Visual Browser ON (EPEA-2500 AC2) | The Chrome window is shown during execution. | | |
| Review the run log in the log viewer | Per-step output and overall pass/fail are visible in the expandable log. | | |
| (Optional) Run with Chrome missing/misconfigured (EPEA-2500 AC4) | A helpful error is surfaced directing the user to install Chrome. | | |

---

## 5. OKTA login wrapping (EPEA-2501)

| Step | Expected Result | Pass/Fail | Notes |
|---|---|---|---|
| Open a Web test card and find the OKTA Environment selector (EPEA-2501 AC1) | Selector offers None, Prod, Pre-prod, Test. | | |
| Add two tests set to the same OKTA environment to the sequence and run (EPEA-2501 AC2, AC3) | Both tests share one browser session; the OKTA login step runs once for the group. | | |
| Observe the end of the OKTA group run (EPEA-2501 AC4) | okta-login-finish runs after the last test in the group. | | |
| Add a test with OKTA set to None and run (EPEA-2501 AC5) | It runs in its own session with no login wrapping. | | |

---

## 6. Zephyr Scale reporting (EPEA-2507)

| Step | Expected Result | Pass/Fail | Notes |
|---|---|---|---|
| Confirm Zephyr fields on a test card (EPEA-2507 AC1) | Project Key, Case Key, and Cycle Key fields are present. | | |
| Run a passing test with valid Zephyr keys (EPEA-2507 AC2, AC4) | A Pass result posts to the Zephyr case; per-step zephyrLog results are included. | | |
| Run a failing test with valid Zephyr keys (EPEA-2507 AC3) | A Fail result posts with step details. | | |
| Run with the ZEPHYR_API_TOKEN secret missing or invalid (EPEA-2507 AC5) | Error is reported in the UI without crashing the run. | | |
| Run a test with no Cycle Key (EPEA-2507 AC6) | Reporting is skipped silently; the test still runs. | | |

---

## 7. Secrets Manager (EPEA-2505, EPEA-2506)

| Step | Expected Result | Pass/Fail | Notes |
|---|---|---|---|
| Open the Secrets Manager on a fresh install (EPEA-2505 AC1) | Three default secrets shown with blank values: ZEPHYR_API_TOKEN, GITHUB_PERSONAL_ACCESS_TOKEN, GITHUB_USERNAME. | | |
| Add a new secret (name + value), click Save (EPEA-2506 AC1) | Secret is created. | | |
| Re-open the saved secret (EPEA-2505 AC2) | Value is masked, not shown in plain text. | | |
| Edit an existing secret's value (EPEA-2506 AC2) | Updated value is saved. | | |
| Delete a secret (EPEA-2506 AC3) | A confirmation prompt appears; the secret is removed after confirming. | | |
| Run a test that references parameters.MY_SECRET (EPEA-2506 AC4, AC6) | The reference resolves at runtime; the secret value is never printed in the run log. | | |
| Reference an undefined secret on a card (EPEA-2506 AC5) | The card shows a warning badge. | | |
| Restart the app and re-open Secrets Manager (EPEA-2505 AC5) | Secrets persist across restart. | | |

---

## 8. Scheduling (EPEA-2502, EPEA-2503)

| Step | Expected Result | Pass/Fail | Notes |
|---|---|---|---|
| Check the scheduler service status banner (EPEA-2502 AC1, AC2) | With the service running, no "not running" warning; `GET /api/health` returns status ok. | | |
| View the Scheduled Sequences panel (EPEA-2503 AC1) | Schedules list shows name, next run time, status, and Zephyr keys. | | |
| Click "+ New Schedule" and complete the form (EPEA-2503 AC2) | Form has name, time, days/presets, and notification fields; schedule is created. | | |
| Inline-edit a schedule's name, time and days (EPEA-2503 AC3) | Edits save without opening a separate screen. | | |
| Click Run Now on a schedule (EPEA-2503 AC4) | An immediate execution starts without changing the cron schedule. | | |
| Toggle Pause then Resume (EPEA-2503 AC5) | Schedule pauses and resumes without being deleted. | | |
| Open the last run log from the card (EPEA-2503 AC6) | The last run log is viewable. | | |
| Watch the countdown timer (EPEA-2503 AC7) | Countdown updates every second showing time to next run. | | |
| (Optional) Close the app and confirm a scheduled run fires (EPEA-2502 AC3) | Schedule runs on time even with the Electron app closed. | | |

---

## 9. ntfy and Teams notifications (EPEA-2508, EPEA-2509)

| Step | Expected Result | Pass/Fail | Notes |
|---|---|---|---|
| Add an ntfy topic in a schedule's notification settings (EPEA-2509 AC1) | ntfy topic field is present. | | |
| Run the schedule and watch the ntfy topic (EPEA-2509 AC2, AC3) | A push arrives at ntfy.sh/{topic}; title is the schedule name, body has the pass/fail count. | | |
| (Optional) Set a custom ntfy server URL and run (EPEA-2509 AC4) | Notification is sent to the custom server. | | |
| Add a Teams "All results" and "Failures only" webhook URL (EPEA-2508 AC1, AC6) | Both URL fields are present in schedule config. | | |
| Set notify to Always and run a passing schedule (EPEA-2508 AC3) | A Teams card posts with schedule name, timestamp, and pass/fail count. | | |
| Run a schedule that fails (EPEA-2508 AC2) | A Teams card posts with schedule name, timestamp, and failed test names. | | |
| Set notify to Never and run (EPEA-2508 AC4) | No notifications are sent. | | |
| (Optional) Enter an invalid webhook URL and run (EPEA-2508 AC5, EPEA-2509 AC5) | The error is logged but the run is not affected. | | |

---

## 10. Export and import .utsb bundles (EPEA-2504)

| Step | Expected Result | Pass/Fail | Notes |
|---|---|---|---|
| Click Export on a schedule and enter a password (EPEA-2504 AC1) | A `.utsb` file downloads. | | |
| Open the `.utsb` file in a text editor (EPEA-2504 AC2) | Content is encrypted, not readable as plain text. | | |
| Import the `.utsb` with the correct password (EPEA-2504 AC3, AC6) | Schedule is restored exactly; bundled secrets merge in without overwriting unrelated secrets. | | |
| Import the `.utsb` with a wrong password (EPEA-2504 AC4) | Import fails gracefully with a descriptive error. | | |
| Confirm image templates round-trip (EPEA-2504 AC5) | Templates included in the export are restored on import. | | |

---

## Sign-off

Complete before each release. The release is approved for Web mode only when every required row above is marked Pass (or has an accepted, documented exception).

| Field | Value |
|---|---|
| Tester name | |
| Date (DD MMM YYYY) | |
| Release / version | |
| Build / commit | |
| Result (Approved / Rejected) | |
| Exceptions / known issues | |

Tester signature: ______________________________
