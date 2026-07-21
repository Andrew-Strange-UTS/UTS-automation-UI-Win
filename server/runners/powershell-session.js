// server/runners/powershell-session.js
// A long-lived PowerShell process shared by every action in a test run.
//
// The driver used to spawn `cmd.exe` -> `powershell.exe` per action. Measured
// on a managed VM that cost ~11s per action installed (~1.35s in dev), flat
// regardless of how much work the action did, which made a 60-drag test take
// 12 minutes. The overhead is per process creation, so the fix is to create
// one process per run instead of one per action.
//
// Protocol: each command is sent as a single line that base64-decodes the real
// script and runs it, so multi-line scripts cannot break stdin parsing. A
// unique end marker per command delimits its output; an error marker carries
// the failure message. Commands are serialised, which matches how the driver
// already drives the desktop.

const { spawn } = require("child_process");
const os = require("os");

const START_TIMEOUT_MS = 30000;
const DEFAULT_COMMAND_TIMEOUT_MS = 30000;

class PowerShellSession {
  constructor(options = {}) {
    this.proc = null;
    this.starting = null;
    this.commandTimeoutMs = options.commandTimeoutMs || DEFAULT_COMMAND_TIMEOUT_MS;
    this.prelude = options.prelude || "";

    this.seq = 0;
    this.pending = null; // { id, resolve, reject, out, err, timer }
    this.buffer = "";
    this.disposed = false;
  }

  get alive() {
    return Boolean(this.proc && !this.proc.killed && this.proc.exitCode === null);
  }

  async start() {
    if (this.alive) return;
    if (this.starting) return this.starting;

    this.starting = new Promise((resolve, reject) => {
      // `-Command -` reads commands from stdin and executes them as they
      // arrive, which is what lets one process serve the whole run.
      const proc = spawn(
        "powershell",
        ["-NoProfile", "-NonInteractive", "-NoLogo", "-ExecutionPolicy", "Bypass", "-Command", "-"],
        { stdio: ["pipe", "pipe", "pipe"], windowsHide: true }
      );

      let settled = false;
      const startTimer = setTimeout(() => {
        if (!settled) {
          settled = true;
          try { proc.kill(); } catch {}
          reject(new Error("PowerShell session did not start within 30s"));
        }
      }, START_TIMEOUT_MS);

      proc.stdout.setEncoding("utf8");
      proc.stderr.setEncoding("utf8");

      proc.stdout.on("data", (chunk) => this._onStdout(chunk));
      proc.stderr.on("data", (chunk) => {
        if (this.pending) this.pending.err += chunk;
      });

      proc.on("error", (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(startTimer);
          reject(err);
        }
        this._failPending(new Error(`PowerShell session error: ${err.message}`));
      });

      proc.on("exit", (code, signal) => {
        this.proc = null;
        this._failPending(
          new Error(`PowerShell session exited (code ${code}${signal ? `, signal ${signal}` : ""})`)
        );
      });

      this.proc = proc;

      // Prove the session is usable before handing it any real work, and load
      // the native assembly once here rather than per command.
      const probe = `${this.prelude} Write-Output 'session-ready'`;
      this._send(probe)
        .then(() => {
          if (!settled) {
            settled = true;
            clearTimeout(startTimer);
            resolve();
          }
        })
        .catch((err) => {
          if (!settled) {
            settled = true;
            clearTimeout(startTimer);
            try { proc.kill(); } catch {}
            reject(err);
          }
        });
    }).finally(() => {
      this.starting = null;
    });

    return this.starting;
  }

  _onStdout(chunk) {
    this.buffer += chunk;

    let index;
    while ((index = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, index).replace(/\r$/, "");
      this.buffer = this.buffer.slice(index + 1);
      this._onLine(line);
    }
  }

  _onLine(line) {
    const pending = this.pending;
    if (!pending) return; // output arriving with no command in flight

    if (line === pending.endMarker) {
      const { resolve, reject, out, err, failed } = pending;
      clearTimeout(pending.timer);
      this.pending = null;

      if (failed) {
        const detail = [failed, err.trim()].filter(Boolean).join("\n");
        reject(new Error(detail));
      } else {
        resolve(out.join("\n").trim());
      }
      return;
    }

    if (line.startsWith(pending.errMarker)) {
      pending.failed = line.slice(pending.errMarker.length).trim();
      return;
    }

    pending.out.push(line);
  }

  _failPending(err) {
    if (!this.pending) return;
    clearTimeout(this.pending.timer);
    const { reject } = this.pending;
    this.pending = null;
    reject(err);
  }

  // Send one script and await its output. Serialised by the caller.
  _send(script, timeoutMs = this.commandTimeoutMs) {
    return new Promise((resolve, reject) => {
      if (!this.proc) {
        reject(new Error("PowerShell session is not running"));
        return;
      }

      const id = ++this.seq;
      const endMarker = `__MARVIN_END_${id}__`;
      const errMarker = `__MARVIN_ERR_${id}__`;

      this.pending = {
        id,
        endMarker,
        errMarker,
        out: [],
        err: "",
        failed: null,
        resolve,
        reject,
        timer: setTimeout(() => {
          // A hung command cannot be cancelled in-place, so drop the session.
          // The next call starts a fresh one.
          this.pending = null;
          this.dispose();
          reject(new Error(`PowerShell command timed out after ${timeoutMs}ms`));
        }, timeoutMs),
      };

      // One physical line: base64 avoids every quoting and multi-line parsing
      // problem that sending raw script text over stdin would create.
      const encoded = Buffer.from(script, "utf16le").toString("base64");
      const line =
        `try { $ErrorActionPreference='Stop'; ` +
        `Invoke-Expression ([Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${encoded}'))) } ` +
        `catch { Write-Output ('${errMarker}' + $_.Exception.Message) } ` +
        `finally { Write-Output '${endMarker}' }\n`;

      try {
        this.proc.stdin.write(line);
      } catch (err) {
        clearTimeout(this.pending.timer);
        this.pending = null;
        reject(new Error(`Could not write to PowerShell session: ${err.message}`));
      }
    });
  }

  async run(script, timeoutMs) {
    if (this.disposed) throw new Error("PowerShell session has been disposed");

    // Restart transparently if the session died between commands.
    if (!this.alive) await this.start();

    return this._send(script, timeoutMs);
  }

  dispose() {
    this.disposed = true;
    const proc = this.proc;
    this.proc = null;
    if (!proc) return;

    try {
      proc.stdin.end();
    } catch {
      // Already gone.
    }
    // Don't wait on a graceful exit during teardown.
    try {
      proc.kill();
    } catch {
      // Already gone.
    }
  }
}

function isSupported() {
  return process.platform === "win32" && process.env.UTS_POWERSHELL_SESSION !== "0";
}

module.exports = { PowerShellSession, isSupported };
