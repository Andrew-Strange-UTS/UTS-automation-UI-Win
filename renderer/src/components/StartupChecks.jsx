import { useState, useEffect } from "react";
import { BACKEND_URL } from "@/config";
import theme from "@/theme";

const STATUS_ICONS = {
  pass: "\u2705",   // green check
  fail: "\u274C",   // red X
  warn: "\u26A0\uFE0F",  // warning
};

function StatusBadge({ ok, warn }) {
  if (warn) return <span style={{ fontSize: "18px" }}>{STATUS_ICONS.warn}</span>;
  return <span style={{ fontSize: "18px" }}>{ok ? STATUS_ICONS.pass : STATUS_ICONS.fail}</span>;
}

export default function StartupChecks({ onDismiss }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch(`${BACKEND_URL}/api/health`)
      .then((res) => res.json())
      .then(setData)
      .catch((err) => setError(err.message));
  }, []);

  if (error) {
    return (
      <div style={{
        maxWidth: "700px", margin: "60px auto", padding: "30px",
        backgroundColor: "#fff", borderRadius: "12px", border: "1px solid #ccc",
        boxShadow: "0 4px 20px rgba(0,0,0,0.1)",
      }}>
        <h2 style={{ textAlign: "center", marginBottom: "16px" }}>Startup Checks</h2>
        <div style={{ color: "#dc2626", textAlign: "center", marginBottom: "20px" }}>
          Failed to connect to backend: {error}
        </div>
        <div style={{ textAlign: "center" }}>
          <button onClick={onDismiss} style={btnStyle}>Continue Anyway</button>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{
        maxWidth: "700px", margin: "60px auto", padding: "30px",
        backgroundColor: "#fff", borderRadius: "12px", border: "1px solid #ccc",
        boxShadow: "0 4px 20px rgba(0,0,0,0.1)", textAlign: "center",
      }}>
        <h2>Running startup checks...</h2>
      </div>
    );
  }

  const { checks, features, platform } = data;
  const isWindows = platform === "win32";

  const rows = [
    {
      label: "Node.js",
      check: checks.node,
      info: checks.node.version,
      required: true,
    },
    {
      label: "Operating System",
      check: checks.os,
      info: `${checks.os.detail} (${checks.os.version})`,
      required: true,
    },
    {
      label: "Git",
      check: checks.git,
      info: checks.git.ok ? `v${checks.git.version}` : checks.git.detail,
      required: true,
      feature: "Clone test repos from GitHub",
    },
    {
      label: "Google Chrome",
      check: checks.chrome,
      info: checks.chrome.ok
        ? `v${checks.chrome.version}${checks.chrome.binary ? ` (${checks.chrome.binary})` : ""}`
        : checks.chrome.detail,
      required: false,
      feature: "Web tests (Selenium)",
    },
    {
      label: "ChromeDriver",
      check: checks.chromedriver,
      info: checks.chromedriver.ok
        ? checks.chromedriver.version
        : checks.chromedriver.detail,
      warn: checks.chromedriver.ok && checks.chromedriver.detail,
      required: false,
      feature: "Web tests (Selenium)",
    },
    {
      label: "PowerShell",
      check: checks.powershell,
      info: checks.powershell.ok
        ? `v${checks.powershell.version}`
        : checks.powershell.detail,
      warn: !isWindows,
      required: false,
      feature: "Desktop tests (Windows only)",
    },
    {
      label: "Scheduler Service",
      check: checks.scheduler,
      info: checks.scheduler.ok
        ? `Running (${checks.scheduler.detail})`
        : checks.scheduler.detail,
      required: false,
      feature: "Scheduled test sequences",
    },
  ];

  const allCriticalOk = checks.node.ok && checks.os.ok;

  const featureSummary = [
    { name: "Web Tests", available: features.webTests, needs: "Chrome" },
    { name: "Desktop Tests", available: features.desktopTests, needs: "Windows + PowerShell" },
    { name: "Scheduling", available: features.scheduling, needs: "Scheduler service" },
    { name: "Git Clone", available: features.gitClone, needs: "Git" },
    { name: "Zephyr Reporting", available: features.zephyrReporting, needs: "ZEPHYR_API_TOKEN secret" },
  ];

  return (
    <div style={{
      maxWidth: "750px", margin: "40px auto", padding: "30px",
      backgroundColor: "#fff", borderRadius: "12px", border: "1px solid #ccc",
      boxShadow: "0 4px 20px rgba(0,0,0,0.1)",
    }}>
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: "12px", marginBottom: "6px" }}>
        <h2 style={{ margin: 0 }}>Marvin</h2>
        <img
          src="/img/marvin.png"
          alt="Marvin"
          style={{ height: "40px", width: "auto", objectFit: "contain" }}
          onError={(e) => { e.target.style.display = "none"; }}
        />
      </div>
      <p style={{ textAlign: "center", color: "#666", marginTop: 0, marginBottom: "24px", fontSize: "14px" }}>
        Startup diagnostics
      </p>

      {/* Dependency checks table */}
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "24px" }}>
        <thead>
          <tr style={{ borderBottom: "2px solid #eee" }}>
            <th style={{ textAlign: "left", padding: "8px 12px", fontSize: "13px", color: "#888" }}>Status</th>
            <th style={{ textAlign: "left", padding: "8px 12px", fontSize: "13px", color: "#888" }}>Dependency</th>
            <th style={{ textAlign: "left", padding: "8px 12px", fontSize: "13px", color: "#888" }}>Details</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} style={{ borderBottom: "1px solid #f0f0f0" }}>
              <td style={{ padding: "10px 12px", width: "50px" }}>
                <StatusBadge ok={row.check.ok} warn={row.warn && !row.check.ok} />
              </td>
              <td style={{ padding: "10px 12px", fontWeight: "600", fontSize: "14px" }}>
                {row.label}
                {row.required && <span style={{ color: theme.primary, marginLeft: "4px", fontSize: "11px" }}>required</span>}
              </td>
              <td style={{
                padding: "10px 12px", fontSize: "13px",
                color: row.check.ok ? "#333" : "#999",
              }}>
                {row.info}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Feature availability */}
      <div style={{
        backgroundColor: theme.primaryLight,
        border: `1px solid ${theme.primaryBorder}`,
        borderRadius: "8px",
        padding: "16px",
        marginBottom: "24px",
      }}>
        <h4 style={{ margin: "0 0 12px 0", color: theme.primary }}>Available Features</h4>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
          {featureSummary.map((f) => (
            <span
              key={f.name}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                padding: "6px 12px",
                borderRadius: "6px",
                fontSize: "13px",
                fontWeight: "600",
                backgroundColor: f.available ? "#f0fdf4" : "#fafafa",
                color: f.available ? "#16a34a" : "#999",
                border: `1px solid ${f.available ? "#86efac" : "#e5e5e5"}`,
              }}
              title={f.available ? "Ready" : `Requires: ${f.needs}`}
            >
              <span style={{ fontSize: "14px" }}>{f.available ? STATUS_ICONS.pass : STATUS_ICONS.fail}</span>
              {f.name}
            </span>
          ))}
        </div>
      </div>

      {/* Action buttons */}
      <div style={{ textAlign: "center" }}>
        <button onClick={onDismiss} style={btnStyle}>
          {allCriticalOk ? "Continue" : "Continue Anyway"}
        </button>
      </div>
    </div>
  );
}

const btnStyle = {
  padding: "12px 32px",
  fontSize: "16px",
  fontWeight: "bold",
  backgroundColor: theme.primary,
  color: theme.primaryText,
  border: "none",
  borderRadius: "6px",
  cursor: "pointer",
};
