// server/runners/desktop-runner.js
// Desktop automation runner using PowerShell + Windows APIs
// Provides a driver-like API that test scripts can use

const { exec, spawn } = require("child_process");
const path = require("path");

/**
 * Creates a desktop automation context that test scripts receive as `driver`.
 * Uses PowerShell under the hood for keyboard, mouse, and window operations.
 */
function createDesktopDriver() {
  function runPowerShell(script) {
    return new Promise((resolve, reject) => {
      exec(
        `powershell -NoProfile -NonInteractive -Command "${script.replace(/"/g, '\\"')}"`,
        { timeout: 30000 },
        (err, stdout, stderr) => {
          if (err) return reject(new Error(stderr || err.message));
          resolve(stdout.trim());
        }
      );
    });
  }

  const driver = {
    // --- Keyboard ---
    async type(text) {
      // Use .NET SendKeys for typing text
      const escaped = text
        .replace(/\\/g, "\\\\")
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
      // Map common key names to SendKeys format
      const keyMap = {
        Enter: "{ENTER}",
        Tab: "{TAB}",
        Escape: "{ESC}",
        Backspace: "{BS}",
        Delete: "{DEL}",
        Up: "{UP}",
        Down: "{DOWN}",
        Left: "{LEFT}",
        Right: "{RIGHT}",
        Home: "{HOME}",
        End: "{END}",
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
          // Win key needs special handling — use PowerShell WScript
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
      // Shortcut for common combos like hotkey("Ctrl", "a")
      await driver.keyPress(modifier, key);
    },

    // --- Mouse ---
    async mouseMove(x, y) {
      await runPowerShell(
        `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${x}, ${y})`
      );
    },

    async mouseClick(x, y, button = "left") {
      // Move then click using Win32 API
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

    async getWindowTitle() {
      return await runPowerShell(
        `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class WinTitle { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder text, int count); }'; $sb = New-Object System.Text.StringBuilder 256; [WinTitle]::GetWindowText([WinTitle]::GetForegroundWindow(), $sb, 256) | Out-Null; $sb.ToString()`
      );
    },

    // --- Application lifecycle ---
    async launch(exePath, args = "") {
      await runPowerShell(`Start-Process '${exePath}' ${args ? `'${args}'` : ""}`);
      await driver.pause(2000); // Wait for app to start
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
$graphics.CopyFromScreen(0, 0, 0, 0, $bitmap.Size);
$bitmap.Save('${outputPath.replace(/\\/g, "\\\\")}');
$graphics.Dispose();
$bitmap.Dispose();
`);
    },

    // --- Cleanup ---
    async quit() {
      // No persistent session to clean up
    },

    async deleteSession() {
      // Compatibility with Appium-style teardown
    },
  };

  return driver;
}

module.exports = { createDesktopDriver };
