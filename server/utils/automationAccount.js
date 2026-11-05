// server/utils/automationAccount.js
// Which local account runs scheduled desktop tests.
//
// The file holds a name and nothing else. The account's password lives only in
// an LSA secret that SYSTEM can read (EPEA-TBD-17): the service needs it to
// open a loopback RDP session for each desktop run. It is never in this file,
// never in Marvin's secrets store, and never in this process: the PowerShell
// launcher reads it and hands it straight to the RDP client. See
// scripts/setup-automation-account.ps1.

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
    // Windows PowerShell 5.1's `Set-Content -Encoding UTF8` writes a byte-order
    // mark, and JSON.parse throws on it. That turned a perfectly good account
    // file into "no automation account is set up".
    const raw = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
    const parsed = JSON.parse(raw);
    return isValidAccountName(parsed.user) ? parsed.user : null;
  } catch {
    return null;
  }
}

module.exports = { isValidAccountName, readAccountName };
