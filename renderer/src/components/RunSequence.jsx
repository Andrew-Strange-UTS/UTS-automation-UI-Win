//client/src/component/RunSequence.js 

import React, { useState } from "react";
import { BACKEND_URL } from "@/config";
import theme from "@/theme";

export default function RunSequence({
  sequence,
  testType = "desktop",
  onTestResult,
  onSequenceLog,
  onBeforeRun,
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
    </div>
  );
}