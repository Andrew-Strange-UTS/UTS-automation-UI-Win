
import React, { useState, useEffect, useCallback } from "react";
import { BACKEND_URL } from "@/config";

const DAYS = [
  { key: "mon", label: "Mon" },
  { key: "tue", label: "Tue" },
  { key: "wed", label: "Wed" },
  { key: "thu", label: "Thu" },
  { key: "fri", label: "Fri" },
  { key: "sat", label: "Sat" },
  { key: "sun", label: "Sun" },
];

const PRESETS = [
  { label: "Weekdays (M-F)", days: ["mon", "tue", "wed", "thu", "fri"] },
  { label: "Weekends", days: ["sat", "sun"] },
  { label: "Every day", days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] },
  { label: "Monday only", days: ["mon"] },
];

const DAY_INDEX = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

function getNextRunDate(time, days) {
  if (!time || !days || days.length === 0) return null;
  const [hour, minute] = time.split(":").map(Number);
  const now = new Date();
  const dayNums = days.map((d) => DAY_INDEX[d]).sort((a, b) => a - b);

  for (let offset = 0; offset < 8; offset++) {
    const candidate = new Date(now);
    candidate.setDate(candidate.getDate() + offset);
    candidate.setHours(hour, minute, 0, 0);
    if (dayNums.includes(candidate.getDay()) && candidate > now) {
      return candidate;
    }
  }
  return null;
}

function formatCountdown(ms) {
  if (ms <= 0) return "now";
  const totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);
  return parts.join(" ");
}

function Countdown({ time, days, status }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  if (status !== "active") return null;
  const nextRun = getNextRunDate(time, days);
  if (!nextRun) return null;
  const ms = nextRun.getTime() - now;

  return (
    <span style={{ marginLeft: "16px", color: "#7c3aed", fontWeight: "bold" }}>
      Next run in {formatCountdown(ms)}
    </span>
  );
}

export default function SchedulePanel({ sequencePayload, stepNames }) {
  const [schedules, setSchedules] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [time, setTime] = useState("09:00");
  const [selectedDays, setSelectedDays] = useState(["mon", "tue", "wed", "thu", "fri"]);
  const [ntfyTopic, setNtfyTopic] = useState("");
  const [teamsWebhookAll, setTeamsWebhookAll] = useState("");
  const [teamsWebhookFail, setTeamsWebhookFail] = useState("");
  const [expandedLogs, setExpandedLogs] = useState({});
  const [logData, setLogData] = useState({});
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState("");
  const [editTime, setEditTime] = useState("");
  // Export/Import state
  const [exportingId, setExportingId] = useState(null);
  const [exportPassword, setExportPassword] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [importPassword, setImportPassword] = useState("");
  const [importFile, setImportFile] = useState(null);
  const [importResult, setImportResult] = useState(null);
  const [editDays, setEditDays] = useState([]);
  const [editNtfyTopic, setEditNtfyTopic] = useState("");
  const [editTeamsWebhookAll, setEditTeamsWebhookAll] = useState("");
  const [editTeamsWebhookFail, setEditTeamsWebhookFail] = useState("");

  const fetchSchedules = useCallback(async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/schedules`);
      if (res.ok) {
        const data = await res.json();
        setSchedules(data.schedules || []);
      }
    } catch (e) {
      console.error("Failed to fetch schedules:", e);
    }
  }, []);

  useEffect(() => {
    fetchSchedules();
    const interval = setInterval(fetchSchedules, 5000);
    return () => clearInterval(interval);
  }, [fetchSchedules]);

  const toggleDay = (day) => {
    setSelectedDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
    );
  };

  const handleCreate = async () => {
    if (!name.trim() || selectedDays.length === 0) return;
    if (!sequencePayload || !sequencePayload.sequence?.length) {
      alert("No sequence to schedule. Add tests to the sequence first.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/schedules`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          sequencePayload,
          time,
          days: selectedDays,
          ntfyTopic: ntfyTopic.trim(),
          teamsWebhookAll: teamsWebhookAll.trim(),
          teamsWebhookFail: teamsWebhookFail.trim(),
        }),
      });
      if (res.ok) {
        setName("");
        setShowCreate(false);
        fetchSchedules();
      } else {
        const err = await res.json();
        alert(err.error || "Failed to create schedule");
      }
    } catch (e) {
      alert("Failed to create schedule");
    } finally {
      setLoading(false);
    }
  };

  const handleAction = async (id, action) => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/schedules/${id}/${action}`, {
        method: "POST",
      });
      if (res.ok) fetchSchedules();
      else {
        const err = await res.json();
        alert(err.error || `Failed to ${action}`);
      }
    } catch (e) {
      alert(`Failed to ${action}`);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm("Delete this schedule?")) return;
    try {
      await fetch(`${BACKEND_URL}/api/schedules/${id}`, { method: "DELETE" });
      fetchSchedules();
    } catch (e) {
      alert("Failed to delete");
    }
  };

  const startEdit = (s) => {
    setEditingId(s.id);
    setEditName(s.name);
    setEditTime(s.time);
    setEditDays([...(s.days || [])]);
    setEditNtfyTopic(s.ntfyTopic || "");
    setEditTeamsWebhookAll(s.teamsWebhookAll || "");
    setEditTeamsWebhookFail(s.teamsWebhookFail || "");
  };

  const cancelEdit = () => {
    setEditingId(null);
  };

  const toggleEditDay = (day) => {
    setEditDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
    );
  };

  const handleSaveEdit = async () => {
    if (!editName.trim() || editDays.length === 0) return;
    try {
      const res = await fetch(`${BACKEND_URL}/api/schedules/${editingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName.trim(),
          time: editTime,
          days: editDays,
          ntfyTopic: editNtfyTopic.trim(),
          teamsWebhookAll: editTeamsWebhookAll.trim(),
          teamsWebhookFail: editTeamsWebhookFail.trim(),
        }),
      });
      if (res.ok) {
        setEditingId(null);
        fetchSchedules();
      } else {
        const err = await res.json();
        alert(err.error || "Failed to update schedule");
      }
    } catch (e) {
      alert("Failed to update schedule");
    }
  };

  const handleExport = async (id) => {
    if (!exportPassword || exportPassword.length < 4) {
      alert("Password must be at least 4 characters");
      return;
    }
    try {
      const res = await fetch(`${BACKEND_URL}/api/schedules/${id}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: exportPassword }),
      });
      if (!res.ok) {
        const err = await res.json();
        alert(err.error || "Export failed");
        return;
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") || "";
      const match = disposition.match(/filename="(.+?)"/);
      const filename = match ? match[1] : "schedule.utsb";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      setExportingId(null);
      setExportPassword("");
    } catch (e) {
      alert("Export failed");
    }
  };

  const handleImport = async () => {
    if (!importFile || !importPassword) {
      alert("Select a .utsb file and enter the password");
      return;
    }
    try {
      const fileData = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const base64 = reader.result.split(",")[1];
          resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(importFile);
      });
      const res = await fetch(`${BACKEND_URL}/api/schedules/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileData, password: importPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Import failed");
        return;
      }
      setImportResult(data);
      setImportFile(null);
      setImportPassword("");
      fetchSchedules();
    } catch (e) {
      alert("Import failed");
    }
  };

  const toggleLogs = async (id) => {
    if (expandedLogs[id]) {
      setExpandedLogs((prev) => ({ ...prev, [id]: false }));
      return;
    }
    try {
      const res = await fetch(`${BACKEND_URL}/api/schedules/${id}/logs`);
      if (res.ok) {
        const data = await res.json();
        setLogData((prev) => ({ ...prev, [id]: data.logs }));
      }
    } catch (e) {}
    setExpandedLogs((prev) => ({ ...prev, [id]: true }));
  };

  const statusColors = {
    active: "#16a34a",
    paused: "#ca8a04",
    stopped: "#dc2626",
  };

  const btnStyle = (bg) => ({
    padding: "5px 10px",
    fontSize: "12px",
    backgroundColor: bg,
    color: "white",
    border: "none",
    borderRadius: "4px",
    cursor: "pointer",
    marginRight: "4px",
  });

  return (
    <div
      style={{
        width: "1400px",
        margin: "30px auto",
        backgroundColor: "#fafafa",
        borderRadius: "10px",
        padding: "20px",
        border: "1px solid #ccc",
        boxShadow: "0 2px 6px rgba(0,0,0,0.06)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "15px" }}>
        <h2 style={{ margin: 0 }}>Scheduled Sequences</h2>
        <button
          onClick={() => setShowCreate(!showCreate)}
          style={{
            padding: "8px 16px",
            fontSize: "14px",
            backgroundColor: "#7c3aed",
            color: "white",
            border: "none",
            borderRadius: "5px",
            cursor: "pointer",
            fontWeight: "bold",
          }}
        >
          {showCreate ? "Cancel" : "+ New Schedule"}
        </button>
        <button
          onClick={() => { setShowImport(!showImport); setImportResult(null); }}
          style={{
            padding: "8px 16px",
            fontSize: "14px",
            backgroundColor: "#7c3aed",
            color: "white",
            border: "none",
            borderRadius: "5px",
            cursor: "pointer",
            fontWeight: "bold",
          }}
        >
          {showImport ? "Cancel Import" : "Import Schedule"}
        </button>
      </div>

      {showImport && (
        <div
          style={{
            backgroundColor: "#e0ecf9",
            borderRadius: "8px",
            padding: "16px",
            marginBottom: "16px",
            border: "1px solid #b3cde8",
          }}
        >
          <h4 style={{ margin: "0 0 12px 0" }}>Import Encrypted Schedule (.utsb)</h4>
          <div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap", marginBottom: "12px" }}>
            <input
              type="file"
              accept=".utsb,.enc"
              onChange={(e) => setImportFile(e.target.files[0] || null)}
              style={{ fontSize: "13px" }}
            />
            <label style={{ fontSize: "13px" }}>
              Password:
              <input
                type="password"
                value={importPassword}
                onChange={(e) => setImportPassword(e.target.value)}
                placeholder="Decryption password"
                style={{ marginLeft: "6px", padding: "5px 8px", borderRadius: "4px", border: "1px solid #ccc", width: "200px" }}
              />
            </label>
            <button
              onClick={handleImport}
              disabled={!importFile || !importPassword}
              style={{
                padding: "6px 16px",
                fontSize: "13px",
                fontWeight: "bold",
                backgroundColor: !importFile || !importPassword ? "#aaa" : "#2563eb",
                color: "white",
                border: "none",
                borderRadius: "4px",
                cursor: !importFile || !importPassword ? "not-allowed" : "pointer",
              }}
            >
              Import
            </button>
          </div>
          {importResult && (
            <div style={{ fontSize: "13px", color: "#16a34a", fontWeight: "bold" }}>
              Imported "{importResult.name || "schedule"}" successfully.
              {importResult.imported?.secrets?.length > 0 && (
                <span> Secrets added: {importResult.imported.secrets.join(", ")}.</span>
              )}
              {importResult.imported?.tests?.length > 0 && (
                <span> Tests written: {importResult.imported.tests.join(", ")}.</span>
              )}
            </div>
          )}
        </div>
      )}

      {showCreate && (
        <div
          style={{
            backgroundColor: "#f0ecf9",
            borderRadius: "8px",
            padding: "16px",
            marginBottom: "16px",
            border: "1px solid #d4c8f0",
          }}
        >
          <h4 style={{ margin: "0 0 12px 0" }}>Schedule Current Sequence</h4>
          {stepNames && stepNames.length > 0 && (
            <div style={{ marginBottom: "12px", fontSize: "13px", color: "#555" }}>
              Steps: {stepNames.join(" > ")}
            </div>
          )}

          <div style={{ display: "flex", gap: "12px", alignItems: "center", marginBottom: "12px", flexWrap: "wrap" }}>
            <label>
              Name:
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Morning Regression"
                style={{
                  marginLeft: "6px",
                  padding: "6px 10px",
                  borderRadius: "4px",
                  border: "1px solid #ccc",
                  width: "220px",
                }}
              />
            </label>
            <label>
              Time:
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                style={{
                  marginLeft: "6px",
                  padding: "6px 10px",
                  borderRadius: "4px",
                  border: "1px solid #ccc",
                }}
              />
            </label>
          </div>

          <div style={{ marginBottom: "12px" }}>
            <span style={{ fontWeight: "bold", marginRight: "8px" }}>Days:</span>
            {DAYS.map((d) => (
              <label
                key={d.key}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  marginRight: "10px",
                  cursor: "pointer",
                  padding: "4px 8px",
                  borderRadius: "4px",
                  backgroundColor: selectedDays.includes(d.key) ? "#7c3aed" : "#e5e7eb",
                  color: selectedDays.includes(d.key) ? "white" : "#333",
                  fontWeight: selectedDays.includes(d.key) ? "bold" : "normal",
                  transition: "all 0.15s",
                }}
              >
                <input
                  type="checkbox"
                  checked={selectedDays.includes(d.key)}
                  onChange={() => toggleDay(d.key)}
                  style={{ display: "none" }}
                />
                {d.label}
              </label>
            ))}
          </div>

          <div style={{ marginBottom: "12px", display: "flex", gap: "6px", flexWrap: "wrap" }}>
            {PRESETS.map((p) => (
              <button
                key={p.label}
                onClick={() => setSelectedDays(p.days)}
                style={{
                  padding: "4px 10px",
                  fontSize: "12px",
                  backgroundColor: "#e5e7eb",
                  border: "1px solid #ccc",
                  borderRadius: "4px",
                  cursor: "pointer",
                }}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div style={{ marginBottom: "12px", padding: "12px", backgroundColor: "#e8e0f3", borderRadius: "6px", border: "1px solid #d4c8f0" }}>
            <strong style={{ fontSize: "13px" }}>Notifications</strong>
            <div style={{ display: "flex", gap: "12px", alignItems: "center", marginTop: "8px", flexWrap: "wrap" }}>
              <label style={{ fontSize: "13px" }}>
                ntfy topic:
                <input
                  type="text"
                  value={ntfyTopic}
                  onChange={(e) => setNtfyTopic(e.target.value)}
                  placeholder="e.g. my-uts-tests"
                  style={{ marginLeft: "6px", padding: "5px 8px", borderRadius: "4px", border: "1px solid #ccc", width: "180px" }}
                />
              </label>
              <label style={{ fontSize: "13px" }}>
                Teams webhook (all results):
                <input
                  type="text"
                  value={teamsWebhookAll}
                  onChange={(e) => setTeamsWebhookAll(e.target.value)}
                  placeholder="https://outlook.office.com/webhook/..."
                  style={{ marginLeft: "6px", padding: "5px 8px", borderRadius: "4px", border: "1px solid #ccc", width: "320px" }}
                />
              </label>
              <label style={{ fontSize: "13px" }}>
                Teams webhook (failures only):
                <input
                  type="text"
                  value={teamsWebhookFail}
                  onChange={(e) => setTeamsWebhookFail(e.target.value)}
                  placeholder="https://outlook.office.com/webhook/..."
                  style={{ marginLeft: "6px", padding: "5px 8px", borderRadius: "4px", border: "1px solid #ccc", width: "320px" }}
                />
              </label>
            </div>
            <div style={{ marginTop: "6px", fontSize: "11px", color: "#666" }}>
              ntfy: install the ntfy app and subscribe to your topic. Teams: create an Incoming Webhook connector in your channel. Failure webhook includes logs.
            </div>
          </div>

          <button
            onClick={handleCreate}
            disabled={loading || !name.trim() || selectedDays.length === 0}
            style={{
              padding: "8px 20px",
              fontSize: "14px",
              fontWeight: "bold",
              backgroundColor: loading ? "#aaa" : "#16a34a",
              color: "white",
              border: "none",
              borderRadius: "5px",
              cursor: loading ? "not-allowed" : "pointer",
            }}
          >
            {loading ? "Creating..." : "Create Schedule"}
          </button>
        </div>
      )}

      {schedules.length === 0 ? (
        <p style={{ color: "#888", fontStyle: "italic" }}>No schedules yet. Create one from your current sequence.</p>
      ) : (
        <div>
          {schedules.map((s) => (
            <div
              key={s.id}
              style={{
                backgroundColor: "white",
                borderRadius: "8px",
                padding: "14px 16px",
                marginBottom: "10px",
                border: "1px solid #ddd",
                boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <strong style={{ fontSize: "15px" }}>{s.name}</strong>
                  <span
                    style={{
                      marginLeft: "10px",
                      padding: "2px 8px",
                      borderRadius: "10px",
                      fontSize: "11px",
                      fontWeight: "bold",
                      color: "white",
                      backgroundColor: statusColors[s.status] || "#888",
                      textTransform: "uppercase",
                    }}
                  >
                    {s.status}
                  </span>
                  {s.isRunning && (
                    <span
                      style={{
                        marginLeft: "6px",
                        padding: "2px 8px",
                        borderRadius: "10px",
                        fontSize: "11px",
                        fontWeight: "bold",
                        color: "white",
                        backgroundColor: "#2563eb",
                      }}
                    >
                      RUNNING
                    </span>
                  )}
                </div>
                <div>
                  {s.status !== "active" && (
                    <button onClick={() => handleAction(s.id, "resume")} style={btnStyle("#16a34a")}>
                      Resume
                    </button>
                  )}
                  {s.status === "active" && (
                    <button onClick={() => handleAction(s.id, "pause")} style={btnStyle("#ca8a04")}>
                      Pause
                    </button>
                  )}
                  {!s.isRunning && (
                    <button onClick={() => handleAction(s.id, "run")} style={btnStyle("#2563eb")}>
                      Run Now
                    </button>
                  )}
                  {s.isRunning && (
                    <button onClick={() => handleAction(s.id, "stop")} style={btnStyle("#dc2626")}>
                      Stop
                    </button>
                  )}
                  <button onClick={() => startEdit(s)} style={btnStyle("#7c3aed")}>
                    Edit
                  </button>
                  <button onClick={() => { setExportingId(exportingId === s.id ? null : s.id); setExportPassword(""); }} style={btnStyle("#0891b2")}>
                    Export
                  </button>
                  <button onClick={() => toggleLogs(s.id)} style={btnStyle("#6b7280")}>
                    {expandedLogs[s.id] ? "Hide Logs" : "Logs"}
                  </button>
                  <button onClick={() => handleDelete(s.id)} style={btnStyle("#dc2626")}>
                    Delete
                  </button>
                </div>
              </div>

              {exportingId === s.id && (
                <div style={{ marginTop: "8px", display: "flex", gap: "8px", alignItems: "center", padding: "8px 12px", backgroundColor: "#e0f7fa", borderRadius: "6px", border: "1px solid #b2ebf2" }}>
                  <label style={{ fontSize: "12px" }}>
                    Encryption password:
                    <input
                      type="password"
                      value={exportPassword}
                      onChange={(e) => setExportPassword(e.target.value)}
                      placeholder="Min 4 characters"
                      style={{ marginLeft: "6px", padding: "4px 8px", borderRadius: "4px", border: "1px solid #ccc", width: "180px" }}
                    />
                  </label>
                  <button
                    onClick={() => handleExport(s.id)}
                    disabled={exportPassword.length < 4}
                    style={{
                      ...btnStyle(exportPassword.length < 4 ? "#aaa" : "#0891b2"),
                      cursor: exportPassword.length < 4 ? "not-allowed" : "pointer",
                    }}
                  >
                    Download .utsb
                  </button>
                  <button onClick={() => setExportingId(null)} style={btnStyle("#6b7280")}>
                    Cancel
                  </button>
                </div>
              )}

              <div style={{ marginTop: "6px", fontSize: "13px", color: "#555" }}>
                <span>
                  {s.time} on{" "}
                  {s.days
                    ?.map((d) => d.charAt(0).toUpperCase() + d.slice(1))
                    .join(", ")}
                </span>
                <Countdown time={s.time} days={s.days} status={s.status} />
                {s.lastRun && (
                  <span style={{ marginLeft: "16px" }}>
                    Last run: {(() => { const d = new Date(s.lastRun); return `${String(d.getDate()).padStart(2, "0")}/${d.toLocaleString("en-US", { month: "short" })}/${d.getFullYear()}, ${d.toLocaleString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true })}`; })()} -{" "}
                    <span
                      style={{
                        fontWeight: "bold",
                        color: s.lastResult === "passed" ? "#16a34a" : "#dc2626",
                      }}
                    >
                      {s.lastResult}
                    </span>
                  </span>
                )}
              </div>

              {s.stepNames && s.stepNames.length > 0 && (
                <div style={{ marginTop: "4px", fontSize: "12px", color: "#888" }}>
                  Steps: {s.stepNames.join(" > ")}
                </div>
              )}

              {s.zephyrSteps && s.zephyrSteps.length > 0 && (
                <div style={{ marginTop: "6px", fontSize: "12px", color: "#6b21a8" }}>
                  Zephyr results will be exported to:{" "}
                  {s.zephyrSteps.map((z, i) => (
                    <span key={i}>
                      {i > 0 && " | "}
                      <strong>{z.name}</strong>{" "}
                      <span style={{ color: "#555" }}>
                        (Project: {z.projectKey}, Case: {z.caseKey}, Cycle: {z.cycleKey})
                      </span>
                    </span>
                  ))}
                </div>
              )}

              {(s.ntfyTopic || s.teamsWebhookAll || s.teamsWebhookFail) && (
                <div style={{ marginTop: "4px", fontSize: "12px", color: "#555" }}>
                  Notifications:{" "}
                  {s.ntfyTopic && <span style={{ marginRight: "10px" }}>ntfy: <strong>{s.ntfyTopic}</strong></span>}
                  {s.teamsWebhookAll && <span style={{ marginRight: "10px" }}>Teams (all results) ✓</span>}
                  {s.teamsWebhookFail && <span>Teams (failures + logs) ✓</span>}
                </div>
              )}

              {editingId === s.id && (
                <div
                  style={{
                    marginTop: "10px",
                    backgroundColor: "#f0ecf9",
                    borderRadius: "8px",
                    padding: "14px",
                    border: "1px solid #d4c8f0",
                  }}
                >
                  <div style={{ display: "flex", gap: "12px", alignItems: "center", marginBottom: "10px", flexWrap: "wrap" }}>
                    <label>
                      Name:
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        style={{
                          marginLeft: "6px",
                          padding: "6px 10px",
                          borderRadius: "4px",
                          border: "1px solid #ccc",
                          width: "220px",
                        }}
                      />
                    </label>
                    <label>
                      Time:
                      <input
                        type="time"
                        value={editTime}
                        onChange={(e) => setEditTime(e.target.value)}
                        style={{
                          marginLeft: "6px",
                          padding: "6px 10px",
                          borderRadius: "4px",
                          border: "1px solid #ccc",
                        }}
                      />
                    </label>
                  </div>
                  <div style={{ marginBottom: "10px" }}>
                    <span style={{ fontWeight: "bold", marginRight: "8px" }}>Days:</span>
                    {DAYS.map((d) => (
                      <label
                        key={d.key}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          marginRight: "10px",
                          cursor: "pointer",
                          padding: "4px 8px",
                          borderRadius: "4px",
                          backgroundColor: editDays.includes(d.key) ? "#7c3aed" : "#e5e7eb",
                          color: editDays.includes(d.key) ? "white" : "#333",
                          fontWeight: editDays.includes(d.key) ? "bold" : "normal",
                          transition: "all 0.15s",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={editDays.includes(d.key)}
                          onChange={() => toggleEditDay(d.key)}
                          style={{ display: "none" }}
                        />
                        {d.label}
                      </label>
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "10px" }}>
                    {PRESETS.map((p) => (
                      <button
                        key={p.label}
                        onClick={() => setEditDays(p.days)}
                        style={{
                          padding: "4px 10px",
                          fontSize: "12px",
                          backgroundColor: "#e5e7eb",
                          border: "1px solid #ccc",
                          borderRadius: "4px",
                          cursor: "pointer",
                        }}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                  <div style={{ marginBottom: "10px", padding: "10px", backgroundColor: "#e8e0f3", borderRadius: "6px", border: "1px solid #d4c8f0" }}>
                    <strong style={{ fontSize: "12px" }}>Notifications</strong>
                    <div style={{ display: "flex", gap: "10px", alignItems: "center", marginTop: "6px", flexWrap: "wrap" }}>
                      <label style={{ fontSize: "12px" }}>
                        ntfy topic:
                        <input
                          type="text"
                          value={editNtfyTopic}
                          onChange={(e) => setEditNtfyTopic(e.target.value)}
                          placeholder="e.g. my-uts-tests"
                          style={{ marginLeft: "4px", padding: "4px 8px", borderRadius: "4px", border: "1px solid #ccc", width: "160px" }}
                        />
                      </label>
                      <label style={{ fontSize: "12px" }}>
                        Teams webhook (all results):
                        <input
                          type="text"
                          value={editTeamsWebhookAll}
                          onChange={(e) => setEditTeamsWebhookAll(e.target.value)}
                          placeholder="https://outlook.office.com/webhook/..."
                          style={{ marginLeft: "4px", padding: "4px 8px", borderRadius: "4px", border: "1px solid #ccc", width: "280px" }}
                        />
                      </label>
                      <label style={{ fontSize: "12px" }}>
                        Teams webhook (failures + logs):
                        <input
                          type="text"
                          value={editTeamsWebhookFail}
                          onChange={(e) => setEditTeamsWebhookFail(e.target.value)}
                          placeholder="https://outlook.office.com/webhook/..."
                          style={{ marginLeft: "4px", padding: "4px 8px", borderRadius: "4px", border: "1px solid #ccc", width: "280px" }}
                        />
                      </label>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <button
                      onClick={handleSaveEdit}
                      disabled={!editName.trim() || editDays.length === 0}
                      style={{
                        padding: "6px 16px",
                        fontSize: "13px",
                        fontWeight: "bold",
                        backgroundColor: "#16a34a",
                        color: "white",
                        border: "none",
                        borderRadius: "4px",
                        cursor: "pointer",
                      }}
                    >
                      Save
                    </button>
                    <button
                      onClick={cancelEdit}
                      style={{
                        padding: "6px 16px",
                        fontSize: "13px",
                        backgroundColor: "#e5e7eb",
                        border: "1px solid #ccc",
                        borderRadius: "4px",
                        cursor: "pointer",
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {expandedLogs[s.id] && (
                <div
                  style={{
                    marginTop: "10px",
                    backgroundColor: "#1e1e1e",
                    color: "#d4d4d4",
                    borderRadius: "6px",
                    padding: "12px",
                    maxHeight: "300px",
                    overflowY: "auto",
                    fontFamily: "monospace",
                    fontSize: "12px",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {logData[s.id] || "No logs available."}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
