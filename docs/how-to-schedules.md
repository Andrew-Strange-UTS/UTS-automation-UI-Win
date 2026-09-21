---
title: "How to: Schedules"
nav_order: 6
---

# How to schedule tests

A schedule runs a saved test sequence automatically on a timetable (for example
every weekday at 09:00), even when the Marvin window is closed. Schedules are run
by the **scheduler service** and are **shared across everyone** on the machine.

## Before you start: the scheduler service must be running

Schedules are stored and executed by the Marvin **scheduler service**, not by the
app window. If it is not installed, the Schedules screen has nothing to talk to
and no schedules appear. See
[Installing on a VM](installing-on-a-vm.html#install-the-scheduler-service) for
how to install it. Marvin also tries to start it automatically if it finds it
stopped.

## Create a schedule

1. Build the run sequence you want to schedule (add the tests, set parameters and
   Zephyr keys as usual).
2. In the **Scheduled Sequences** panel click **+ New Schedule**.
3. Set a **name**, a **time** (24-hour `HH:MM`), and the **days** it should run.
4. Optionally set notifications and Zephyr identity (below).
5. Save. The schedule appears in the list and will fire at the next matching time.

Each schedule carries its own copy of the test code and the secrets it needs, so
it still runs for users whose local repo does not contain that test, and it runs
once no matter how many people are logged in.

## Manage a schedule

Each schedule in the list has actions:

- **Run Now**: run it immediately, the same as a manual run.
- **Pause / Resume**: stop or restart it firing on schedule.
- **Edit**: change name, time, days, notifications, and Zephyr identity.
- **Logs**: show the last run's log.
- **Delete**: remove it (with a confirmation).

## Notifications

When creating or editing a schedule you can add:

- **ntfy**: a topic name (and an optional custom ntfy server). A notification
  with the run result is sent to that topic on every run.
- **Microsoft Teams**: two webhook URLs, one for **all results** (posted every
  run) and one for **failures only** (posted with logs when a run fails).

## Zephyr reporting from a schedule

Set the schedule's **Executed by** name and **Atlassian account ID** so scheduled
executions are attributed to the right person in Zephyr. The Zephyr keys come
from the test cards in the sequence, exactly as in a manual run. See
[How to: Zephyr reporting](how-to-zephyr.html).

## Share a schedule with another machine (export / import)

- **Export**: click **Export** on a schedule, set a password, and save the
  `.utsb` file. It is an encrypted bundle of the schedule, its test code, images,
  and secrets.
- **Import**: click **Import Schedule**, choose the `.utsb` file, and enter the
  password. The schedule is recreated on this machine.

## Who can see schedules

On a shared machine, **all users see and can edit the same schedules** (they are
stored machine-wide by the service). The secrets bundled into a schedule are
encrypted at rest. Note that any local user can export a schedule and re-import
it to recover its secrets, so only run the shared scheduler where everyone is
trusted with each other's secrets.

## Troubleshooting

Marvin tells these apart, so read which message you actually got.

- **"Scheduler service is not running."** The service could not be reached at
  all. Install or start it (see the link above). On a managed machine a standard
  user may not be able to start it; ask an administrator to start the **Marvin
  Scheduler** service.
- **"The scheduler service returned a response Marvin could not read."** The
  service is running but failed while handling the request. The `Detail` line in
  the dialog carries the real error. The most common one is a permissions
  problem on `C:\ProgramData\uts-automation`, which the startup check also
  reports.
- **"Marvin could not prepare the test ... for scheduling."** This failed inside
  Marvin before the service was contacted, so the service is not the problem.
  Check the named test's folder and its `images` directory are readable.
- **The startup check shows the scheduler amber or red with a repair command.**
  The service is running but cannot read or write its data directory, so it can
  neither list your schedules nor save a new one. Restarting it will not help.
  Run the command shown from an elevated prompt, then restart the service.
- **A schedule did not fire.** Check it is not **Paused**, that the time and days
  are correct, and that the machine was on at that time.

## Scheduled desktop tests need an automation account

A scheduled **web** test needs nothing beyond the service. A scheduled
**desktop** test needs a desktop, and the service does not have one: it runs as
LocalSystem in Session 0, which has no interactive desktop. A desktop step run
from there fails with `Access is denied` on every keystroke and
`The handle is invalid` on every screenshot, while the same sequence passes from
Run Sequence, which runs in your own session.

So desktop schedules run in a dedicated account's session, which stays signed in
so that 3am runs have a desktop to use. Set it up once per machine: see
[Installing on a VM](installing-on-a-vm.html#set-up-the-automation-account-scheduled-desktop-tests-only).

Marvin's startup checks show a **Desktop Session** row. It goes green only when
Marvin can open that session's input desktop, which it proves by starting a
process in the session rather than assuming it from the account existing. If the
row is red it names the reason: nobody signed in, the session is locked, a
different account is signed in, or the token could not be taken.

Until that account exists, a desktop schedule refuses to run and says so in its
run log, rather than running in Session 0 and failing every step.
