// server/utils/encryption.js
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { SECRETS_KEY_FILE } = require('./paths');
const KEY_FILE = SECRETS_KEY_FILE;

function ensureKey() {
  if (fs.existsSync(KEY_FILE)) {
    return fs.readFileSync(KEY_FILE);
  }
  const key = crypto.randomBytes(32); // 256 bits, as hex or binary
  fs.writeFileSync(KEY_FILE, key, { mode: 0o600 });
  // --- Log on first creation only: ---
  console.warn(`[secrets] Generated a new master key at ${KEY_FILE}`);
  return key;
}
const KEY = ensureKey();

const ALGO = 'aes-256-gcm';

function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, KEY, iv);
  let enc = cipher.update(JSON.stringify(plain), 'utf8', 'base64');
  enc += cipher.final('base64');
  const tag = cipher.getAuthTag();
  return iv.toString('hex') + ':' + tag.toString('hex') + ':' + enc;
}

function decrypt(string) {
  const [ivHex, tagHex, data] = string.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const cipher = crypto.createDecipheriv(ALGO, KEY, iv);
  cipher.setAuthTag(tag);
  let dec = cipher.update(data, 'base64', 'utf8');
  dec += cipher.final('utf8');
  return JSON.parse(dec);
}

module.exports = { encrypt, decrypt };