// server/utils/dataDirHealth.test.js
// Run: node --test server/utils/dataDirHealth.test.js

const test = require("node:test");
const assert = require("node:assert");

const {
  DataStoreError,
  readJsonWithRepair,
  writeWithRepair,
  probeWritable,
  isPermissionError,
} = require("./dataDirHealth");

const FILE = "C:\\ProgramData\\uts-automation\\schedules.json";
const DIR = "C:\\ProgramData\\uts-automation";

function permError(code = "EPERM") {
  const err = new Error(`${code}: operation not permitted, open '${FILE}'`);
  err.code = code;
  return err;
}

function missingError() {
  const err = new Error("ENOENT: no such file or directory");
  err.code = "ENOENT";
  return err;
}

// ─── Reading ───

test("a permission error is never reported as an empty store", () => {
  // The defect this file exists for: loadSchedules() caught EPERM and returned
  // [], so a locked schedules.json was indistinguishable from an empty one.
  const fs = { readFileSync: () => { throw permError(); } };

  assert.throws(
    () => readJsonWithRepair(FILE, { fs, missingValue: [] }),
    (err) => err instanceof DataStoreError && err.code === "EPERM" && err.path === FILE
  );
});

test("a missing file is a real answer, not an error", () => {
  const fs = { readFileSync: () => { throw missingError(); } };
  assert.deepStrictEqual(readJsonWithRepair(FILE, { fs, missingValue: [] }), []);
});

test("a denied read is repaired once and retried, and the repaired read wins", () => {
  let reads = 0;
  const repaired = [];
  const fs = {
    readFileSync: () => {
      reads += 1;
      if (reads === 1) throw permError();
      return '[{"id":"abc"}]';
    },
  };

  const result = readJsonWithRepair(FILE, { fs, repair: (f) => repaired.push(f), missingValue: [] });

  assert.deepStrictEqual(result, [{ id: "abc" }]);
  assert.strictEqual(reads, 2, "exactly one retry");
  assert.deepStrictEqual(repaired, [FILE]);
});

test("a repair that does not help fails loudly and does not loop", () => {
  let reads = 0;
  let repairs = 0;
  const fs = { readFileSync: () => { reads += 1; throw permError(); } };

  assert.throws(
    () => readJsonWithRepair(FILE, { fs, repair: () => { repairs += 1; }, missingValue: [] }),
    /repairing its permissions did not help/
  );
  assert.strictEqual(reads, 2, "one read, one retry, no loop");
  assert.strictEqual(repairs, 1, "one repair attempt, no loop");
});

test("a repair that throws still lets the retry decide the outcome", () => {
  let reads = 0;
  const fs = {
    readFileSync: () => {
      reads += 1;
      if (reads === 1) throw permError("EACCES");
      return "[]";
    },
  };

  const result = readJsonWithRepair(FILE, {
    fs,
    repair: () => { throw new Error("takeown failed"); },
    missingValue: [],
  });

  assert.deepStrictEqual(result, []);
});

test("a byte-order mark is tolerated, not reported as corrupt", () => {
  // Invisible in every editor, fatal to JSON.parse, and written by default by
  // both Windows PowerShell and Notepad.
  const fs = { readFileSync: () => "\uFEFF" + '[{"id":"abc"}]' };
  assert.deepStrictEqual(readJsonWithRepair(FILE, { fs, missingValue: [] }), [{ id: "abc" }]);
});

test("corrupt JSON is reported as corrupt, not as empty", () => {
  const fs = { readFileSync: () => "{not json" };
  assert.throws(
    () => readJsonWithRepair(FILE, { fs, missingValue: [] }),
    (err) => err instanceof DataStoreError && err.code === "EBADJSON"
  );
});

test("an unexpected error is surfaced rather than repaired", () => {
  const err = new Error("EISDIR: illegal operation on a directory");
  err.code = "EISDIR";
  let repairs = 0;
  const fs = { readFileSync: () => { throw err; } };

  assert.throws(
    () => readJsonWithRepair(FILE, { fs, repair: () => { repairs += 1; }, missingValue: [] }),
    (e) => e instanceof DataStoreError && e.code === "EISDIR"
  );
  assert.strictEqual(repairs, 0, "only permission errors are repairable");
});

// ─── Writing ───

test("a denied write is repaired once and retried", () => {
  let writes = 0;
  let repairs = 0;
  const fs = {
    writeFileSync: () => {
      writes += 1;
      if (writes === 1) throw permError();
    },
  };

  writeWithRepair(FILE, "[]", { fs, repair: () => { repairs += 1; } });

  assert.strictEqual(writes, 2);
  assert.strictEqual(repairs, 1);
});

test("a write that stays denied throws a DataStoreError naming the file", () => {
  const fs = { writeFileSync: () => { throw permError(); } };

  assert.throws(
    () => writeWithRepair(FILE, "[]", { fs, repair: () => {} }),
    (err) => err instanceof DataStoreError && err.path === FILE && /did not help/.test(err.message)
  );
});

// ─── Write probe ───

test("the write probe reports success and leaves nothing behind", () => {
  const written = [];
  const removed = [];
  const fs = {
    writeFileSync: (f) => written.push(f),
    unlinkSync: (f) => removed.push(f),
  };

  const result = probeWritable(DIR, { fs });

  assert.strictEqual(result.ok, true);
  assert.strictEqual(written.length, 1);
  assert.deepStrictEqual(removed, written, "the probe file is always removed");
});

test("the write probe reports a locked directory instead of throwing", () => {
  // Deliberate break: this is the check going red. A health check nobody has
  // seen fail is not a check.
  const fs = {
    writeFileSync: () => { throw permError(); },
    unlinkSync: () => { throw missingError(); },
  };

  const result = probeWritable(DIR, { fs });

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, "EPERM");
  assert.match(result.detail, /Cannot write to/);
});

test("permission errors are recognised on both platforms", () => {
  assert.ok(isPermissionError(permError("EPERM")));
  assert.ok(isPermissionError(permError("EACCES")));
  assert.ok(!isPermissionError(missingError()));
  assert.ok(!isPermissionError(undefined));
});
