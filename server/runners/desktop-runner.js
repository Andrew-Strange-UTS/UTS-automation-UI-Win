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

  // Default folder that screenshots are saved into, one folder per test:
  //   C:\marvin screen shots\<test name>   (Windows)
  // Overridable via context.screenshotsDir. On non-Windows hosts a home-dir
  // fallback is used so dev/test runs still work.
  function getScreenshotsDir() {
    if (context.screenshotsDir) return context.screenshotsDir;
    const root = process.platform === "win32"
      ? "C:\\marvin screen shots"
      : path.join(os.homedir() || os.tmpdir(), "marvin screen shots");
    return path.join(root, context.testName || "unnamed-test");
  }

  // Decide where a screenshot is written. An absolute path is honored as-is
  // (used internally for temp and failure captures). A relative path or bare
  // filename lands in the default per-test folder; omitting it generates a
  // timestamped name. The destination directory is created if missing.
  function resolveScreenshotPath(outputPath) {
    let target;
    if (outputPath && path.isAbsolute(outputPath)) {
      target = outputPath;
    } else {
      const name = outputPath ? path.basename(outputPath) : `screenshot-${Date.now()}.png`;
      target = path.join(getScreenshotsDir(), name);
    }
    try { fs.mkdirSync(path.dirname(target), { recursive: true }); } catch {}
    return target;
  }

  // Escape a path for embedding inside a PowerShell single-quoted string
  // (only single quotes need doubling; backslashes are literal there).
  function psPath(p) {
    return String(p).replace(/'/g, "''");
  }

  // Take a full-screen screenshot to a temp file and return its path
  async function takeTempScreenshot() {
    const tmpFile = path.join(os.tmpdir(), `marvin-screenshot-${Date.now()}.png`);
    await driver.screenshot(tmpFile);
    return tmpFile;
  }

  // Double single quotes so a value can be embedded safely inside a
  // PowerShell single-quoted string literal.
  function psEscape(value) {
    return String(value).replace(/'/g, "''");
  }

  // Resolve a window's bounding rectangle (screen coordinates) by partial
  // MainWindowTitle match, via the Win32 GetWindowRect P/Invoke. Returns
  // { x, y, width, height }. Throws if the window is not found.
  async function getWindowRect(titlePattern) {
    const escaped = psEscape(titlePattern);
    const result = await runPowerShell(`
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinRectOps {
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
}
"@
$proc = Get-Process | Where-Object {$_.MainWindowTitle -like '*${escaped}*'} | Select-Object -First 1;
if ($null -eq $proc) { throw "Window matching '${escaped}' not found" }
$rect = New-Object WinRectOps+RECT;
[WinRectOps]::GetWindowRect($proc.MainWindowHandle, [ref]$rect) | Out-Null;
Write-Output ("{0},{1},{2},{3}" -f $rect.Left, $rect.Top, ($rect.Right - $rect.Left), ($rect.Bottom - $rect.Top))
`);
    const parts = String(result).trim().split(",").map((n) => parseInt(n, 10));
    if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) {
      throw new Error(`Could not determine window rectangle for "${titlePattern}"`);
    }
    return { x: parts[0], y: parts[1], width: parts[2], height: parts[3] };
  }

  // Build a UIAutomation PowerShell script that resolves a root element (a
  // window matched by partial title, or the whole desktop if no title) then
  // FindFirst's a control via the supplied locator. The actionLines snippet
  // runs with $element bound to the located AutomationElement. The locator can
  // match on Name, ClassName, and/or AutomationId. Because live COM handles
  // cannot cross the PowerShell process boundary, callers re-find the element
  // inside each invocation by passing the same locator.
  function buildControlScript(windowTitle, locator = {}, actionLines = "") {
    const conds = [];
    if (locator.name != null) {
      conds.push(`New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, '${psEscape(locator.name)}')`);
    }
    if (locator.className != null) {
      conds.push(`New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ClassNameProperty, '${psEscape(locator.className)}')`);
    }
    if (locator.controlId != null) {
      conds.push(`New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty, '${psEscape(locator.controlId)}')`);
    }
    if (conds.length === 0) {
      throw new Error("Control locator must specify at least one of: name, className, controlId");
    }
    const condExpr = conds.length === 1
      ? `$cond = ${conds[0]};`
      : `$cond = New-Object System.Windows.Automation.AndCondition(@(${conds.join(", ")}));`;

    let rootResolve;
    if (windowTitle) {
      const wt = psEscape(windowTitle);
      rootResolve = `
$desktop = [System.Windows.Automation.AutomationElement]::RootElement;
$winCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Window);
$wins = $desktop.FindAll([System.Windows.Automation.TreeScope]::Children, $winCond);
$root = $null;
foreach ($w in $wins) { if ($w.Current.Name -like '*${wt}*') { $root = $w; break } }
if ($null -eq $root) { throw "Window matching '${wt}' not found" }`;
    } else {
      rootResolve = `$root = [System.Windows.Automation.AutomationElement]::RootElement;`;
    }

    return `
Add-Type -AssemblyName UIAutomationClient;
Add-Type -AssemblyName UIAutomationTypes;
${rootResolve}
${condExpr}
$element = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond);
if ($null -eq $element) { throw "Control not found" }
${actionLines}
`;
  }

  // Run a UIAutomation control action, re-throwing PowerShell failures as a
  // descriptive JS error that names the window and locator.
  async function runControlAction(windowTitle, locator, actionLines, verb) {
    const script = buildControlScript(windowTitle, locator, actionLines);
    try {
      return await runPowerShell(script);
    } catch (err) {
      throw new Error(`Control ${verb} failed: control not found or not actionable (window: "${windowTitle || "foreground"}", locator: ${JSON.stringify(locator)}): ${err.message}`);
    }
  }

  // Perform `count` clicks at (x, y) in a SINGLE PowerShell process. Multi-click
  // (double/triple) has to keep the gap between clicks under the Windows
  // double-click time (~500ms); issuing each click as its own PowerShell process
  // was far too slow, so Windows saw separate single clicks. options.relativeTo
  // offsets the coordinates by the given window's top-left.
  async function multiClick(x, y, count, button = "left", options = {}) {
    if (options.relativeTo) {
      const rect = await getWindowRect(options.relativeTo);
      x += rect.x;
      y += rect.y;
    }
    const btnDown = button === "right" ? "0x0008" : "0x0002";
    const btnUp = button === "right" ? "0x0010" : "0x0004";
    const gap = options.gapMs != null ? options.gapMs : 60;
    await runPowerShell(`
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class MultiClickOps {
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, int dwExtraInfo);
}
"@
[MultiClickOps]::SetCursorPos(${x}, ${y});
Start-Sleep -Milliseconds 80;
for ($i = 0; $i -lt ${count}; $i++) {
  [MultiClickOps]::mouse_event(${btnDown}, 0, 0, 0, 0);
  [MultiClickOps]::mouse_event(${btnUp}, 0, 0, 0, 0);
  if ($i -lt (${count} - 1)) { Start-Sleep -Milliseconds ${gap} }
}
`);
  }

  // OCR an image file with the Windows built-in engine (Windows.Media.Ocr). It
  // needs no install, is on every Windows 10/11 box, and is markedly better than
  // Tesseract on screen/UI text. Returns the same shape as ocrFromImage. Windows
  // OCR does not expose per-word confidence, so confidences are nominal.
  async function ocrWindowsNative(imagePath, options = {}) {
    const script = `
Add-Type -AssemblyName System.Runtime.WindowsRuntime | Out-Null
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
function Await($op, $type) { $t = $asTaskGeneric.MakeGenericMethod($type).Invoke($null, @($op)); $t.Wait(-1) | Out-Null; $t.Result }
[void][Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime]
[void][Windows.Storage.Streams.IRandomAccessStream,Windows.Storage.Streams,ContentType=WindowsRuntime]
[void][Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics.Imaging,ContentType=WindowsRuntime]
[void][Windows.Graphics.Imaging.SoftwareBitmap,Windows.Graphics.Imaging,ContentType=WindowsRuntime]
[void][Windows.Globalization.Language,Windows.Globalization,ContentType=WindowsRuntime]
[void][Windows.Media.Ocr.OcrEngine,Windows.Media.Ocr,ContentType=WindowsRuntime]
$path = '${psPath(imagePath)}'
$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($path)) ([Windows.Storage.StorageFile])
$stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
$bitmap = [Windows.Graphics.Imaging.SoftwareBitmap]::Convert($bitmap, [Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8, [Windows.Graphics.Imaging.BitmapAlphaMode]::Premultiplied)
${options.lang ? `$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage((New-Object Windows.Globalization.Language('${psEscape(options.lang)}')))` : `$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()`}
if ($null -eq $engine) { throw 'No OCR language pack available' }
$result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
$words = New-Object System.Collections.ArrayList
foreach ($line in $result.Lines) { foreach ($w in $line.Words) { $r = $w.BoundingRect; [void]$words.Add([pscustomobject]@{ text = $w.Text; x0 = [int]$r.X; y0 = [int]$r.Y; x1 = [int]($r.X + $r.Width); y1 = [int]($r.Y + $r.Height) }) } }
[pscustomobject]@{ text = $result.Text; words = $words } | ConvertTo-Json -Depth 5 -Compress
`;
    const raw = await runPowerShell(script);
    const parsed = JSON.parse(raw);
    const wordsArr = Array.isArray(parsed.words) ? parsed.words : (parsed.words ? [parsed.words] : []);
    return {
      text: (parsed.text || "").trim(),
      confidence: 90, // Windows OCR does not report confidence; nominal value
      words: wordsArr.map((w) => ({
        text: w.text,
        confidence: 90,
        bbox: { x0: w.x0, y0: w.y0, x1: w.x1, y1: w.y1 },
      })),
    };
  }

  // Run OCR with the selected engine. Default on Windows is the native engine,
  // falling back to Tesseract if it errors; elsewhere Tesseract is used.
  async function ocrImage(imagePath, options = {}) {
    const engine = options.engine || (process.platform === "win32" ? "windows" : "tesseract");
    if (engine === "windows") {
      try {
        return await ocrWindowsNative(imagePath, options);
      } catch (err) {
        process.stdout.write(`[ocr] Windows OCR failed, falling back to Tesseract. Full error:\n${(err && err.message || err).toString()}\n`);
        if (options.engine === "windows") throw err; // caller explicitly demanded Windows OCR
      }
    }
    return await ocrFromImage(imagePath, options);
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
    // Move the cursor. When options.relativeTo (a window title pattern) is
    // given, x/y are treated as offsets from that window's top-left corner.
    async mouseMove(x, y, options = {}) {
      if (options.relativeTo) {
        const rect = await getWindowRect(options.relativeTo);
        x += rect.x;
        y += rect.y;
      }
      await runPowerShell(
        `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${x}, ${y})`
      );
    },

    // Click at coordinates. When options.relativeTo (a window title pattern) is
    // given, x/y are offsets from that window's top-left corner.
    async mouseClick(x, y, button = "left", options = {}) {
      if (options.relativeTo) {
        const rect = await getWindowRect(options.relativeTo);
        x += rect.x;
        y += rect.y;
      }
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

    // Double-click at (x, y). Both clicks fire in one process so Windows
    // registers them as a double-click. options: { button, relativeTo, gapMs }.
    async doubleClick(x, y, options = {}) {
      await multiClick(x, y, 2, options.button || "left", options);
    },

    // Triple-click at (x, y) — selects a whole line/paragraph in most apps.
    async tripleClick(x, y, options = {}) {
      await multiClick(x, y, 3, options.button || "left", options);
    },

    // Click while holding Shift — used for range-selecting text from a prior click to (x, y).
    async shiftClick(x, y, button = "left", options = {}) {
      if (options.relativeTo) {
        const rect = await getWindowRect(options.relativeTo);
        x += rect.x;
        y += rect.y;
      }
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

    // Press the left mouse button at `from`, move to `to`, then release —
    // a click-and-drag. from/to are { x, y }. When options.relativeTo (a
    // window title pattern) is given, both points are offsets from that
    // window's top-left corner.
    async drag({ from, to }, options = {}) {
      let fromX = from.x;
      let fromY = from.y;
      let toX = to.x;
      let toY = to.y;
      let rectInfo = "none";
      if (options.relativeTo) {
        const rect = await getWindowRect(options.relativeTo);
        rectInfo = `${rect.x},${rect.y} ${rect.width}x${rect.height}`;
        fromX += rect.x;
        fromY += rect.y;
        toX += rect.x;
        toY += rect.y;
      }
      const dist = Math.hypot(toX - fromX, toY - fromY);
      const steps = Math.max(15, Math.min(120, options.steps || Math.round(dist / 6)));
      const stepDelay = options.stepDelayMs != null ? options.stepDelayMs : 12;
      // Reports GetCursorPos before/after so we can see whether the cursor
      // actually moves and whether the target coordinates are on-screen.
      const out = await runPowerShell(`
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class DragOps {
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
    [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, int dwExtraInfo);
    [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
}
"@
Add-Type -AssemblyName System.Windows.Forms;
$scr = [System.Windows.Forms.SystemInformation]::VirtualScreen;
$p = New-Object DragOps+POINT;
$fromX = ${fromX}; $fromY = ${fromY}; $toX = ${toX}; $toY = ${toY}; $steps = ${steps};
[DragOps]::GetCursorPos([ref]$p) | Out-Null; Write-Output ("screen=$($scr.X),$($scr.Y) $($scr.Width)x$($scr.Height) startCursor=$($p.X),$($p.Y) from=$fromX,$fromY to=$toX,$toY");
$ok = [DragOps]::SetCursorPos($fromX, $fromY);
Start-Sleep -Milliseconds 150;
[DragOps]::GetCursorPos([ref]$p) | Out-Null; Write-Output ("SetCursorPos returned=$ok afterMoveToFrom=$($p.X),$($p.Y)");
[DragOps]::mouse_event(0x0002, 0, 0, 0, 0);
Start-Sleep -Milliseconds 150;
$prevX = $fromX; $prevY = $fromY;
for ($i = 1; $i -le $steps; $i++) {
  $x = [int]($fromX + (($toX - $fromX) * $i / $steps));
  $y = [int]($fromY + (($toY - $fromY) * $i / $steps));
  $dx = $x - $prevX; $dy = $y - $prevY;
  [DragOps]::mouse_event(0x0001, $dx, $dy, 0, 0);
  [DragOps]::SetCursorPos($x, $y) | Out-Null;
  $prevX = $x; $prevY = $y;
  Start-Sleep -Milliseconds ${stepDelay};
}
Start-Sleep -Milliseconds 150;
[DragOps]::GetCursorPos([ref]$p) | Out-Null; Write-Output ("afterDrag=$($p.X),$($p.Y)");
[DragOps]::mouse_event(0x0004, 0, 0, 0, 0);
`);
      if (options.debug) {
        process.stdout.write(`[drag diag] relativeTo rect=${rectInfo} | ${String(out).replace(/\r?\n/g, " | ")}\n`);
      }
    },

    // Scroll the mouse wheel at (x, y). `delta` is a small integer: positive
    // scrolls up, negative scrolls down (it's multiplied by WHEEL_DELTA=120).
    // When options.relativeTo (a window title pattern) is given, x/y are
    // offsets from that window's top-left corner.
    async scroll(x, y, delta, options = {}) {
      if (options.relativeTo) {
        const rect = await getWindowRect(options.relativeTo);
        x += rect.x;
        y += rect.y;
      }
      const wheel = Math.round(Number(delta) * 120);
      // MOUSEEVENTF_WHEEL = 0x0800; dwData is signed wheel movement.
      await runPowerShell(`
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class ScrollOps {
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, int dx, int dy, int dwData, int dwExtraInfo);
}
"@
[ScrollOps]::SetCursorPos(${x}, ${y});
Start-Sleep -Milliseconds 100;
[ScrollOps]::mouse_event(0x0800, 0, 0, ${wheel}, 0);
`);
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

    // --- Clipboard ---
    // Set the Windows clipboard to the given text.
    async setClipboard(text) {
      // Single quotes are doubled for PowerShell single-quoted string literals.
      const escaped = String(text).replace(/'/g, "''");
      await runPowerShell(`Set-Clipboard -Value '${escaped}'`);
    },

    // Return the current Windows clipboard text (empty string if clipboard has no text).
    async getClipboard() {
      return await runPowerShell(`Get-Clipboard -Raw`);
    },

    async screenshot(outputPath) {
      outputPath = resolveScreenshotPath(outputPath);
      await runPowerShell(`
Add-Type -AssemblyName System.Windows.Forms;
Add-Type -AssemblyName System.Drawing;
$screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds;
$bitmap = New-Object System.Drawing.Bitmap($screen.Width, $screen.Height);
$graphics = [System.Drawing.Graphics]::FromImage($bitmap);
try {
  $graphics.CopyFromScreen(0, 0, 0, 0, $bitmap.Size);
  $bitmap.Save('${psPath(outputPath)}');
} finally {
  $graphics.Dispose();
  $bitmap.Dispose();
}
`);
      return outputPath;
    },

    // Capture only the bounds of the window whose MainWindowTitle contains
    // titlePattern, saving to outputPath. Throws if the window is not found.
    async screenshotWindow(outputPath, titlePattern) {
      outputPath = resolveScreenshotPath(outputPath);
      const escaped = psEscape(titlePattern);
      await runPowerShell(`
Add-Type -AssemblyName System.Windows.Forms;
Add-Type -AssemblyName System.Drawing;
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinShotRect {
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
}
"@
$proc = Get-Process | Where-Object {$_.MainWindowTitle -like '*${escaped}*'} | Select-Object -First 1;
if ($null -eq $proc) { throw "Window matching '${escaped}' not found" }
$rect = New-Object WinShotRect+RECT;
[WinShotRect]::GetWindowRect($proc.MainWindowHandle, [ref]$rect) | Out-Null;
$width = $rect.Right - $rect.Left;
$height = $rect.Bottom - $rect.Top;
if ($width -le 0 -or $height -le 0) { throw "Window matching '${escaped}' has no visible area to capture" }
$bitmap = New-Object System.Drawing.Bitmap($width, $height);
$graphics = [System.Drawing.Graphics]::FromImage($bitmap);
$graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bitmap.Size);
$bitmap.Save('${psPath(outputPath)}');
$graphics.Dispose();
$bitmap.Dispose();
`);
      return outputPath;
    },

    // --- Image: Screenshot region ---
    async screenshotRegion(outputPath, region) {
      outputPath = resolveScreenshotPath(outputPath);
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
      // Window-targeted OCR: when options.window (a title pattern) is given and
      // no explicit region, capture just that window and OCR the whole image.
      if (options.window && !region) {
        const tmpWindow = path.join(os.tmpdir(), `marvin-window-ocr-${Date.now()}.png`);
        try {
          await driver.screenshotWindow(tmpWindow, options.window);
          return await ocrImage(tmpWindow, options);
        } finally {
          try { fs.unlinkSync(tmpWindow); } catch {}
        }
      }
      const tmpFile = await takeTempScreenshot();
      try {
        let imageInput = tmpFile;
        if (region) {
          const croppedPath = tmpFile + ".crop.png";
          await cropAndSave(tmpFile, region, croppedPath);
          imageInput = croppedPath;
        }
        const result = await ocrImage(imageInput, options);
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

    // --- UI Automation: control interaction ---
    // Locate a control under a window (matched by partial title) or the whole
    // desktop if windowTitle is null/empty. The locator may specify any of
    // name, className, controlId. Returns identifying info; throws if not found.
    async findControl(windowTitle, locator = {}) {
      const script = buildControlScript(
        windowTitle,
        locator,
        `Write-Output ("FOUND|" + $element.Current.Name + "|" + $element.Current.ClassName + "|" + $element.Current.AutomationId)`
      );
      let result;
      try {
        result = await runPowerShell(script);
      } catch (err) {
        throw new Error(`Control not found (window: "${windowTitle || "foreground"}", locator: ${JSON.stringify(locator)}): ${err.message}`);
      }
      const body = String(result).split("FOUND|")[1];
      if (body == null) {
        throw new Error(`Control not found (window: "${windowTitle || "foreground"}", locator: ${JSON.stringify(locator)})`);
      }
      const parts = body.split("|");
      return { found: true, name: parts[0] || "", className: parts[1] || "", automationId: parts[2] || "" };
    },

    // Click a control: prefer the InvokePattern, fall back to clicking its
    // clickable point via mouse_event. Throws if not found.
    async clickControl(windowTitle, locator) {
      const action = `
$invoked = $false;
try {
  $invoke = [System.Windows.Automation.InvokePattern]$element.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern);
  $invoke.Invoke();
  $invoked = $true;
} catch { $invoked = $false }
if (-not $invoked) {
  $pt = $element.GetClickablePoint();
  Add-Type @"
using System;
using System.Runtime.InteropServices;
public class CtrlClickOps {
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, int dwExtraInfo);
}
"@
  [CtrlClickOps]::SetCursorPos([int]$pt.X, [int]$pt.Y);
  Start-Sleep -Milliseconds 100;
  [CtrlClickOps]::mouse_event(0x0002, 0, 0, 0, 0);
  [CtrlClickOps]::mouse_event(0x0004, 0, 0, 0, 0);
}
`;
      await runControlAction(windowTitle, locator, action, "click");
    },

    // Set a control's value via the ValuePattern. Throws if not found.
    async setControlText(windowTitle, locator, text) {
      const action = `
$value = [System.Windows.Automation.ValuePattern]$element.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern);
$value.SetValue('${psEscape(text)}');
`;
      await runControlAction(windowTitle, locator, action, "set text");
    },

    // Read a control's value via the ValuePattern, falling back to its Name.
    // Throws if the control is not found.
    async getControlText(windowTitle, locator) {
      const action = `
$pattern = $null;
try { $pattern = [System.Windows.Automation.ValuePattern]$element.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern) } catch { $pattern = $null }
if ($null -ne $pattern) { Write-Output $pattern.Current.Value } else { Write-Output $element.Current.Name }
`;
      return await runControlAction(windowTitle, locator, action, "get text");
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
