// server/runners/native-types.js
// One precompiled assembly for every P/Invoke helper the desktop driver uses.
//
// Each driver action runs in a fresh PowerShell process, and `Add-Type` with an
// inline C# body invokes the C# compiler *every time*. On a managed machine,
// where each temporary assembly is also scanned as it is written and loaded,
// that dominated run time: roughly 8s per action against ~190ms for the
// PowerShell process itself.
//
// So compile these types once into a DLL, cache it on disk keyed by a hash of
// the source, and have every later call do `Add-Type -Path <dll>` — an assembly
// load rather than a compile.

const { exec } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

// Every type previously defined inline across the driver, merged into one
// source file. Class names and method signatures are unchanged, so the scripts
// that reference them need no edits beyond dropping their own Add-Type block.
//
// Note ScrollOps.mouse_event takes a signed dwData (wheel movement is
// negative when scrolling down) while the others take unsigned. They are
// separate classes, so both signatures coexist.
const NATIVE_SOURCE = `
using System;
using System.Runtime.InteropServices;

public class WinRectOps {
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
}

public class MultiClickOps {
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, int dwExtraInfo);
}

public class MouseOps {
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, int dwExtraInfo);
}

public class ShiftClickOps {
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, int dwExtraInfo);
    [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, int dwExtraInfo);
}

public class RangeOps {
    [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
    [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, int dwExtraInfo);
    [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, int dwExtraInfo);
}

public class DragOps {
    [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
    [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, int dwExtraInfo);
}

public class ScrollOps {
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, int dx, int dy, int dwData, int dwExtraInfo);
}

public class WinFocus {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}

public class WinMax {
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}

public class WinShotRect {
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
}

public class CtrlClickOps {
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, int dwExtraInfo);
}

public class WinTitle {
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder text, int count);
}
`;

// Hash the source so a change to the types produces a new DLL rather than
// silently reusing a stale one.
const SOURCE_HASH = crypto.createHash("sha256").update(NATIVE_SOURCE).digest("hex").slice(0, 16);

function getCacheDir() {
  // UTS_DATA_DIR is the Electron userData directory in production, which is
  // per-user and writable. The install directory is not.
  const base = process.env.UTS_DATA_DIR || path.join(os.tmpdir(), "marvin");
  return path.join(base, "native");
}

// Resolved once per process: every driver action in a run shares the result.
let cached = null;

function compile(sourcePath, dllPath) {
  return new Promise((resolve, reject) => {
    // Compile to a process-unique temp file, then rename into place. Several
    // test processes can run concurrently, and a half-written DLL that another
    // process picks up would fail in a very confusing way.
    const tmpDll = `${dllPath}.${process.pid}.tmp`;
    const script =
      `Add-Type -Path '${sourcePath.replace(/'/g, "''")}' ` +
      `-OutputAssembly '${tmpDll.replace(/'/g, "''")}' -OutputType Library`;
    const encoded = Buffer.from(
      `$ErrorActionPreference = 'Stop'; try { ${script} } catch { Write-Error $_; exit 1 }`,
      "utf16le"
    ).toString("base64");

    exec(
      `powershell -NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand ${encoded}`,
      { timeout: 120000, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          try { fs.unlinkSync(tmpDll); } catch {}
          return reject(new Error(`Native assembly compile failed: ${stderr || stdout || err.message}`));
        }
        try {
          // rename is atomic; if another process won the race, keep theirs.
          fs.renameSync(tmpDll, dllPath);
        } catch (renameErr) {
          try { fs.unlinkSync(tmpDll); } catch {}
          if (!fs.existsSync(dllPath)) return reject(renameErr);
        }
        resolve(dllPath);
      }
    );
  });
}

/**
 * Resolve how PowerShell scripts should obtain the native types.
 *
 * Returns a PowerShell prelude string. Normally that loads the cached DLL. If
 * compilation is unavailable or fails, it falls back to the original inline
 * definition so the driver still works, just at the old speed, rather than
 * failing outright with "type not found".
 */
async function getNativePrelude() {
  if (cached) return cached;

  const inlineFallback = `Add-Type @"\n${NATIVE_SOURCE}\n"@;`;

  if (process.platform !== "win32") {
    cached = inlineFallback;
    return cached;
  }

  try {
    const dir = getCacheDir();
    fs.mkdirSync(dir, { recursive: true });

    const dllPath = path.join(dir, `marvin-native-${SOURCE_HASH}.dll`);
    if (!fs.existsSync(dllPath)) {
      const sourcePath = path.join(dir, `marvin-native-${SOURCE_HASH}.cs`);
      fs.writeFileSync(sourcePath, NATIVE_SOURCE, "utf8");
      await compile(sourcePath, dllPath);
    }

    cached = `Add-Type -Path '${dllPath.replace(/'/g, "''")}';`;
  } catch (err) {
    // Slow but correct beats fast but broken.
    console.error(`[native-types] Falling back to per-call compilation: ${err.message}`);
    cached = inlineFallback;
  }

  return cached;
}

// Test seam: drop the memoised prelude.
function resetCache() {
  cached = null;
}

module.exports = { getNativePrelude, resetCache, NATIVE_SOURCE, SOURCE_HASH, getCacheDir };
