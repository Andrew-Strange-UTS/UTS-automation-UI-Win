// server/utils/defenderAsr.js
// Whether Microsoft Defender's Attack Surface Reduction will stop Marvin
// running.
//
// The rule below blocks executables that are unsigned and low-prevalence. A
// freshly built, unsigned Marvin.exe is exactly that, so it runs for a day or
// two while Microsoft's cloud has no opinion and is then blocked, with a shell
// error that says "You may not have the appropriate permissions", which sends
// people looking at ACLs. It is not a permissions problem and elevation does
// not help.
//
// The exposure is not limited to launching the app: the scheduler service's
// wrapper is an unsigned executable in the same folder, so a reboot can stop
// schedules running with no warning at all.
//
// Parsing and judgement are separated from running PowerShell so this can be
// tested against the real output captured from a managed VM.

const { execFile } = require("child_process");
const path = require("path");

// "Block executable files from running unless they meet a prevalence, age, or
// trusted list criterion".
const PREVALENCE_RULE_ID = "01443614-cd74-433a-b99e-2ecdc07bfc25";

// Get-MpPreference reports actions as numbers, positionally matched to the ids.
const Action = {
  0: "off",
  1: "block",
  2: "audit",
  6: "warn",
};

// Warn is included deliberately. It is meant to show a toast with an "Unblock"
// button, but a server session has no notification UI to click, so in practice
// it is a block with a misleading error.
const BLOCKING_ACTIONS = new Set(["block", "warn"]);

function normalisePath(value) {
  return String(value || "")
    .trim()
    .replace(/[\\/]+$/, "")
    .toLowerCase();
}

// Defender matches an exclusion against the path and everything beneath it.
function isPathCovered(target, exclusions = []) {
  const wanted = normalisePath(target);
  if (!wanted) return false;

  return (Array.isArray(exclusions) ? exclusions : [exclusions]).some((entry) => {
    const excluded = normalisePath(entry);
    if (!excluded) return false;
    if (wanted === excluded) return true;
    return wanted.startsWith(excluded + path.sep.toLowerCase()) || wanted.startsWith(excluded + "\\");
  });
}

// Ids and actions come back as two parallel arrays, matched by position.
function ruleAction(state = {}, ruleId = PREVALENCE_RULE_ID) {
  const ids = [].concat(state.ids || []).map((id) => String(id).toLowerCase());
  const actions = [].concat(state.actions || []);
  const index = ids.indexOf(String(ruleId).toLowerCase());
  if (index === -1) return "off";
  return Action[Number(actions[index])] || "unknown";
}

/**
 * The verdict for the startup check.
 *
 * `ok` means Marvin will keep running: either the rule is not enforcing, or an
 * exclusion covers where Marvin is installed. Anything else names the fix.
 */
function evaluateAsr({ state = {}, installDir } = {}) {
  const action = ruleAction(state);
  const exclusions = state.exclusions || [];
  const covered = isPathCovered(installDir, exclusions);

  if (!BLOCKING_ACTIONS.has(action)) {
    return {
      ok: true,
      action,
      covered,
      cause: action === "audit" ? "Rule is audit-only" : "Rule is not enforced on this machine",
    };
  }

  if (covered) {
    return {
      ok: true,
      action,
      covered,
      cause: `Rule is ${action}, and ${installDir} is excluded`,
    };
  }

  return {
    ok: false,
    action,
    covered,
    cause:
      action === "warn"
        ? `Defender's prevalence rule is in warn mode and nothing excludes ${installDir}`
        : `Defender's prevalence rule is blocking, and nothing excludes ${installDir}`,
    hint:
      `Marvin is unsigned, so this rule stops it running once its reputation settles, usually a day or two after a new build. ` +
      `From an elevated prompt: Add-MpPreference -AttackSurfaceReductionOnlyExclusions "${installDir}". ` +
      `If that is refused or does not persist, the policy is centrally managed and IT must apply the exclusion. ` +
      `Exclude the whole folder: the scheduler service's own executable lives in it, so a reboot can stop schedules too. ` +
      `Code signing removes the need for any of this.`,
  };
}

// One PowerShell call, shaped into JSON we can parse.
const STATE_COMMAND =
  "$p = Get-MpPreference; " +
  "[pscustomobject]@{ " +
  "ids = @($p.AttackSurfaceReductionRules_Ids); " +
  "actions = @($p.AttackSurfaceReductionRules_Actions); " +
  "exclusions = @($p.AttackSurfaceReductionOnlyExclusions) " +
  "} | ConvertTo-Json -Compress";

function runPowerShell(command, timeoutMs) {
  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command],
      { timeout: timeoutMs, windowsHide: true },
      (err, stdout, stderr) => resolve({ err, stdout: stdout || "", stderr: stderr || "" })
    );
  });
}

function parseState(stdout) {
  const text = String(stdout || "").replace(/^﻿/, "").trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object") return null;
    return {
      ids: [].concat(parsed.ids || []),
      actions: [].concat(parsed.actions || []),
      exclusions: [].concat(parsed.exclusions || []).filter(Boolean),
    };
  } catch {
    return null;
  }
}

// Never guesses. If Defender cannot be asked, that is reported as unknown
// rather than as "fine", because "fine" here means "this app will keep
// starting" and we would have no basis for saying so.
async function checkAsr(options = {}) {
  const {
    installDir = path.dirname(process.execPath),
    platform = process.platform,
    timeoutMs = 8000,
    run = runPowerShell,
  } = options;

  if (platform !== "win32") {
    return { ok: true, action: "off", cause: "Windows Defender only applies on Windows", installDir };
  }

  const { stdout } = await run(STATE_COMMAND, timeoutMs);
  const state = parseState(stdout);
  if (!state) {
    return {
      ok: false,
      action: "unknown",
      installDir,
      cause: "Defender's Attack Surface Reduction settings could not be read",
      hint:
        "Run `(Get-MpPreference).AttackSurfaceReductionRules_Actions` by hand. If Defender is managed by another product, " +
        "this check does not apply and can be ignored.",
    };
  }

  return { ...evaluateAsr({ state, installDir }), installDir };
}

module.exports = {
  PREVALENCE_RULE_ID,
  Action,
  isPathCovered,
  ruleAction,
  evaluateAsr,
  parseState,
  checkAsr,
  STATE_COMMAND,
};
