//client/src/components/SecretsPanel.js

import { useEffect, useState } from "react";
import SecretRow from "./SecretRow";
import { BACKEND_URL } from "@/config";

export default function SecretsPanel() {
  const [secrets, setSecrets] = useState([]);
  const [newName, setNewName] = useState("");
  const [newValue, setNewValue] = useState("");
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [reload, setReload] = useState(0);

  // Load secret names only
  useEffect(() => {
    fetch(`${BACKEND_URL}/api/secrets`)
      .then(res => res.json())
      .then(data => setSecrets(data.secrets || []));
  }, [reload]);

  function handleAddSecret(e) {
    e.preventDefault();
    setError("");
    setSuccessMsg("");
    if (!/^[A-Za-z0-9_\-]+$/.test(newName)) {
      setError("Secret name must be alphanumeric with underscores/hyphens.");
      return;
    }
    if (!newValue.trim()) {
      setError("Secret value cannot be empty.");
      return;
    }
    fetch(`${BACKEND_URL}/api/secrets`, {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ name: newName, value: newValue })
    }).then(res => {
      if (!res.ok) throw new Error("Failed to add secret");
      setNewName("");
      setNewValue("");
      setSuccessMsg("Secret added.");
      setReload(v => v + 1);
    }).catch(e => setError(e.message));
  }

  return (
    <div style={{
      background: "#f7fafc", border: "1px solid #ccc",
      borderRadius: "10px", padding: "24px", marginBottom: "18px"
    }}>
      <h2 style={{ marginBottom: 16 }}>🔑 Secrets Manager</h2>
      <form onSubmit={handleAddSecret} style={{ display: "flex", gap: 12, marginBottom: 24 }}>
        <input
          type="text"
          placeholder="Secret name (e.g. MY_PASSWORD)"
          value={newName}
          onChange={e => setNewName(e.target.value.toUpperCase())}
          style={{ flex: 1, padding: "10px", borderRadius: 4, border: "1px solid #ccc" }}
        />
        <input
          type="password"
          placeholder="Secret value"
          value={newValue}
          onChange={e => setNewValue(e.target.value)}
          style={{ flex: 2, padding: "10px", borderRadius: 4, border: "1px solid #ccc" }}
        />
        <button type="submit"
          style={{
            padding: "10px 18px", background: "#7c3aed", color: "#fff",
            border: "none", borderRadius: 4, fontWeight: "bold", cursor: "pointer"
          }}
        >Add Secret</button>
      </form>
      {error && <div style={{ color: "crimson", marginBottom: 8 }}>{error}</div>}
      {successMsg && <div style={{ color: "green", marginBottom: 8 }}>{successMsg}</div>}

      <table style={{ width: "100%", background: "#fff", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ borderBottom: "1px solid #ccc" }}>
            <th style={{ textAlign: "left", padding: 8 }}>Name</th>
            <th style={{ textAlign: "left", padding: 8 }}>Status</th>
            <th style={{ textAlign: "left", padding: 8 }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {secrets.length === 0 && <tr><td colSpan={3} style={{ padding: 18, textAlign: "center", color: "#888" }}>No secrets set yet.</td></tr>}
          {secrets.map(name =>
            <SecretRow key={name} name={name} refreshList={() => setReload(v => v + 1)} />
          )}
        </tbody>
      </table>
      <div style={{ fontSize: "13px", marginTop: "14px", color: "#1a1a1a" }}>
        Values are never shown again after entry.<br/>
        Use in parameters: <code style={{ background: "#eee", borderRadius: 4, padding: "2px 5px" }}>{'parameters.SECRET_NAME'}</code>
      </div>
    </div>
  );
}