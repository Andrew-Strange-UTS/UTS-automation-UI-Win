---
title: Example Tests
nav_order: 3
---

# Example Tests

A ready-made set of worked examples lives in a public repo:
[**github.com/Perpaterb/win-marvin-tests**](https://github.com/Perpaterb/win-marvin-tests).
It is eight focused tests, each showing off one Marvin capability against a
built-in Windows app (Calculator, Notepad, Explorer, Paint).

## Use it

1. In Marvin, paste the repo URL into **Enter GitHub Repo URL** and click
   **Refresh Tests**:

   ```
   https://github.com/Perpaterb/win-marvin-tests
   ```

2. Each subfolder under the repo's `tests/` folder becomes a test card.
3. Add a card to the run sequence and click **Run Sequence**.

These are Windows desktop tests, so run them in **Desktop mode** on Windows.

## The tests

| # | Test | What it shows | App |
|---|------|---------------|-----|
| 00 | Calculator, Control Discovery | `findControl` probe that lists control names / IDs | Calculator |
| 01 | Notepad, Keyboard, Hotkeys & Clipboard | `type`, `keyPress`, `hotkey`, `setClipboard`, `getClipboard` | Notepad |
| 02 | Calculator, UI Automation Controls | `findControl`, `clickControl`, `getControlText` (no coordinates) | Calculator |
| 03 | Notepad, Mouse Gestures | `doubleClick`, `tripleClick`, `mouseClick`, `shiftClick`, `drag` | Notepad |
| 04 | Explorer, Window Management & Screenshots | `findWindow`, `focusWindow`, `maximizeWindow`, `getWindowTitle`, `screenshot` | Explorer |
| 05 | Calculator, OCR | `readText`, `waitForText` | Calculator |
| 06 | Paint, Image Recognition | `waitForImage`, `clickImage`, `findImage` | Paint |
| 07 | Notepad, Parameters & Secrets | `parameters.*`, secret injection with `${{ secrets.NAME }}` | Notepad |

## Setup notes

**Suggested order.** Start with 00, 02 and 05 (most reliable), then 01 and 04,
add 07 once secrets are set up, and finish with 03 and 06.

**Control identifiers (tests 00 and 02).** Calculator's control names vary by
Windows version. Run **test 00** first to see which controls exist on your
machine, then adjust **test 02** to match.

**Secrets (test 07).** Add a secret named `DEMO_SECRET` in the Secrets Manager
for the full run. The test still runs without it, it just skips that part.

**Screenshots (test 04).** Output goes to the current directory by default; set
the `SCREENSHOT_DIR` parameter to change it.

## Image recognition needs matching resolution (test 06)

Test 06 matches reference PNGs against the live screen. Image matching is
**fixed-scale**: it does not resize the reference looking for a match. A
reference captured on a screen at one resolution or Windows display-scaling
setting **will not match** the same element rendered at another. This is the
most common reason image tests fail.

So for test 06:

- Capture the three reference images **on the machine the test will run on**, at
  the resolution and scaling it runs at. A reference grabbed on your laptop will
  not match on a VM with a different resolution.
- Watch **Windows display scaling** (100% vs 150% changes the pixel size of the
  same button), and keep the VM's resolution stable (some Citrix / RDP sessions
  resize to fit the client window).
- See `tests/06-Paint-Image-Recognition/images/README.txt` in the repo for the
  exact images and filenames to capture.

When a match fails, the run log reports the resolution it observed and the
reference size, so a mismatch is obvious. Full detail is on the
[Creating Tests](creating-tests.html#reference-images-must-match-the-target-screen-resolution)
page.

## Write your own

Ready to author your own tests? See [Creating Tests](creating-tests.html) for
the full driver API, parameters and secrets, Zephyr reporting, and a
copy-pasteable AI prompt that builds a test for you.
