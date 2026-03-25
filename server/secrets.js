// server/secrets.js
const fs = require('fs');
const { encrypt, decrypt } = require('./utils/encryption');
const { SECRETS_FILE } = require('./utils/paths');
let secrets = {};
try {
  if (fs.existsSync(SECRETS_FILE)) secrets = decrypt(fs.readFileSync(SECRETS_FILE, 'utf-8'));
} catch { secrets = {}; }

// Ensure default secrets exist (blank if not yet configured)
const DEFAULT_SECRETS = ['ZEPHYR_API_TOKEN', 'GITHUB_PERSONAL_ACCESS_TOKEN', 'GITHUB_USERNAME'];
let needsSave = false;
for (const name of DEFAULT_SECRETS) {
  if (!(name in secrets)) {
    secrets[name] = '';
    needsSave = true;
  }
}
if (needsSave) {
  fs.writeFileSync(SECRETS_FILE, encrypt(secrets), { mode: 0o600 });
}

function saveSecrets() {
  fs.writeFileSync(SECRETS_FILE, encrypt(secrets), { mode: 0o600 });
}

function listNames() { return Object.keys(secrets); }
function setSecret(name, value) { secrets[name] = value; saveSecrets(); }
function deleteSecret(name) { delete secrets[name]; saveSecrets(); }
function getSecret(name) { return secrets[name]; } // Only for backend use

module.exports = { listNames, setSecret, deleteSecret, getSecret };