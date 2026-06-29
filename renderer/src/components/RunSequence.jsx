//client/src/component/RunSequence.js 

import React, { useState } from "react";
import { BACKEND_URL } from "@/config";
import theme from "@/theme";

export default function RunSequence({
  sequence,
  testType = "desktop",
  executedBy = "",
  availableSecrets = [],
  onTestResult,
  onSequenceLog,
  onBeforeRun,
  onDryRunReport,
}) {
  const [isRunning, setIsRunning] = useState(false);

  // OKTA environment URLs
  const oktaUrls = {
    prod: "https://login.uts.edu.au",
    preprod: "https://login-preprod.uts.edu.au",
    test: "https://login-test.uts.edu.au",
  };

  // Construct full sequence with OKTA bookends if needed (web only)
  const buildWrappedSequence = () => {
    if (testType === "desktop") return [...sequence];
    const wrapped = [];
    const envGroups = { prod: [], preprod: [], test: [] };
    const noOktaTests = [];

    for (const t of sequence) {
      if (t.oktaEnv && t.oktaEnv !== "none" && envGroups[t.oktaEnv]) {
        envGroups[t.oktaEnv].push(t);
      } else {
        noOktaTests.push(t);
      }
    }

    for (const [env, tests] of Object.entries(envGroups)) {
      if (tests.length > 0) {
        wrapped.push({
          name: `OKTA Login (${env})`,
          builtin: "okta-login",
          oktaUrl: oktaUrls[env],
          visualBrowser: true,
        });
        wrapped.push(...tests);
        wrapped.push({
          name: `OKTA Finish (${env})`,
          builtin: "okta-login-finish",
          visualBrowser: true,
        });
      }
    }

    wrapped.push(...noOktaTests);
    return wrapped;
  };

  const wrappedSequence = buildWrappedSequence();

  // Dry run (EPEA-2516): validate each test card without executing anything.
  // Checks: filled parameters, referenced secrets exist, Zephyr key formats.
  const SECRET_REF_RE = /\$\{\{\s*secrets\.([A-Za-z0-9_]+)\s*\}\}/g;
  const ZEPHYR_FORMATS = {
    projectKey: /^[A-Z][A-Z0-9]+$/,
    caseKey: /^[A-Z][A-Z0-9]+-T\d+$/,
    cycleKey: /^[A-Z][A-Z0-9]+-R\d+$/,
  };
  const handleDryRun = () => {
    const logsByKey = {};
    const resultsByTest = {};
    let pass = 0, warn = 0, fail = 0;

    for (const test of wrappedSequence) {
      if (test.builtin) continue; // skip injected OKTA/builtin steps
      const items = [];
      const params = test.parameters || {};

      // Parameters
      const emptyParams = Object.keys(params).filter((k) => String(params[k] ?? "").trim() === "");
      if (emptyParams.length > 0) {
        items.push({ level: "FAIL", msg: `Empty required parameter(s): ${emptyParams.join(", ")}` });
      } else if (Object.keys(params).length > 0) {
        items.push({ level: "PASS", msg: `All ${Object.keys(params).length} parameter(s) populated` });
      }

      // Secret references
      const refs = new Set();
      for (const v of Object.values(params)) {
        if (typeof v !== "string") continue;
        let m;
        SECRET_REF_RE.lastIndex = 0;
        while ((m = SECRET_REF_RE.exec(v)) !== null) refs.add(m[1]);
      }
      const missing = [...refs].filter((s) => !availableSecrets.includes(s));
      if (missing.length > 0) {
        items.push({ level: "FAIL", msg: `References undefined secret(s): ${missing.join(", ")}` });
      } else if (refs.size > 0) {
        items.push({ level: "PASS", msg: `Referenced secret(s) exist: ${[...refs].join(", ")}` });
      }

      // Zephyr key formats
      if (test.zephyr) {
        for (const field of ["projectKey", "caseKey", "cycleKey"]) {
          const val = test.zephyr[field];
          if (val && !ZEPHYR_FORMATS[field].test(val)) {
            items.push({ level: "WARN", msg: `Zephyr ${field} "${val}" does not match expected format` });
          }
        }
        items.push({ level: "PASS", msg: `Zephyr keys present (${test.zephyr.caseKey || "?"})` });
      }

      if (items.length === 0) items.push({ level: "PASS", msg: "No configuration to validate" });

      const hasFail = items.some((i) => i.level === "FAIL");
      const hasWarn = items.some((i) => i.level === "WARN");
      const status = hasFail ? "❌ Dry run: fail" : hasWarn ? "⚠️ Dry run: warning" : "✅ Dry run: pass";
      if (hasFail) fail++; else if (hasWarn) warn++; else pass++;

      logsByKey[test.name] =
        `Dry run validation for "${test.name}"\n` +
        items.map((i) => `  [${i.level}] ${i.msg}`).join("\n") + "\n";
      resultsByTest[test.name] = { status, time: new Date().toLocaleString() };
    }

    logsByKey["[DRY RUN]"] =
      `Dry run complete (no tests executed).\n` +
      `Tests checked: ${pass + warn + fail}\n` +
      `  ✅ Pass: ${pass}\n  ⚠️ Warning: ${warn}\n  ❌ Fail: ${fail}\n`;

    if (onDryRunReport) onDryRunReport(logsByKey, resultsByTest);
  };

  // Sequence runner
  const handleRun = async () => {
    if (onBeforeRun) onBeforeRun(); // <== Clear logs BEFORE anything starts!!
    setIsRunning(true);
  

    // Prepare backend payload for sequence
    const simpleSeq = wrappedSequence.map((step) => ({
      name: step.name,
      ...(step.zephyr ? { zephyr: step.zephyr } : {}),
      ...(step.builtin ? { builtin: step.builtin } : {}),
      ...(step.oktaUrl ? { oktaUrl: step.oktaUrl } : {}),
    }));
    // Get all parameters per test
    const allParameters = {};
    for (const step of wrappedSequence) {
      if (step.parameters && Object.keys(step.parameters).length > 0) {
        allParameters[step.name] = step.parameters;
      }
    }

    const response = await fetch(`${BACKEND_URL}/api/sequence/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sequence: simpleSeq,
        parameters: allParameters,
        testType,
        executedBy,
      }),
    });
    if (!response.ok) {
      try {
        const err = await response.json();
        if (onSequenceLog) onSequenceLog(`❌ Error: ${err.error || "Unknown error"}`);
      } catch {
        if (onSequenceLog) onSequenceLog(`❌ Error: Server returned status ${response.status}`);
      }
      setIsRunning(false);
      return;
    }
    if (!response.body) {
      setIsRunning(false);
      return;
    }
    const reader = response.body.getReader();
    let fullText = "";
    function read() {
      reader.read().then(({ done, value }) => {
        if (done) {
          setIsRunning(false);
          return;
        }
        const chunk = new TextDecoder().decode(value);
        fullText += chunk;
        if (onSequenceLog) onSequenceLog(fullText);
        read();
      });
    }
    read();
  };

  return (
    <div
      style={{
        minWidth: "220px",
        width: "300px",
        flexShrink: 1,
        background: "#f7f7f7",
        borderLeft: "1px solid #ccc",
        padding: "20px",
        height: "100vh",
        overflowY: "auto",
        position: "sticky",
        top: 0,
      }}
    >
      <h3>Run Sequence</h3>
      <div style={{
        display: "inline-block",
        padding: "3px 10px",
        borderRadius: "4px",
        fontSize: "12px",
        fontWeight: "bold",
        marginBottom: "10px",
        backgroundColor: testType === "desktop" ? theme.primaryLight : "#f0fdf4",
        color: testType === "desktop" ? theme.primary : "#16a34a",
        border: `1px solid ${testType === "desktop" ? theme.primaryBorder : "#86efac"}`,
      }}>
        {testType === "desktop" ? "Desktop (Windows)" : "Web (Selenium)"}
      </div>
      <ol style={{ paddingLeft: 20 }}>
        {wrappedSequence.map((test, i) => (
          <li key={i} style={{ marginBottom: "8px" }}>
            {test.name}
            {test.zephyr && (
              <span style={{ marginLeft: "6px" }} title="Zephyr Scale enabled">🚩</span>
            )}
            {test.visualBrowser && (
              <span style={{ color: theme.primary, marginLeft: "6px" }}>👁</span>
            )}
          </li>
        ))}
      </ol>
      {wrappedSequence.length > 0 && (
        <button
          onClick={handleRun}
          disabled={isRunning}
          style={{
            marginTop: "20px",
            padding: "10px 15px",
            background: isRunning ? "#aaa" : theme.primary,
            color: "white",
            border: "none",
            borderRadius: "5px",
            width: "100%",
            fontSize: "16px",
            fontWeight: "bold",
            cursor: isRunning ? "not-allowed" : "pointer",
            opacity: isRunning ? 0.75 : 1,
          }}
        >
          {isRunning ? "Running..." : "▶ Run Sequence"}
        </button>
      )}
      {wrappedSequence.length > 0 && (
        <button
          onClick={handleDryRun}
          disabled={isRunning}
          title="Validate parameters, secrets and Zephyr keys without running any test"
          style={{
            marginTop: "10px",
            padding: "9px 15px",
            background: "#fff",
            color: theme.primary,
            border: `2px solid ${theme.primary}`,
            borderRadius: "5px",
            width: "100%",
            fontSize: "14px",
            fontWeight: "bold",
            cursor: isRunning ? "not-allowed" : "pointer",
            opacity: isRunning ? 0.6 : 1,
          }}
        >
          🧪 Dry Run (validate only)
        </button>
      )}
    </div>
  );
}