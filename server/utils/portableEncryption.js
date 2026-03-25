// server/utils/portableEncryption.js
// Password-based encryption for portable schedule bundles.
// Uses PBKDF2 key derivation + AES-256-GCM so files can be
// decrypted on any machine with the correct password.

const crypto = require("crypto");

const MAGIC = Buffer.from("UTSB"); // 4-byte file header
const SALT_LEN = 16;
const IV_LEN = 12;
const TAG_LEN = 16;
const PBKDF2_ITERATIONS = 100000;
const KEY_LEN = 32; // 256 bits

function deriveKey(password, salt) {
  return crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, KEY_LEN, "sha256");
}

function portableEncrypt(dataObject, password) {
  const salt = crypto.randomBytes(SALT_LEN);
  const iv = crypto.randomBytes(IV_LEN);
  const key = deriveKey(password, salt);

  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const plaintext = JSON.stringify(dataObject);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  // File format: MAGIC + salt + iv + tag + ciphertext
  return Buffer.concat([MAGIC, salt, iv, tag, encrypted]);
}

function portableDecrypt(buffer, password) {
  // Validate magic header
  if (buffer.length < MAGIC.length + SALT_LEN + IV_LEN + TAG_LEN + 1) {
    throw new Error("File is too small to be a valid schedule bundle");
  }
  const magic = buffer.subarray(0, MAGIC.length);
  if (!magic.equals(MAGIC)) {
    throw new Error("Invalid file format — not a UTS schedule bundle");
  }

  let offset = MAGIC.length;
  const salt = buffer.subarray(offset, offset + SALT_LEN);
  offset += SALT_LEN;
  const iv = buffer.subarray(offset, offset + IV_LEN);
  offset += IV_LEN;
  const tag = buffer.subarray(offset, offset + TAG_LEN);
  offset += TAG_LEN;
  const ciphertext = buffer.subarray(offset);

  const key = deriveKey(password, salt);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);

  let decrypted;
  try {
    decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
  } catch (err) {
    throw new Error("Decryption failed — wrong password or corrupted file");
  }

  return JSON.parse(decrypted);
}

module.exports = { portableEncrypt, portableDecrypt };
