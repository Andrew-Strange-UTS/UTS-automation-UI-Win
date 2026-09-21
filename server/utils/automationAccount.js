// server/utils/automationAccount.js
// Which local account runs scheduled desktop tests.
//
// The file holds a name and nothing else. No password is stored anywhere, by
// anything: the service takes the session token of an already logged-on
// session (WTSQueryUserToken), which needs no credential, and the only thing
// that ever needs the password is Winlogon at boot, which reads it from the LSA
// secret. See scripts/setup-automation-account.ps1.

const fsDefault = require("fs");

// Windows local account names: no spaces, no domain qualifier, none of the
// characters Windows forbids. Anything else is a configuration mistake, and
// passing it to icacls or PowerShell unchecked would be worse than useless.
const VALID_NAME = /^[A-Za-z0-9._-]{1,20}$/;

function isValidAccountName(name) {
  return typeof name === "string" && VALID_NAME.test(name);
}

// A malformed or unreadable file is "not configured", never a guess: running
// desktop tests as the wrong account is worse than not running them.
function readAccountName(file, { fs = fsDefault, env = process.env } = {}) {
  if (env.UTS_AUTOMATION_USER) {
    return isValidAccountName(env.UTS_AUTOMATION_USER) ? env.UTS_AUTOMATION_USER : null;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return isValidAccountName(parsed.user) ? parsed.user : null;
  } catch {
    return null;
  }
}

module.exports = { isValidAccountName, readAccountName };
