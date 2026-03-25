// server/builtins/okta-login-finish.js
// Built-in OKTA login finish step. No-op — browser closure is handled
// by the sequence runner.

function log(msg) {
  process.stdout.write(`${msg}\n`);
}

module.exports = async function (driver, parameters = {}) {
  log(
    "🧼 OKTA Login Finish — test group complete. Browser will be closed by the runner."
  );
};
