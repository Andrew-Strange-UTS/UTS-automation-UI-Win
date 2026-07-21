// server/runners/native-types.test.js
// Run: node --test server/runners/native-types.test.js

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const { getNativePrelude, resetCache, NATIVE_SOURCE, SOURCE_HASH } = require("./native-types");

// Every type the desktop driver's PowerShell scripts reference. If a driver
// action needs a type that is not in the shared assembly, the action fails at
// run time with a bare "unable to find type" from PowerShell, so assert the
// contract here instead.
const REQUIRED_TYPES = [
  "WinRectOps",
  "MultiClickOps",
  "MouseOps",
  "ShiftClickOps",
  "RangeOps",
  "DragOps",
  "ScrollOps",
  "WinFocus",
  "WinMax",
  "WinShotRect",
  "CtrlClickOps",
  "WinTitle",
];

test("the shared assembly defines every type the driver uses", () => {
  for (const type of REQUIRED_TYPES) {
    assert.ok(
      NATIVE_SOURCE.includes(`public class ${type}`),
      `native source is missing ${type}`
    );
  }
});

test("no type the driver references is left undefined", () => {
  const runner = fs.readFileSync(path.join(__dirname, "desktop-runner.js"), "utf8");

  const defined = new Set(
    [...NATIVE_SOURCE.matchAll(/public class (\w+)/g)].map((m) => m[1])
  );

  const referenced = new Set();
  for (const m of runner.matchAll(/\[(\w+)\]::/g)) referenced.add(m[1]);
  for (const m of runner.matchAll(/New-Object (\w+)\+/g)) referenced.add(m[1]);

  // Built-in .NET and PowerShell types are not our concern.
  const builtin = /^(System|Console|Math|int|string|IntPtr|ref)$/;

  const missing = [...referenced].filter((t) => !defined.has(t) && !builtin.test(t));
  assert.deepStrictEqual(missing, [], `driver references undefined types: ${missing.join(", ")}`);
});

test("the driver no longer compiles C# inline", () => {
  const runner = fs.readFileSync(path.join(__dirname, "desktop-runner.js"), "utf8");

  // `Add-Type @"..."` and `-TypeDefinition` both invoke the C# compiler on every
  // call, which is the cost this module exists to remove. `-AssemblyName` is a
  // fast load of an already-compiled framework assembly and is fine.
  assert.ok(!runner.includes('Add-Type @"'), "found an inline Add-Type heredoc");
  assert.ok(!runner.includes("Add-Type -TypeDefinition"), "found an inline -TypeDefinition");
});

test("ScrollOps keeps a signed dwData", () => {
  // Wheel movement is negative when scrolling down. Merging it with the
  // unsigned signature the other classes use would break scroll-down.
  const scroll = NATIVE_SOURCE.slice(NATIVE_SOURCE.indexOf("public class ScrollOps"));
  const decl = scroll.slice(0, scroll.indexOf("}"));
  assert.match(decl, /int dwData/);
});

test("the source hash is stable and file-safe", () => {
  assert.match(SOURCE_HASH, /^[0-9a-f]{16}$/);
});

test("non-Windows falls back to inline definitions rather than failing", async (t) => {
  if (process.platform === "win32") {
    t.skip("fallback path is for non-Windows hosts");
    return;
  }

  resetCache();
  const prelude = await getNativePrelude();

  // Correct but slow beats a driver that cannot resolve its types at all.
  assert.match(prelude, /Add-Type @"/);
  assert.ok(prelude.includes("public class DragOps"));
});

test("the prelude is computed once and reused", async () => {
  resetCache();
  const first = await getNativePrelude();
  const second = await getNativePrelude();
  assert.strictEqual(first, second);
});
