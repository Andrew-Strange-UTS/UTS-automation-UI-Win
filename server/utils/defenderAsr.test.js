// server/utils/defenderAsr.test.js
// Run: node --test server/utils/defenderAsr.test.js
//
// The fixture is the real Get-MpPreference output from the managed VM on
// 23 Sep 2026, the day the prevalence rule started blocking Marvin.exe.

const test = require("node:test");
const assert = require("node:assert");

const {
  PREVALENCE_RULE_ID,
  isPathCovered,
  ruleAction,
  evaluateAsr,
  parseState,
  checkAsr,
} = require("./defenderAsr");

const INSTALL_DIR = "C:\\Program Files\\Marvin";

// Exactly as the VM reported it: sixteen rules, and the prevalence rule first
// with action 6 (warn).
const VM_STATE = {
  ids: [
    "01443614-cd74-433a-b99e-2ecdc07bfc25",
    "26190899-1602-49e8-8b27-eb1d0a1ce869",
    "3b576869-a4ec-4529-8536-b80a7769e899",
    "56a863a9-875e-4185-98a7-b882c64b5ce5",
    "5beb7efe-fd9a-4556-801d-275e5ffc04cc",
    "75668c1f-73b5-4cf0-bb93-3ecf5cb7cc84",
    "7674ba52-37eb-4a4f-a9a1-f0f9a1619a2c",
    "92e97fa1-2edf-4476-bdd6-9dd0b4dddc7b",
    "9e6c4e1f-7d60-472f-ba1a-a39ef669e4b2",
    "b2b3f03d-6a65-4f7b-a9c7-1c7ef74a9ba4",
    "be9ba2d9-53ea-4cdc-84e5-9b1eeee46550",
    "c1db55ab-c21a-4637-bb3f-a12568109d35",
    "d1e49aac-8f56-4280-b9ba-993a6d77406c",
    "d3e037e1-3eb8-44c8-a917-57927947596d",
    "d4f940ab-401b-4efc-aadc-ad5f3c50688a",
    "e6db77e5-3df2-4cf1-b95a-636979351e5b",
  ],
  actions: [6, 1, 1, 1, 1, 1, 1, 1, 2, 1, 1, 1, 2, 1, 1, 1],
  exclusions: ["D:\\ProgramData\\Honeywell\\html5Server\\Html5ServerSetup.exe"],
};

test("the rule's action is read by position, not by luck", () => {
  // Ids and actions are two parallel arrays. Pairing them wrongly would report
  // some unrelated rule's mode.
  assert.strictEqual(ruleAction(VM_STATE), "warn");
  assert.strictEqual(ruleAction(VM_STATE, "9e6c4e1f-7d60-472f-ba1a-a39ef669e4b2"), "audit");
  assert.strictEqual(ruleAction(VM_STATE, "26190899-1602-49e8-8b27-eb1d0a1ce869"), "block");
  assert.strictEqual(ruleAction(VM_STATE, "00000000-0000-0000-0000-000000000000"), "off");
});

test("the VM's actual state is reported as a failure, because it was one", () => {
  // This is the state Marvin was in when it stopped launching for two users.
  const result = evaluateAsr({ state: VM_STATE, installDir: INSTALL_DIR });

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.action, "warn");
  assert.match(result.cause, /warn mode/);
  assert.match(result.hint, /Add-MpPreference/);
  assert.match(result.hint, /whole folder/, "excluding only the exe leaves the service exposed");
});

test("warn counts as blocking, because a server has no toast to click", () => {
  // Warn is supposed to let the user unblock interactively. On a VM there is no
  // notification UI, so it is a hard block with a misleading error.
  const warn = evaluateAsr({ state: VM_STATE, installDir: INSTALL_DIR });
  const block = evaluateAsr({ state: { ...VM_STATE, actions: [1, ...VM_STATE.actions.slice(1)] }, installDir: INSTALL_DIR });

  assert.strictEqual(warn.ok, false);
  assert.strictEqual(block.ok, false);
});

test("an exclusion covering the install directory clears it", () => {
  // What the fix looked like on the VM.
  const state = { ...VM_STATE, exclusions: [...VM_STATE.exclusions, INSTALL_DIR] };
  const result = evaluateAsr({ state, installDir: INSTALL_DIR });

  assert.strictEqual(result.ok, true);
  assert.match(result.cause, /excluded/);
});

test("audit-only and disabled rules are not failures", () => {
  const audit = evaluateAsr({ state: { ...VM_STATE, actions: [2, ...VM_STATE.actions.slice(1)] }, installDir: INSTALL_DIR });
  const off = evaluateAsr({ state: { ...VM_STATE, actions: [0, ...VM_STATE.actions.slice(1)] }, installDir: INSTALL_DIR });

  assert.strictEqual(audit.ok, true);
  assert.strictEqual(off.ok, true);
});

// ─── Exclusion matching ───

test("an exclusion covers everything beneath it", () => {
  // The service's wrapper lives several levels down, and it is the half that
  // stops schedules if it is blocked.
  const daemon = "C:\\Program Files\\Marvin\\resources\\app\\server\\daemon";
  assert.ok(isPathCovered(daemon, [INSTALL_DIR]));
  assert.ok(isPathCovered(INSTALL_DIR, [INSTALL_DIR]));
});

test("exclusion matching ignores case and trailing separators, as Windows does", () => {
  assert.ok(isPathCovered(INSTALL_DIR, ["c:\\program files\\marvin\\"]));
  assert.ok(isPathCovered(INSTALL_DIR, ["C:\\PROGRAM FILES\\MARVIN"]));
});

test("a partial name is not a match", () => {
  // C:\Program Files\Marvin2 must not be read as covering C:\Program Files\Marvin.
  assert.ok(!isPathCovered("C:\\Program Files\\Marvin2", [INSTALL_DIR]));
  assert.ok(!isPathCovered(INSTALL_DIR, ["C:\\Program Files\\Marv"]));
  assert.ok(!isPathCovered(INSTALL_DIR, []));
});

// ─── Reading the state ───

test("the PowerShell output is parsed, BOM and all", () => {
  const stdout = '\uFEFF{"ids":["01443614-cd74-433a-b99e-2ecdc07bfc25"],"actions":[1],"exclusions":["C:\\\\x"]}';
  const state = parseState(stdout);
  assert.strictEqual(ruleAction(state), "block");
  assert.deepStrictEqual(state.exclusions, ["C:\\x"]);
});

test("a single rule comes back as a value, not an array, and still works", () => {
  const state = parseState('{"ids":"01443614-cd74-433a-b99e-2ecdc07bfc25","actions":1,"exclusions":null}');
  assert.strictEqual(ruleAction(state), "block");
  assert.deepStrictEqual(state.exclusions, []);
});

test("unreadable settings are reported as unknown, never as fine", async () => {
  // "ok" here means "this app will keep starting". With no answer from
  // Defender there is no basis for saying that.
  const result = await checkAsr({
    installDir: INSTALL_DIR,
    platform: "win32",
    run: async () => ({ stdout: "", stderr: "Get-MpPreference is not recognized" }),
  });

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.action, "unknown");
  assert.match(result.hint, /by hand/);
});

test("off Windows the check passes without running anything", async () => {
  let ran = false;
  const result = await checkAsr({
    installDir: "/opt/marvin",
    platform: "linux",
    run: async () => { ran = true; return { stdout: "" }; },
  });

  assert.strictEqual(result.ok, true);
  assert.strictEqual(ran, false);
});

test("the rule id is the prevalence one, spelled the way Defender reports it", () => {
  assert.strictEqual(PREVALENCE_RULE_ID, "01443614-cd74-433a-b99e-2ecdc07bfc25");
});
