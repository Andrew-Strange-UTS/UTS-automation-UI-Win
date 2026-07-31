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
  dataDirAclCommands,
  fileAclRepairCommands,
  applyDataDirAcl,
  repairFileAcl,
};
