// server/runners/desktop-runner.js
// Desktop automation runner using PowerShell + Windows APIs
// Provides a driver-like API that test scripts can use
// Includes image OCR and template matching capabilities

const { exec } = require("child_process");
const path = require("path");
const os = require("os");
const fs = require("fs");
const { cropAndSave, ocrFromImage, findImageOnScreen, terminateWorker } = require("../utils/image-utils");

/**
 * Creates a desktop automation context that test scripts receive as `driver`.
 * Uses PowerShell under the hood for keyboard, mouse, and window operations.
 * @param {object} options
 * @param {object} options.context — mutable context object; the harness sets context.imagesDir per step
 */
function createDesktopDriver(options = {}) {
  const context = options.context || { imagesDir: null };
  
  function runPowerShell(script) {
    return new Promise((resolve, reject) => {
      const wrapped = `$ErrorActionPreference = 'Stop'; try { ${script} } catch { Write-Error $_; exit 1 }`;
      const encoded = Buffer.from(wrapped, "utf16le").toString("base64");
      exec(
        `powershell -NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand ${encoded}`,
        { timeout: 30000, maxBuffer: 10 * 1024 * 1024 },
        (err, stdout, stderr) => {
          if (err) {
            const msg = [
              `PowerShell exit ${err.code}`,
              stderr && `stderr: ${stderr.trim()}`,
              stdout && `stdout: ${stdout.trim()}`,
            ].filter(Boolean).join("\n");
            return reject(new Error(msg));
          }
          resolve(stdout.trim());
        }
      );
    });
  }

  // Resolve an image reference to an absolute path
  function resolveImagePath(ref) {
    if (path.isAbsolute(ref)) return ref;
    if (context.imagesDir) return path.join(context.imagesDir, ref);
    throw new Error(`Relative image path "${ref}" but no imagesDir configured. Use an absolute path or ensure your test has an images/ folder.`);
  }

  // Take a full-screen screenshot to a temp file and return its path
  async function takeTempScreenshot() {
    const tmpFile = path.join(os.tmpdir(), `marvin-screenshot-${Date.now()}.png`);
    await driver.screenshot(tmpFile);
    return tmpFile;
  }

  const driver = {
    // --- Keyboard ---
    async type(text) {
      const escaped = text
        .replace(/'/g, "''")
        .replace(/\+/g, "{+}")
        .replace(/\^/g, "{^}")
        .replace(/%/g, "{%}")
        .replace(/~/g, "{~}");
      await runPowerShell(
        `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${escaped}')`
      );
    },

    async keyPress(...keys) {
      const keyMap = {
        Enter: "{ENTER}", Tab: "{TAB}", Escape: "{ESC}", Backspace: "{BS}",
        Delete: "{DEL}", Up: "{UP}", Down: "{DOWN}", Left: "{LEFT}",
        Right: "{RIGHT}", Home: "{HOME}", End: "{END}",
        F1: "{F1}", F2: "{F2}", F3: "{F3}", F4: "{F4}",
        F5: "{F5}", F6: "{F6}", F7: "{F7}", F8: "{F8}",
        F9: "{F9}", F10: "{F10}", F11: "{F11}", F12: "{F12}",
      };

      let combo = "";
      for (const key of keys) {
        if (key === "Ctrl" || key === "Control") combo += "^";
        else if (key === "Alt") combo += "%";
        else if (key === "Shift") combo += "+";
        else if (key === "Win" || key === "Meta") {
          await runPowerShell(
            `$wsh = New-Object -ComObject WScript.Shell; $wsh.SendKeys('^{ESC}')`
          );
          continue;
        } else {
          combo += keyMap[key] || key;
        }
      }
      if (combo) {
        await runPowerShell(
          `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${combo}')`
        );
      }
    },

    async hotkey(modifier, key) {
      await driver.keyPress(modifier, key);
    },

    // --- Mouse ---
    async mouseMove(x, y) {
      await runPowerShell(
        `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${x}, ${y})`
      );
    },

    async mouseClick(x, y, button = "left") {
      const btnDown = button === "right" ? "0x0008" : "0x0002";
      const btnUp = button === "right" ? "0x0010" : "0x0004";
      await runPowerShell(`
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class MouseOps {
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, int dwExtraInfo);
}
"@
[MouseOps]::SetCursorPos(${x}, ${y});
Start-Sleep -Milliseconds 100;
[MouseOps]::mouse_event(${btnDown}, 0, 0, 0, 0);
[MouseOps]::mouse_event(${btnUp}, 0, 0, 0, 0);
`);
    },

    async doubleClick(x, y) {
      await driver.mouseClick(x, y);
      await driver.pause(100);
      await driver.mouseClick(x, y);
    },

    async tripleClick(x, y) {
      await driver.mouseClick(x, y);
      await driver.pause(80);
      await driver.mouseClick(x, y);
      await driver.pause(80);
      await driver.mouseClick(x, y);
    },

    // Click while holding Shift — used for range-selecting text from a prior click to (x, y).
    async shiftClick(x, y, button = "left") {
      const btnDown = button === "right" ? "0x0008" : "0x0002";
      const btnUp = button === "right" ? "0x0010" : "0x0004";
      // VK_SHIFT = 0x10, KEYEVENTF_KEYUP = 0x0002
      await runPowerShell(`
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class ShiftClickOps {
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, int dwExtraInfo);
    [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, int dwExtraInfo);
}
"@
[ShiftClickOps]::SetCursorPos(${x}, ${y});
Start-Sleep -Milliseconds 100;
[ShiftClickOps]::keybd_event(0x10, 0, 0, 0);
Start-Sleep -Milliseconds 50;
[ShiftClickOps]::mouse_event(${btnDown}, 0, 0, 0, 0);
[ShiftClickOps]::mouse_event(${btnUp}, 0, 0, 0, 0);
Start-Sleep -Milliseconds 50;
[ShiftClickOps]::keybd_event(0x10, 0, 0x0002, 0);
`);
    },

    // Atomic click + shift-click range selection. Both events fire in one PowerShell
// process so the cursor can't drift / revert between them.
async selectRange(x1, y1, x2, y2) {
  const output = await runPowerShell(`
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class RangeOps {
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
    [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, int dwExtraInfo);
    [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, int dwExtraInfo);
    [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
}
"@

function Move-AndVerify($x, $y) {
  for ($i = 0; $i -lt 5; $i++) {
    [RangeOps]::SetCursorPos($x, $y) | Out-Null
    Start-Sleep -Milliseconds 40
    $p = New-Object RangeOps+POINT
    [RangeOps]::GetCursorPos([ref]$p) | Out-Null
    if ([Math]::Abs($p.X - $x) -le 2 -and [Math]::Abs($p.Y - $y) -le 2) { return $true }
  }
  Write-Host "WARN: cursor did not settle at $x,$y — landed at $($p.X),$($p.Y)"
  return $false
}

# First click — caret at start
Move-AndVerify ${x1} ${y1} | Out-Null
Start-Sleep -Milliseconds 60
[RangeOps]::mouse_event(0x0002, 0, 0, 0, 0)
[RangeOps]::mouse_event(0x0004, 0, 0, 0, 0)
Start-Sleep -Milliseconds 250

# Shift-click — extend selection to end
Move-AndVerify ${x2} ${y2} | Out-Null
Start-Sleep -Milliseconds 60
[RangeOps]::keybd_event(0x10, 0, 0, 0)
Start-Sleep -Milliseconds 40
[RangeOps]::mouse_event(0x0002, 0, 0, 0, 0)
[RangeOps]::mouse_event(0x0004, 0, 0, 0, 0)
Start-Sleep -Milliseconds 60
[RangeOps]::keybd_event(0x10, 0, 0x0002, 0)
`);
  if (output) console.log(output);  // surfaces the WARN line if cursor didn't settle
    },

    // --- Window management ---
    async findWindow(titlePattern) {
      const result = await runPowerShell(
        `Get-Process | Where-Object {$_.MainWindowTitle -like '*${titlePattern}*'} | Select-Object -First 1 -ExpandProperty MainWindowHandle`
      );
      return result || null;
    },

    async focusWindow(titlePattern) {
      await runPowerShell(`
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinFocus {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@
$proc = Get-Process | Where-Object {$_.MainWindowTitle -like '*${titlePattern}*'} | Select-Object -First 1;
if ($proc) {
    [WinFocus]::ShowWindow($proc.MainWindowHandle, 9);
    [WinFocus]::SetForegroundWindow($proc.MainWindowHandle);
}
`);
    },

    // Maximise a window matched by title (substring match on MainWindowTitle),
    // or the current foreground window if no titlePattern is given.
    async maximizeWindow(titlePattern) {
      const lookup = titlePattern
        ? `$proc = Get-Process | Where-Object {$_.MainWindowTitle -like '*${titlePattern}*'} | Select-Object -First 1; if ($proc) { $h = $proc.MainWindowHandle; [WinMax]::SetForegroundWindow($h); [WinMax]::ShowWindow($h, 3) | Out-Null }`
        : `$h = [WinMax]::GetForegroundWindow(); [WinMax]::ShowWindow($h, 3) | Out-Null`;
      await runPowerShell(`
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinMax {
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}
"@
${lookup}
`);
    },

    async getWindowTitle() {
      return await runPowerShell(
        `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class WinTitle { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder text, int count); }'; $sb = New-Object System.Text.StringBuilder 256; [WinTitle]::GetWindowText([WinTitle]::GetForegroundWindow(), $sb, 256) | Out-Null; $sb.ToString()`
      );
    },

    // --- Application lifecycle ---
    async launch(exePath, args = "") {
      await runPowerShell(`Start-Process '${exePath}' ${args ? `'${args}'` : ""}`);
      await driver.pause(2000);
    },

    async closeWindow() {
      await driver.keyPress("Alt", "F4");
    },

    // --- Utilities ---
    async pause(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    },
    
    async screenshot(outputPath) {
      await runPowerShell(`
Add-Type -AssemblyName System.Windows.Forms;
Add-Type -AssemblyName System.Drawing;
$screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds;
$bitmap = New-Object System.Drawing.Bitmap($screen.Width, $screen.Height);
$graphics = [System.Drawing.Graphics]::FromImage($bitmap);
try {
  $graphics.CopyFromScreen(0, 0, 0, 0, $bitmap.Size);
  $bitmap.Save('${outputPath}');
} finally {
  $graphics.Dispose();
  $bitmap.Dispose();
}
`);
    },

    // --- Image: Screenshot region ---
    async screenshotRegion(outputPath, region) {
      const tmpFile = await takeTempScreenshot();
      try {
        await cropAndSave(tmpFile, region, outputPath);
      } finally {
        try { fs.unlinkSync(tmpFile); } catch {}
      }
      return outputPath;
    },

    // --- Image: OCR (read text from screen) ---
    async readText(region, options = {}) {
      const tmpFile = await takeTempScreenshot();
      try {
        let imageInput = tmpFile;
        if (region) {
          const croppedPath = tmpFile + ".crop.png";
          await cropAndSave(tmpFile, region, croppedPath);
          imageInput = croppedPath;
        }
        const result = await ocrFromImage(imageInput, options);
        // Clean up cropped file
        if (region) {
          try { fs.unlinkSync(imageInput); } catch {}
        }
        return result;
      } finally {
        try { fs.unlinkSync(tmpFile); } catch {}
      }
    },

    // --- Image: Find reference image on screen ---
    async findImage(referenceImage, options = {}) {
      const needlePath = resolveImagePath(referenceImage);
      if (!fs.existsSync(needlePath)) {
        throw new Error(`Reference image not found: ${needlePath}`);
      }
      const tmpFile = await takeTempScreenshot();
      try {
        return await findImageOnScreen(tmpFile, needlePath, options);
      } finally {
        try { fs.unlinkSync(tmpFile); } catch {}
      }
    },

    // --- Image: Wait for image to appear on screen ---
    async waitForImage(referenceImage, options = {}) {
      const timeout = options.timeout || 10000;
      const interval = options.interval || 1000;
      const start = Date.now();

      while (Date.now() - start < timeout) {
        const match = await driver.findImage(referenceImage, options);
        if (match.found) return match;
        await driver.pause(interval);
      }

      throw new Error(`Image "${referenceImage}" not found on screen within ${timeout}ms`);
    },

    // --- Image: Find image and click its center ---
    async clickImage(referenceImage, options = {}) {
      const match = await driver.findImage(referenceImage, options);
      if (!match.found) {
        throw new Error(`Image "${referenceImage}" not found on screen (confidence: ${match.confidence?.toFixed(2)})`);
      }
      const clickX = match.centerX + (options.offsetX || 0);
      const clickY = match.centerY + (options.offsetY || 0);
      await driver.mouseClick(clickX, clickY, options.button || "left");
      return match;
    },

    // --- Image: Wait for text to appear on screen ---
    async waitForText(expectedText, region, options = {}) {
      const timeout = options.timeout || 10000;
      const interval = options.interval || 1000;
      const exact = options.exact || false;
      const start = Date.now();

      while (Date.now() - start < timeout) {
        const result = await driver.readText(region, options);
        const found = exact
          ? result.text === expectedText
          : result.text.toLowerCase().includes(expectedText.toLowerCase());
        if (found) return result;
        await driver.pause(interval);
      }

      throw new Error(`Text "${expectedText}" not found on screen within ${timeout}ms`);
    },

    // --- Cleanup ---
    async quit() {
      await terminateWorker();
    },

    async deleteSession() {
      await terminateWorker();
    },
  };

  return driver;
}

module.exports = { createDesktopDriver };
