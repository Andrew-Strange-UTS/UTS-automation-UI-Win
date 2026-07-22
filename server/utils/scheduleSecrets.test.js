// server/utils/scheduleSecrets.test.js
// Run: node --test server/utils/scheduleSecrets.test.js

const test = require("node:test");
const assert = require("node:assert");
const crypto = require("crypto");

const { makeScheduleSecrets } = require("./scheduleSecrets");

// A visible, reversible stand-in so tests can assert on the stored form.
function fakeCrypto() {
  return {
    encrypt: (obj) => "enc:" + Buffer.from(JSON.stringify(obj)).toString("base64"),
    decrypt: (str) => JSON.parse(Buffer.from(str.slice(4), "base64").toString("utf8")),
  };
}

// The real machine-key scheme the service uses, to prove the round trip holds
// with actual AES-256-GCM rather than only the fake.
function realCrypto() {
  const key = crypto.randomBytes(32);
  return {
    encrypt: (obj) => {
      const iv = crypto.randomBytes(12);
      const c = crypto.createCipheriv("aes-256-gcm", key, iv);
      const enc = c.update(JSON.stringify(obj), "utf8", "base64") + c.final("base64");
      return iv.toString("hex") + ":" + c.getAuthTag().toString("hex") + ":" + enc;
    },
    decrypt: (str) => {
      const [ivHex, tagHex, data] = str.split(":");
      const d = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
      d.setAuthTag(Buffer.from(tagHex, "hex"));
      return JSON.parse(d.update(data, "base64", "utf8") + d.final("utf8"));
    },
  };
}

test("plaintext bundled secrets are encrypted on save", () => {
  const { prepareForSave } = makeScheduleSecrets(fakeCrypto());

  const saved = prepareForSave([
    { id: "a", bundledSecrets: { TOKEN: "hunter2" }, name: "x" },
  ]);

  assert.strictEqual(saved[0].bundledSecrets, undefined, "plaintext must not survive");
  assert.ok(saved[0].bundledSecretsEnc, "must have an encrypted field");
  assert.ok(!JSON.stringify(saved[0]).includes("hunter2"), "the secret must not appear in the stored record");
  assert.strictEqual(saved[0].name, "x", "other fields are preserved");
});

test("an empty bundledSecrets object is dropped, not encrypted", () => {
  const { prepareForSave } = makeScheduleSecrets(fakeCrypto());
  const saved = prepareForSave([{ id: "a", bundledSecrets: {} }]);
  assert.strictEqual(saved[0].bundledSecrets, undefined);
  assert.strictEqual(saved[0].bundledSecretsEnc, undefined, "nothing to protect, so no ciphertext");
});

test("getScheduleSecrets round-trips through real AES", () => {
  const c = realCrypto();
  const { prepareForSave, getScheduleSecrets } = makeScheduleSecrets(c);

  const secrets = { ZEPHYR_API_TOKEN: "abc", GITHUB_PAT: "def" };
  const [saved] = prepareForSave([{ id: "a", bundledSecrets: secrets }]);

  assert.deepStrictEqual(getScheduleSecrets(saved), secrets);
});

test("getScheduleSecrets reads a legacy plaintext record", () => {
  const { getScheduleSecrets } = makeScheduleSecrets(fakeCrypto());
  assert.deepStrictEqual(
    getScheduleSecrets({ bundledSecrets: { A: "1" } }),
    { A: "1" }
  );
});

test("getScheduleSecrets returns {} when there are no secrets", () => {
  const { getScheduleSecrets } = makeScheduleSecrets(fakeCrypto());
  assert.deepStrictEqual(getScheduleSecrets({}), {});
  assert.deepStrictEqual(getScheduleSecrets({ bundledSecrets: {} }), {});
});

test("a corrupt ciphertext yields {} rather than throwing", () => {
  const errors = [];
  const { getScheduleSecrets } = makeScheduleSecrets({
    ...realCrypto(),
    onError: (m) => errors.push(m),
  });

  const result = getScheduleSecrets({ bundledSecretsEnc: "not-valid-ciphertext" });
  assert.deepStrictEqual(result, {});
  assert.strictEqual(errors.length, 1, "the failure is reported, not silent");
});

test("hasPlaintext detects records needing migration", () => {
  const { hasPlaintext } = makeScheduleSecrets(fakeCrypto());
  assert.strictEqual(hasPlaintext([{ bundledSecrets: { A: "1" } }]), true);
  assert.strictEqual(hasPlaintext([{ bundledSecretsEnc: "enc:..." }]), false);
  assert.strictEqual(hasPlaintext([{ bundledSecrets: {} }, {}]), false);
});

test("re-saving an already-encrypted record does not double-encrypt", () => {
  const { prepareForSave, getScheduleSecrets } = makeScheduleSecrets(realCrypto());

  const once = prepareForSave([{ id: "a", bundledSecrets: { A: "1" } }]);
  const twice = prepareForSave(once); // no plaintext field this time

  assert.strictEqual(twice[0].bundledSecretsEnc, once[0].bundledSecretsEnc, "unchanged on re-save");
  assert.deepStrictEqual(getScheduleSecrets(twice[0]), { A: "1" });
});
