// server/utils/zephyr.js
// Utility to POST test execution results to the Zephyr Scale API.
// API docs: https://support.smartbear.com/zephyr-scale-cloud/api-docs/

const https = require("https");

/**
 * Posts a test execution result to Zephyr Scale.
 * @param {string} token - Zephyr API bearer token
 * @param {object} opts
 * @param {string} opts.projectKey
 * @param {string} opts.testCaseKey
 * @param {string} opts.testCycleKey
 * @param {string} opts.statusName        - overall "Pass" or "Fail"
 * @param {string} [opts.comment]         - optional overall execution comment
 * @param {string} [opts.executedBy]      - optional tester name; recorded as "Executed by"
 * @param {Array}  [opts.testScriptResults] - per-step results array
 *   Each entry: { statusName: "Pass"|"Fail", actualResult: "description" }
 * @returns {Promise<{statusCode: number, body: string}>}
 */
function postTestExecution(token, { projectKey, testCaseKey, testCycleKey, statusName, comment, executedBy, testScriptResults }) {
  return new Promise((resolve, reject) => {
    // The Zephyr Scale Cloud API only accepts an Atlassian account id for the
    // native "executedById" field, so a free-text tester name is surfaced in the
    // execution comment as "Executed by: <name>".
    const executedByLine = executedBy ? `Executed by: ${executedBy}` : "";
    const fullComment = [executedByLine, comment].filter(Boolean).join("\n") || undefined;
    const payload = JSON.stringify({
      projectKey,
      testCaseKey,
      testCycleKey,
      statusName,
      ...(fullComment ? { comment: fullComment } : {}),
      ...(testScriptResults && testScriptResults.length > 0 ? { testScriptResults } : {}),
    });

    const options = {
      hostname: "api.zephyrscale.smartbear.com",
      port: 443,
      path: "/v2/testexecutions",
      method: "POST",
      headers: {
        "Authorization": "Bearer " + token,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        resolve({ statusCode: res.statusCode, body: data });
      });
    });

    req.on("error", (err) => {
      reject(err);
    });

    req.write(payload);
    req.end();
  });
}

module.exports = { postTestExecution };
