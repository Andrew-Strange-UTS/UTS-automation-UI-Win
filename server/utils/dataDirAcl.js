// server/utils/dataDirAcl.js
// Windows ACL handling for the scheduler service's shared data directory
// (C:\ProgramData\uts-automation), which holds the schedules, the encrypted
// secrets and the master key. Standard users on the VM must not be able to read
// those files directly; the service runs as LocalSystem and must.
//
// The commands are built by pure functions so their shape can be tested on any
// platform. Getting the shape wrong locks the service out of its own key file.

const { execSync } = require("child_process");
const path = require("path");

// SIDs, not names: the account names differ on a non-English Windows.
const SID_SYSTEM = "*S-1-5-18";
const SID_ADMINISTRATORS = "*S-1-5-32-544";

/**
 * The two commands that lock the data directory down.
 *
 * Only the directory carries explicit ACEs, inheritable by files and folders;
 * children carry none and inherit.
 *
 * The directory command must NOT use /T. An (OI)(CI) grant is invalid on a
 * file, so with /T icacls rejects the grant for every existing child while
 * still applying /inheritance:r to it, leaving that file with an empty
 * protected DACL that not even SYSTEM can open. That is what locked the service
 * out of secrets_master_key ("EPERM: operation not permitted") on every start.
 * Existing children are handled by the second command instead.
 */
function dataDirAclCommands(dataDir) {
  return {
    directory:
      `icacls "${dataDir}" /inheritance:r ` +
      `/grant:r "${SID_SYSTEM}:(OI)(CI)F" "${SID_ADMINISTRATORS}:(OI)(CI)F" /C /Q`,
    // /reset drops a child's own ACL so it inherits the directory's. This is
    // also the repair path for files left with an empty DACL by the earlier
    // version of this code.
    children: `icacls "${path.join(dataDir, "*")}" /reset /T /C /Q`,
  };
}

/**
 * Recover a single file whose DACL was emptied. Ownership has to be taken
 * first: an empty DACL grants nobody WRITE_DAC, so /reset on its own fails
 * unless the caller already owns the file. LocalSystem holds
 * SeTakeOwnershipPrivilege, which is what makes this work from the service.
 * /A assigns ownership to the Administrators group rather than to SYSTEM.
 */
function fileAclRepairCommands(file) {
  return {
    takeown: `takeown /F "${file}" /A`,
    reset: `icacls "${file}" /reset /C /Q`,
  };
}

/**
 * Read access for the automation account, per path.
 *
 * A scheduled desktop run executes as that account (EPEA-TBD-13), so it has to
 * read the shared runners, utils, builtins and test repo, and write its own
 * per-run temp directory. It must NOT be granted the data directory itself:
 * that is where schedules.json, secrets.json.enc and secrets_master_key live,
 * and an inheritable grant at the root would hand it all three.
 *
 * No /T, for the same reason the directory hardening has none: an (OI)(CI)
 * grant is invalid on a file, so recursing makes icacls fail on every existing
 * child. The children were reset to inherit, so a grant on the directory
 * reaches them.
 */
const AUTOMATION_READ_DIRS = ["runners", "utils", "builtins", "repo"];
const AUTOMATION_WRITE_DIRS = ["tmp"];

// `.\name` is not reliably resolvable by icacls on a domain-joined machine: the
// grant is accepted, applies to nobody, and icacls still reports success. That
// left the automation account with no access to its own run directory, which
// showed up as "Access is denied" from the keep-alive and nowhere else.
// Qualify with the computer name, which is unambiguous against a domain.
function qualifyAccount(account, env = process.env) {
  if (account.includes("\\")) return account;
  const machine = env.COMPUTERNAME;
  return machine ? `${machine}\\${account}` : account;
}

function automationAccessCommands(dataDir, account, env = process.env) {
  const principal = qualifyAccount(account, env);
  const read = AUTOMATION_READ_DIRS.map(
    (dir) => `icacls "${path.join(dataDir, dir)}" /grant "${principal}:(OI)(CI)RX" /C`
  );
  const write = AUTOMATION_WRITE_DIRS.map(
    (dir) => `icacls "${path.join(dataDir, dir)}" /grant "${principal}:(OI)(CI)M" /C`
  );
  return [...read, ...write];
}

// icacls reports an unresolvable principal on stdout and still exits zero, so
// the output has to be read. Discarding it is how this failed silently.
function applyAutomationAccess(dataDir, account, exec = execSync) {
  const failures = [];

  for (const cmd of automationAccessCommands(dataDir, account)) {
    let output = "";
    try {
      output = String(exec(cmd, { windowsHide: true, encoding: "utf8" }) || "");
    } catch (err) {
      failures.push(`${cmd}: ${err.message}`);
      continue;
    }
    if (/Failed processing [1-9]|Invalid parameter|No mapping between account names/i.test(output)) {
      failures.push(`${cmd}: ${output.trim().split("\n").slice(-2).join(" ")}`);
    }
  }

  if (failures.length) {
    throw new Error(`Some permissions were not granted:\n  ${failures.join("\n  ")}`);
  }
}

function run(cmd, exec) {
  exec(cmd, { windowsHide: true, stdio: "ignore" });
}

function applyDataDirAcl(dataDir, exec = execSync) {
  const cmds = dataDirAclCommands(dataDir);
  run(cmds.directory, exec);
  try {
    run(cmds.children, exec);
  } catch {
    // Nothing to reset in an empty directory.
  }
}

function repairFileAcl(file, exec = execSync) {
  const cmds = fileAclRepairCommands(file);
  try {
    run(cmds.takeown, exec);
  } catch {
    // Ownership may already be ours; the reset below decides the outcome.
  }
  run(cmds.reset, exec);
}

module.exports = {
  qualifyAccount,
  AUTOMATION_READ_DIRS,
  AUTOMATION_WRITE_DIRS,
  automationAccessCommands,
  applyAutomationAccess,
  dataDirAclCommands,
  fileAclRepairCommands,
  applyDataDirAcl,
  repairFileAcl,
};
