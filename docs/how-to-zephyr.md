---
title: "How to: Zephyr reporting"
nav_order: 5
---

# How to connect to Zephyr Scale

Marvin can post each test's result to a **Zephyr Scale Cloud** test cycle
automatically after a run. This page sets that up.

Results are sent to `api.zephyrscale.smartbear.com` using your Zephyr API token,
so this is for **Zephyr Scale Cloud**.

## What you need

- A Zephyr Scale Cloud project, with test **cases** and a test **cycle** to
  report into.
- A Zephyr Scale **API access token**.
- Optionally, your **Atlassian account ID**, to fill Zephyr's native "Executed
  by" and "Assigned to" fields.

## Step 1: add your Zephyr API token as a secret

1. In Zephyr Scale, generate an **API access token** (in Zephyr's settings /
   API access tokens).
2. In Marvin, click **Open Secrets**, set **`ZEPHYR_API_TOKEN`** to that token,
   and Save.

See [How to: Secrets](how-to-secrets.html) if you need help with the Secrets
Manager.

## Step 2: fill the Zephyr keys on the test card

Each test card has three Zephyr fields. Reporting only happens when **all three**
are set:

| Field | Example | What it is |
|---|---|---|
| **Project Key** | `EPEA` | Your Zephyr/Jira project key (defaults to `EPEA`) |
| **Case Key** | `EPEA-T123` | The test case to record the result against |
| **Cycle Key** | `EPEA-R45` | The test cycle (run) to report into |

You find the Case and Cycle keys in Zephyr Scale on the test case and test cycle.

## Step 3 (optional): set who ran the test

At the top of the main screen:

- **Tester name (for Zephyr reporting)**: when set and no Atlassian ID is given,
  Marvin adds an `Executed by: <name>` line to the execution comment.
- **Atlassian account ID (for Zephyr reporting)**: when set, Marvin fills
  Zephyr's native **Executed by** and **Assigned to** fields with that account.
  Find the ID in your Atlassian profile URL.

## Step 4: run and check Zephyr

Add the test to the run sequence and click **Run Sequence**. After it finishes,
open the test cycle in Zephyr Scale: a new execution appears against the case,
marked **Pass** or **Fail**.

## Reporting step-by-step results

Inside your test, call `zephyrLog()` to record individual step results, which
show up under the execution:

```js
zephyrLog("Navigated to the login page.", "Pass");
zephyrLog("FAIL: Login button not found.", "Fail");
```

The overall execution is **Pass** if every step passes, or **Fail** if any step
fails or the test throws.

## Reporting from a schedule

A scheduled run reports to Zephyr the same way. Set the schedule's **Executed by**
name and **Atlassian account ID** when creating or editing it, so scheduled
executions are attributed correctly. See [How to: Schedules](how-to-schedules.html).

## Troubleshooting

- **Nothing was posted.** Check that all three keys (Project, Case, Cycle) are
  filled on the card and that `ZEPHYR_API_TOKEN` is set. A missing Cycle Key
  skips reporting.
- **Key format warnings on Dry Run.** Case keys look like `EPEA-T123` and cycle
  keys like `EPEA-R45`. A Dry Run flags malformed keys before you run.
- **Wrong "Executed by".** With no Atlassian account ID, the name goes into the
  comment only; set the account ID to populate the native fields.
