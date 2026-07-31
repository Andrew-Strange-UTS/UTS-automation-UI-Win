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
