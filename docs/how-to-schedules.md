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

- **"Scheduler service is not running."** Install or start the service (see the
  link above). On a managed machine a standard user may not be able to start it;
  ask an administrator to start the **Marvin Scheduler** service.
- **A schedule did not fire.** Check it is not **Paused**, that the time and days
  are correct, and that the machine was on at that time.
