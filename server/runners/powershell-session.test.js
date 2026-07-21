// server/runners/powershell-session.test.js
// Run: node --test server/runners/powershell-session.test.js
//
// Exercises the stdin/stdout protocol without needing PowerShell, by driving a
// fake child process. The protocol is where the risk is: a marker mismatch or a
// leaked pending command would hang a test run rather than fail it.

const test = require("node:test");
const assert = require("node:assert");
const { EventEmitter } = require("node:events");

const { PowerShellSession, isSupported } = require("./powershell-session");

// Minimal stand-in for a spawned PowerShell: records what was written to stdin
// and lets a test push lines back out of stdout.
function fakeProc() {
  const proc = new EventEmitter();
  proc.killed = false;
  proc.exitCode = null;
  proc.writes = [];
  proc.stdin = {
    write: (line) => { proc.writes.push(line); return true; },
    end: () => {},
  };
  proc.stdout = new EventEmitter();
  proc.stdout.setEncoding = () => {};
  proc.stderr = new EventEmitter();
  proc.stderr.setEncoding = () => {};
  proc.kill = () => { proc.killed = true; proc.exitCode = 0; };
  return proc;
}

function attach(session) {
  const proc = fakeProc();
  session.proc = proc;
  proc.stdout.on("data", (chunk) => session._onStdout(chunk));
  proc.stderr.on("data", (chunk) => { if (session.pending) session.pending.err += chunk; });
  return proc;
}

// The end marker is generated per command; read it back off the written line.
function markersFrom(proc) {
  const written = proc.writes[proc.writes.length - 1];
  const end = written.match(/__MARVIN_END_\d+__/g).pop();
  const err = written.match(/__MARVIN_ERR_\d+__/g).pop();
  return { end, err };
}

test("returns the command's output, without the marker", async () => {
  const session = new PowerShellSession();
  const proc = attach(session);

  const promise = session._send("Write-Output 'hello'");
  const { end } = markersFrom(proc);

  proc.stdout.emit("data", `hello\nworld\n${end}\n`);

  assert.strictEqual(await promise, "hello\nworld");
});

test("the script is sent base64-encoded on a single line", async () => {
  const session = new PowerShellSession();
  const proc = attach(session);

  // A multi-line script with quotes and braces: sent raw this would break
  // stdin parsing, which is the reason for encoding it.
  const script = "if ($true) {\n  Write-Output 'it''s fine'\n}";
  const promise = session._send(script);

  const written = proc.writes[0];
  assert.strictEqual(written.split("\n").filter(Boolean).length, 1, "must be one line");
  assert.ok(!written.includes("Write-Output 'it''s fine'"), "raw script must not be inlined");

  const encoded = written.match(/FromBase64String\('([^']+)'\)/)[1];
  assert.strictEqual(Buffer.from(encoded, "base64").toString("utf16le"), script);

  proc.stdout.emit("data", `${markersFrom(proc).end}\n`);
  await promise;
});

test("an error marker rejects with the message", async () => {
  const session = new PowerShellSession();
  const proc = attach(session);

  const promise = session._send("boom");
  const { end, err } = markersFrom(proc);

  proc.stdout.emit("data", `${err}Cannot find window 'Paint'\n${end}\n`);

  await assert.rejects(promise, /Cannot find window 'Paint'/);
});

test("output split across chunks is reassembled", async () => {
  const session = new PowerShellSession();
  const proc = attach(session);

  const promise = session._send("Write-Output 'x'");
  const { end } = markersFrom(proc);

  // Marker arriving split across reads must still be recognised.
  proc.stdout.emit("data", "partial");
  proc.stdout.emit("data", "-line\n");
  proc.stdout.emit("data", end.slice(0, 5));
  proc.stdout.emit("data", `${end.slice(5)}\n`);

  assert.strictEqual(await promise, "partial-line");
});

test("a failed command does not poison the next one", async () => {
  const session = new PowerShellSession();
  const proc = attach(session);

  const first = session._send("boom");
  const m1 = markersFrom(proc);
  proc.stdout.emit("data", `${m1.err}failed\n${m1.end}\n`);
  await assert.rejects(first, /failed/);

  assert.strictEqual(session.pending, null, "pending must be cleared");

  const second = session._send("Write-Output 'ok'");
  const m2 = markersFrom(proc);
  assert.notStrictEqual(m2.end, m1.end, "markers must be unique per command");

  proc.stdout.emit("data", `ok\n${m2.end}\n`);
  assert.strictEqual(await second, "ok");
});

test("the session exiting rejects the in-flight command", async () => {
  const session = new PowerShellSession();
  const proc = attach(session);
  proc.on("exit", (code, signal) => {
    session.proc = null;
    session._failPending(new Error(`PowerShell session exited (code ${code})`));
  });

  const promise = session._send("Start-Sleep 60");
  proc.emit("exit", 1, null);

  // The message must match what desktop-runner tests for when deciding to
  // fall back, or a dead session would surface as a script failure.
  await assert.rejects(promise, /session exited/i);
});

test("a command that never finishes times out and drops the session", async () => {
  const session = new PowerShellSession({ commandTimeoutMs: 50 });
  attach(session);

  await assert.rejects(session._send("Start-Sleep 60"), /timed out after 50ms/);
  assert.strictEqual(session.pending, null);
  assert.strictEqual(session.alive, false, "a hung session must be dropped");
});

test("stray output with no command in flight is ignored", () => {
  const session = new PowerShellSession();
  attach(session);

  assert.doesNotThrow(() => session._onStdout("unexpected banner text\n"));
});

test("run() refuses once disposed", async () => {
  const session = new PowerShellSession();
  attach(session);
  session.dispose();

  await assert.rejects(session.run("Write-Output 'x'"), /disposed/);
});

test("sessions are only used on Windows, and can be disabled", () => {
  const original = process.env.UTS_POWERSHELL_SESSION;
  try {
    delete process.env.UTS_POWERSHELL_SESSION;
    assert.strictEqual(isSupported(), process.platform === "win32");

    process.env.UTS_POWERSHELL_SESSION = "0";
    assert.strictEqual(isSupported(), false, "must be disableable as an escape hatch");
  } finally {
    if (original === undefined) delete process.env.UTS_POWERSHELL_SESSION;
    else process.env.UTS_POWERSHELL_SESSION = original;
  }
});
