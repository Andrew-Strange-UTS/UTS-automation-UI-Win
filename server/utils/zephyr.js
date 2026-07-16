// server/utils/zephyr.js
// Utility to POST test execution results to the Zephyr Scale API.
// API docs: https://support.smartbear.com/zephyr-scale-cloud/api-docs/

const https = require("https");

/**
 * Builds the JSON body for a Zephyr Scale test execution.
 * Kept as a pure function so the field logic can be unit tested without a network call.
 * @param {object} opts
 * @param {string} opts.projectKey
 * @param {string} opts.testCaseKey
 * @param {string} opts.testCycleKey
 * @param {string} opts.statusName        - overall "Pass" or "Fail"
 * @param {string} [opts.comment]         - optional overall execution comment
 * @param {string} [opts.executedBy]      - free-text tester name (fallback only)
 * @param {string} [opts.accountId]       - Atlassian account id for the native identity fields
 * @param {Array}  [opts.testScriptResults] - per-step results array
 * @returns {object} the request payload object
 */
function buildExecutionPayload({ projectKey, testCaseKey, testCycleKey, statusName, comment, executedBy, accountId, testScriptResults }) {
  // EPEA-3469: when an Atlassian account id is provided, populate the native
  // Zephyr identity fields. "executedById" records who ran the test and
  // "assignedToId" assigns the case within the cycle, so it no longer shows
  // as "Unassigned".
  const resolvedAccountId = typeof accountId === "string" ? accountId.trim() : "";
  const hasAccountId = resolvedAccountId !== "";

  // EPEA-2692 fallback: the Zephyr Cloud API only accepts an account id (not a
  // free-text name) on the native field, so without one we surface the tester
  // name in the execution comment as "Executed by: <name>" as before.
  const executedByLine = !hasAccountId && executedBy ? `Executed by: ${executedBy}` : "";
  const fullComment = [executedByLine, comment].filter(Boolean).join("\n") || undefined;

  return {
    projectKey,
    testCaseKey,
    testCycleKey,
    statusName,
    ...(hasAccountId ? { executedById: resolvedAccountId, assignedToId: resolvedAccountId } : {}),
    ...(fullComment ? { comment: fullComment } : {}),
    ...(testScriptResults && testScriptResults.length > 0 ? { testScriptResults } : {}),
  };
}

/**
 * Posts a test execution result to Zephyr Scale.
 * @param {string} token - Zephyr API bearer token
 * @param {object} opts - see buildExecutionPayload
 * @returns {Promise<{statusCode: number, body: string}>}
 */
function postTestExecution(token, opts) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(buildExecutionPayload(opts));

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

module.exports = { postTestExecution, buildExecutionPayload };
