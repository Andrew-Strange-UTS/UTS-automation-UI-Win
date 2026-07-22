// server/utils/scheduleSecrets.js
// Keep bundled schedule secrets encrypted at rest.
//
// A schedule carries the creating user's secrets so the LocalSystem scheduler
// service can run it without reaching that user's per-user store. Those secrets
// must never sit as plaintext in the shared schedules.json, so they are stored
// in a `bundledSecretsEnc` string and only decrypted at run or export time.
//
// The crypto itself is injected (the service's machine-key encrypt/decrypt), so
// these transforms stay pure and testable.

/**
 * @param {object} deps
 * @param {(obj:any)=>string} deps.encrypt
 * @param {(str:string)=>any} deps.decrypt
 * @param {(msg:string)=>void} [deps.onError]
 */
function makeScheduleSecrets({ encrypt, decrypt, onError = () => {} }) {
  // Resolve a schedule's bundled secrets to plaintext. Handles the encrypted
  // field, a legacy plaintext field, or neither.
  function getScheduleSecrets(schedule) {
    if (schedule && schedule.bundledSecretsEnc) {
      try {
        return decrypt(schedule.bundledSecretsEnc) || {};
      } catch (e) {
        onError(`Could not decrypt bundled secrets: ${e.message}`);
        return {};
      }
    }
    if (schedule && schedule.bundledSecrets && Object.keys(schedule.bundledSecrets).length > 0) {
      return { ...schedule.bundledSecrets };
    }
    return {};
  }

  // Convert one schedule to its at-rest form: any plaintext `bundledSecrets`
  // becomes `bundledSecretsEnc`; an empty object is dropped entirely.
  function toAtRest(schedule) {
    if (schedule.bundledSecrets && Object.keys(schedule.bundledSecrets).length > 0) {
      const { bundledSecrets, ...rest } = schedule;
      return { ...rest, bundledSecretsEnc: encrypt(bundledSecrets) };
    }
    if (schedule.bundledSecrets) {
      const { bundledSecrets, ...rest } = schedule;
      return rest;
    }
    return schedule;
  }

  function prepareForSave(schedules) {
    return schedules.map(toAtRest);
  }

  // True if any schedule still holds plaintext secrets (used to decide whether
  // a one-time migration rewrite is needed).
  function hasPlaintext(schedules) {
    return schedules.some(
      (s) => s.bundledSecrets && Object.keys(s.bundledSecrets).length > 0
    );
  }

  return { getScheduleSecrets, toAtRest, prepareForSave, hasPlaintext };
}

module.exports = { makeScheduleSecrets };
