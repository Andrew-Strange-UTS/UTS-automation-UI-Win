// server/utils/dataDirAcl.test.js
const test = require("node:test");
const assert = require("node:assert");

const {
  dataDirAclCommands,
  fileAclRepairCommands,
  applyDataDirAcl,
  repairFileAcl,
} = require("./dataDirAcl");

const DIR = "C:\\ProgramData\\uts-automation";
const KEY = "C:\\ProgramData\\uts-automation\\secrets_master_key";

test("the directory grant never recurses", () => {
  // /T alongside an (OI)(CI) grant is the bug that emptied every child's DACL:
  // icacls rejects the grant on a file but still strips its inherited ACEs.
  const { directory } = dataDirAclCommands(DIR);
  assert.ok(!/\s\/T\b/.test(directory), `directory command must not recurse: ${directory}`);
  assert.match(directory, /\/inheritance:r/);
  assert.match(directory, /\/grant:r "\*S-1-5-18:\(OI\)\(CI\)F" "\*S-1-5-32-544:\(OI\)\(CI\)F"/);
});

test("children are reset so they inherit, and never granted directly", () => {
  const { children } = dataDirAclCommands(DIR);
  assert.match(children, /\/reset/);
  assert.match(children, /\s\/T\b/); // recursing is correct here
  assert.ok(!/\/grant/.test(children));
  assert.ok(!/\(OI\)\(CI\)/.test(children), "inheritance flags are invalid on a file");
});

test("only SYSTEM and Administrators are granted", () => {
  const { directory } = dataDirAclCommands(DIR);
  const sids = directory.match(/\*S-[\d-]+/g) || [];
  assert.deepStrictEqual(sids.sort(), ["*S-1-5-18", "*S-1-5-32-544"]);
});

test("a single file is repaired by taking ownership before resetting", () => {
  const { takeown, reset } = fileAclRepairCommands(KEY);
  assert.match(takeown, /^takeown \/F "C:\\ProgramData\\uts-automation\\secrets_master_key" \/A$/);
  assert.match(reset, /^icacls ".*secrets_master_key" \/reset/);
});

test("applyDataDirAcl runs the directory command before the children command", () => {
  const calls = [];
  applyDataDirAcl(DIR, (cmd) => calls.push(cmd));
  assert.strictEqual(calls.length, 2);
  assert.ok(calls[0].includes("/grant:r"));
  assert.ok(calls[1].includes("/reset"));
});

test("an empty directory (nothing to reset) is not treated as a failure", () => {
  const exec = (cmd) => {
    if (cmd.includes("/reset")) throw new Error("The system cannot find the file specified.");
  };
  assert.doesNotThrow(() => applyDataDirAcl(DIR, exec));
});

test("a failing takeown still lets the reset run, and a failing reset surfaces", () => {
  const calls = [];
  repairFileAcl(KEY, (cmd) => {
    calls.push(cmd);
    if (cmd.startsWith("takeown")) throw new Error("Access is denied.");
  });
  assert.strictEqual(calls.length, 2);

  assert.throws(() =>
    repairFileAcl(KEY, (cmd) => {
      if (cmd.startsWith("icacls")) throw new Error("Access is denied.");
    })
  );
});

// ─── Automation account access (EPEA-TBD-13 AC11) ───

const { automationAccessCommands, AUTOMATION_READ_DIRS } = require("./dataDirAcl");

test("the automation account is never granted the data directory itself", () => {
  // schedules.json, secrets.json.enc and secrets_master_key live at the root.
  // An inheritable grant there would hand all three to the account that runs
  // the tests.
  const cmds = automationAccessCommands(DIR, "marvin-auto");

  for (const cmd of cmds) {
    const target = cmd.match(/icacls "([^"]+)"/)[1];
    assert.notStrictEqual(target, DIR, `must not grant on the data directory: ${cmd}`);
    assert.ok(target.startsWith(DIR), "and must stay inside it");
    assert.ok(!/schedules\.json|secrets\.json\.enc|secrets_master_key/.test(cmd));
  }
});

test("the run directories are readable and only the temp directory is writable", () => {
  const cmds = automationAccessCommands(DIR, "marvin-auto");
  const readable = cmds.filter((c) => /\(OI\)\(CI\)RX/.test(c));
  const writable = cmds.filter((c) => /\(OI\)\(CI\)M/.test(c));

  assert.strictEqual(readable.length, AUTOMATION_READ_DIRS.length);
  assert.strictEqual(writable.length, 1, "only the per-run temp directory is writable");
  assert.match(writable[0], /tmp/);
});

test("the grants never recurse, which is what emptied every DACL last time", () => {
  for (const cmd of automationAccessCommands(DIR, "marvin-auto")) {
    assert.ok(!/\s\/T\b/.test(cmd), `an (OI)(CI) grant with /T fails on every existing file: ${cmd}`);
  }
});

test("a bare account name is qualified as local, never left ambiguous", () => {
  // Unqualified, icacls can resolve it to a domain principal of the same name.
  const local = automationAccessCommands(DIR, "marvin-auto")[0];
  assert.match(local, /"\.\\marvin-auto:/);

  const explicit = automationAccessCommands(DIR, "VMNAME\\marvin-auto")[0];
  assert.match(explicit, /"VMNAME\\marvin-auto:/, "an already-qualified name is left alone");
});
