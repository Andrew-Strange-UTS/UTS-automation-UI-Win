---
title: "How to: Secrets"
nav_order: 4
---

# How to use Secrets

Secrets are named values (API tokens, passwords, usernames) that your tests use
without the value ever appearing in the test code, the repo, or the logs. Marvin
stores them **encrypted, per user**, on the machine.

## Open the Secrets Manager

On the main screen click **Open Secrets**. You will see three default secrets,
created blank on first run:

| Secret | Used for |
|---|---|
| `ZEPHYR_API_TOKEN` | Reporting results to Zephyr Scale (see [How to: Zephyr reporting](how-to-zephyr.html)) |
| `GITHUB_USERNAME` | Cloning a private test repo |
| `GITHUB_PERSONAL_ACCESS_TOKEN` | Cloning a private test repo |

## Add a secret

1. Click **Open Secrets**.
2. Enter a **name** (for example `DEMO_SECRET`) and its **value**.
3. Click **Save**.

The value is masked immediately and is never shown again after entry. To see or
change it, edit it (below).

## Edit or delete a secret

- **Edit:** change the value next to the secret and save. The field stays masked.
- **Delete:** click delete next to the secret and confirm.

## Use a secret in a test

Every secret is injected into your test's `parameters` object by its name, so a
test just reads it:

```js
module.exports = async function (driver, parameters, zephyrLog) {
  const token = parameters.DEMO_SECRET; // the value from the Secrets Manager
  // ...
};
```

You can also reference a secret inside a parameter's default value using the
`${{ secrets.NAME }}` syntax:

```
${{ secrets.DEMO_SECRET }}
```

If a test card references a secret that does not exist, the card shows a
**warning badge**, and a [Dry Run](feature-uat.html) flags it as well.

## Where secrets are stored, and who can see them

- Secrets live in your **own** `%APPDATA%\Marvin` on the machine, encrypted with
  AES-256-GCM. Another user on the same machine cannot read your secrets.
- Secrets are **never printed** in the run log.
- When you create a **schedule**, the secrets it needs are bundled into it so the
  scheduler service can run it when you are not logged in. Those bundled secrets
  are encrypted at rest in the shared scheduler directory. See
  [How to: Schedules](how-to-schedules.html) for the sharing details.

## Tips

- Give secrets clear, uppercase names (`ZEPHYR_API_TOKEN`, `MY_API_KEY`).
- Set `ZEPHYR_API_TOKEN`, `GITHUB_USERNAME`, and `GITHUB_PERSONAL_ACCESS_TOKEN`
  before using Zephyr reporting or private repos.
- Rotate a secret by editing its value; tests pick up the new value on the next
  run.
