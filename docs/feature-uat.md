---
title: "Feature Walkthrough (UAT)"
nav_exclude: true
search_exclude: true
---

# Marvin: Feature Walkthrough (UAT)

This is a plain-language walkthrough for confirming that **every function the
Marvin UI offers actually works**. Work top to bottom and mark each row Pass or
Fail. It exercises what a user *does*: adding secrets, pulling tests from a repo,
building a test with AI, running it, pushing results to Zephyr, scheduling, and
so on.

This is **not** an installation guide (see [Installing on a VM](installing-on-a-vm.html))
and it is not the detailed technical checklist (see the
[Web mode](acceptance-web.html) and [Desktop mode](acceptance-desktop.html)
acceptance pages). It is the "click everything and confirm it works" pass.

## What you will need

Have these ready so you can exercise every function:

- Marvin installed and launched (or `npm run dev`).
- A **public** GitHub repo with a `tests/` folder (for example
  `https://github.com/Perpaterb/win-marvin-tests`), and a **private** repo for
  the token path.
- A GitHub **username** and a **Personal Access Token** (repo scope).
- A **Zephyr Scale API token**, plus a **Project Key**, **Case Key**, and
  **Cycle Key** for a throwaway test cycle.
- Your **Atlassian account ID** (from your Atlassian profile URL).
- Optional: an **ntfy** topic and a **Microsoft Teams** incoming webhook URL.
- An **AI assistant** (Claude, ChatGPT, etc.) for the "build a test with AI" step.
- On Windows, **Notepad**, **Calculator**, and **Paint** for the built-in
  desktop tests.

---

## 1. Access the documentation

| Step | Expected result | Pass/Fail | Notes |
|---|---|---|---|
| Open the Marvin documentation site (this site) in a browser. | The docs load: Home, Creating Tests, Example Tests, and the install/UAT pages are all reachable. | | |
| Open **Creating Tests** and scroll to the driver API and the AI prompt. | The page shows the web and desktop driver methods and a copy-pasteable AI prompt. | | |

## 2. Startup and diagnostics

| Step | Expected result | Pass/Fail | Notes |
|---|---|---|---|
| Launch Marvin. | A splash appears, then a diagnostics screen before the main dashboard. | | |
| Review the diagnostics checks. | Node, OS, Git, Chrome, ChromeDriver, PowerShell, and Scheduler each show a pass/warn/fail badge. | | |
| Click **Continue**. | The main dashboard opens, with the Marvin title and logo at the top. | | |

## 3. Desktop / Web mode toggle

| Step | Expected result | Pass/Fail | Notes |
|---|---|---|---|
| Click **Web Tests**, then **Desktop Tests**. | The mode switches; test cards show web options (OKTA, Visual Browser) in Web mode and hide them in Desktop mode. | | |
| Switch mode with a non-empty run sequence. | You are prompted to confirm, and the sequence clears on confirm. | | |
| Restart Marvin. | The last selected mode is remembered. | | |

## 4. Zephyr identity fields

| Step | Expected result | Pass/Fail | Notes |
|---|---|---|---|
| Enter a name in **Tester name (for Zephyr reporting)**. | The value is accepted and persists across restarts. | | |
| Enter your ID in **Atlassian account ID (for Zephyr reporting)**. | The value is accepted and persists across restarts. | | |

## 5. Secrets

| Step | Expected result | Pass/Fail | Notes |
|---|---|---|---|
| Click **Open Secrets**. | The Secrets panel opens showing the default secrets (ZEPHYR_API_TOKEN, GITHUB_PERSONAL_ACCESS_TOKEN, GITHUB_USERNAME) with blank/masked values. | | |
| Add a new secret (name + value), click **Save**. | It is added and its value is masked, never shown in plain text. | | |
| Edit an existing secret's value and save. | The new value is stored; the field stays masked. | | |
| Delete a secret. | You are asked to confirm, and it is removed. | | |
| Set **ZEPHYR_API_TOKEN**, **GITHUB_USERNAME**, and **GITHUB_PERSONAL_ACCESS_TOKEN** to real values. | Saved, for the repo and Zephyr steps below. | | |

## 6. Pull tests from a repo

| Step | Expected result | Pass/Fail | Notes |
|---|---|---|---|
| Paste a **public** repo URL and click **Refresh Tests**. | The tests under the repo's `tests/` folder appear as test cards. | | |
| Click the **private repo** help (PAT) button. | A popup explains how to create a GitHub token, with the steps image. | | |
| Tick **private repo**, set GITHUB_USERNAME and GITHUB_PERSONAL_ACCESS_TOKEN as secrets, paste a private repo URL, and Refresh Tests. | The private repo clones and its tests appear. | | |
| Refresh Tests again while a test folder is in use. | It refreshes without an EBUSY error. | | |

## 7. Build a test with AI

| Step | Expected result | Pass/Fail | Notes |
|---|---|---|---|
| Open **Creating Tests** in the docs and copy the AI prompt. | The prompt copies cleanly. | | |
| Paste it into your AI assistant with a description of a test you want, and get back a `run.js`. | The AI returns a `run.js` following the documented format. | | |
| Put it in your test repo as `tests/<name>/run.js`, push, then **Refresh Tests** in Marvin. | The new test appears as a card and can be added to a sequence. | | |

## 8. Configure a test card

| Step | Expected result | Pass/Fail | Notes |
|---|---|---|---|
| Add a test to the run sequence. | It appears in the Run Sequence sidebar. | | |
| Fill in any **parameters** on the card. | Values are retained. | | |
| Reference a secret in a parameter (`${{ secrets.NAME }}`) that does not exist. | The card shows a warning badge for the undefined secret. | | |
| Enter **Zephyr** Project/Case/Cycle keys on the card. | Accepted; malformed keys are flagged on dry run (below). | | |
| In Web mode, set an **OKTA environment** and toggle **Visual Browser**. | Both options are available on web test cards. | | |

## 9. Dry run (validate without executing)

| Step | Expected result | Pass/Fail | Notes |
|---|---|---|---|
| With a configured sequence, click **Dry Run (validate only)**. | A report shows PASS/WARN/FAIL per test: empty required parameters, missing secret references, and bad Zephyr key formats are flagged. No test actually runs. | | |

## 10. Run a sequence

| Step | Expected result | Pass/Fail | Notes |
|---|---|---|---|
| In Desktop mode, add a built-in test (for example the Notepad showcase) and click **Run Sequence**. | The test runs, live log output streams into the panel, and it finishes with a pass/fail summary. | | |
| In Web mode, add a web test and Run Sequence. | Chrome launches (visible if Visual Browser is on), the test runs, results stream in. | | |
| Run a sequence of two or more tests. | They run in order and each reports its own result. | | |

## 11. Stop a run

| Step | Expected result | Pass/Fail | Notes |
|---|---|---|---|
| Start a longer run, then click the red **Stop** button. | The run halts within a couple of seconds and the log ends with **=== Stopped by user ===**. | | |
| After stopping, start another run. | The UI is back to idle and a new run starts normally. | | |

## 12. Logs and failure screenshots

| Step | Expected result | Pass/Fail | Notes |
|---|---|---|---|
| Click **Show Server-side Test Logs**. | The server-side run log is shown. | | |
| Click the **Marvin logs** button. | Marvin's own (app) log output is shown. | | |
| Run a test that fails on screen. | A failure screenshot is captured and shown inline in the log. | | |

## 13. Zephyr reporting

| Step | Expected result | Pass/Fail | Notes |
|---|---|---|---|
| Run a test with valid Zephyr keys and a set ZEPHYR_API_TOKEN. | A result is posted to the Zephyr Scale test cycle. | | |
| Set only **Tester name** (no Atlassian ID) and run. | The execution comment in Zephyr includes `Executed by: <name>`. | | |
| Set a valid **Atlassian account ID** and run. | Zephyr's native **Executed by** and **Assigned to** fields are populated from the account ID. | | |

## 14. Create and manage schedules

| Step | Expected result | Pass/Fail | Notes |
|---|---|---|---|
| Click **+ New Schedule**, set a name, time, and days from the current sequence, and save. | The schedule appears in the Scheduled Sequences list. | | |
| Click **Run Now** on a schedule. | It executes immediately, the same as a manual run. | | |
| **Pause** then **Resume** a schedule. | Its status changes accordingly and it stops/starts firing on schedule. | | |
| **Edit** a schedule (name, time, days, notifications, Zephyr identity). | Changes are saved. | | |
| Toggle a schedule's **Logs**. | The last run's log is shown. | | |
| **Delete** a schedule. | You confirm, and it is removed. | | |
| Confirm a schedule created by one user is visible to another user on the same machine. | Schedules are shared across users. | | |

## 15. Notifications

| Step | Expected result | Pass/Fail | Notes |
|---|---|---|---|
| On a schedule, set an **ntfy** topic (and optional server) and let it run. | An ntfy notification with the run result is delivered. | | |
| Set a **Teams webhook (all results)** and a **Teams webhook (failures only)**. | Every run posts to the all-results webhook; a failing run also posts to the failures webhook, including logs. | | |

## 16. Export and import a schedule

| Step | Expected result | Pass/Fail | Notes |
|---|---|---|---|
| Click **Export** on a schedule, set a password, and save the `.utsb` file. | An encrypted `.utsb` bundle is downloaded. | | |
| Click **Import Schedule**, choose the `.utsb`, and enter the password. | The schedule, its test code, images, and secrets are restored and it appears in the list. | | |
| Try importing with the wrong password. | Import fails cleanly with an error, not a crash. | | |

---

## Sign-off

| | |
|---|---|
| Tester | |
| Build / version | |
| Date (DD MMM YYYY) | |
| Overall result | |
| Notes | |
