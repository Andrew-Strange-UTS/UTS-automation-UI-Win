// server/utils/dataDirHealth.js
// Reading and writing the scheduler's shared data directory, honestly.
//
// The schedule store used to swallow a permission error and return an empty
// list, so "I cannot read your schedules" and "you have no schedules" looked
// identical: the API reported zero schedules, the startup check went green, and
// two active schedules quietly stopped running for two months. Nothing here may
// substitute a default for a failure.
//
// fs and the repair step are injectable so the behaviour can be tested off
// Windows, where the permission errors this exists for cannot be reproduced.

const fsDefault = require("fs");
const path = require("path");

class DataStoreError extends Error {
  constructor(message, { code, path: target, cause } = {}) {
    super(message);
    this.name = "DataStoreError";
    this.code = code;
    this.path = target;
    this.cause = cause;
  }
}

// Windows reports a locked-out ACL as EPERM; POSIX as EACCES.
function isPermissionError(err) {
  return !!err && (err.code === "EPERM" || err.code === "EACCES");
}

// The elevated commands an admin runs when the service cannot repair a file
// itself. Same shapes as dataDirAcl.js, in the order they have to be run.
function repairHint(target, dataDir) {
  if (process.platform !== "win32") {
    return `Check the ownership and permissions of ${target}.`;
  }
  return (
    `From an elevated PowerShell: takeown /F "${target}" /A; ` +
    `icacls "${target}" /reset; ` +
    `icacls "${dataDir}\\*" /reset /T /C /Q`
  );
}

// Read and parse a JSON file. A missing file is a real answer and returns
// `missingValue`; anything else is an error the caller must see. A permission
// error gets one repair attempt and one retry, never a loop.
function readJsonWithRepair(file, opts = {}) {
  const { fs = fsDefault, repair, missingValue, onLog = () => {} } = opts;

  // existsSync is deliberately not used: a file whose DACL is empty can fail to
  // stat, which would read as "missing" and put us back where we started.
  const attempt = () => {
    try {
      return { text: fs.readFileSync(file, "utf8") };
    } catch (err) {
      if (err.code === "ENOENT") return { missing: true };
      throw err;
    }
  };

  let result;
  try {
    result = attempt();
  } catch (err) {
    if (!isPermissionError(err) || !repair) {
      throw new DataStoreError(`Cannot read ${file} (${err.code || err.message}).`, {
        code: err.code,
        path: file,
        cause: err,
      });
    }
    onLog(`Cannot read ${file} (${err.code}). Repairing its permissions...`);
    try {
      repair(file);
    } catch (repairErr) {
      onLog(`Permission repair for ${file} failed: ${repairErr.message}`);
    }
    try {
      result = attempt();
    } catch (retryErr) {
      throw new DataStoreError(
        `Cannot read ${file} (${retryErr.code || retryErr.message}), and repairing its permissions did not help.`,
        { code: retryErr.code, path: file, cause: retryErr }
      );
    }
  }

  if (result.missing) return missingValue;

  try {
    return JSON.parse(result.text);
  } catch (err) {
    throw new DataStoreError(`${file} is not valid JSON (${err.message}).`, {
      code: "EBADJSON",
      path: file,
      cause: err,
    });
  }
}

// Write a file, with the same one-shot repair as the read path. The write path
// had no repair at all, which is how a locked schedules.json turned into an
// HTML 500 on every attempt to add a schedule.
function writeWithRepair(file, contents, opts = {}) {
  const { fs = fsDefault, repair, onLog = () => {} } = opts;

  try {
    fs.writeFileSync(file, contents);
    return;
  } catch (err) {
    if (!isPermissionError(err) || !repair) {
      throw new DataStoreError(`Cannot write ${file} (${err.code || err.message}).`, {
        code: err.code,
        path: file,
        cause: err,
      });
    }
    onLog(`Cannot write ${file} (${err.code}). Repairing its permissions...`);
    try {
      repair(file);
    } catch (repairErr) {
      onLog(`Permission repair for ${file} failed: ${repairErr.message}`);
    }
  }

  try {
    fs.writeFileSync(file, contents);
  } catch (retryErr) {
    throw new DataStoreError(
      `Cannot write ${file} (${retryErr.code || retryErr.message}), and repairing its permissions did not help.`,
      { code: retryErr.code, path: file, cause: retryErr }
    );
  }
}

// Can the service actually write into its data directory? A health check that
// only reports uptime says nothing about whether the thing can do its job.
// Leaves nothing behind, including when the write succeeds and the delete does
// not, which is why the probe name is unique per process.
function probeWritable(dir, opts = {}) {
  const { fs = fsDefault } = opts;
  const probe = path.join(dir, `.write-probe-${process.pid}`);

  try {
    fs.writeFileSync(probe, "probe");
  } catch (err) {
    return { ok: false, code: err.code, path: dir, detail: `Cannot write to ${dir} (${err.code || err.message}).` };
  } finally {
    try {
      fs.unlinkSync(probe);
    } catch {
      // Nothing to clean up if the write never happened.
    }
  }

  return { ok: true, path: dir };
}

module.exports = {
  DataStoreError,
  isPermissionError,
  readJsonWithRepair,
  writeWithRepair,
  probeWritable,
  repairHint,
};
