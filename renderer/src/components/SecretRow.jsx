//client/src/components/SecretsRow.js

import { useState } from "react";
import { BACKEND_URL } from "@/config";

export default function SecretRow({ name, refreshList }) {
  const [editMode, setEditMode] = useState(false);
  const [newValue, setNewValue] = useState("");
  const [actionMsg, setActionMsg] = useState("");

  function handleDelete() {
    if (!window.confirm(`Delete secret ${name}?`)) return;
    fetch(`${BACKEND_URL}/api/secrets/${encodeURIComponent(name)}`, { method: "DELETE" })
      .then(res => {
        if (!res.ok) throw new Error("Delete failed");
        setActionMsg("Deleted!");
        refreshList();
      })
      .catch(e => setActionMsg(e.message));
  }

  function handleUpdate(e) {
    e.preventDefault();
    setActionMsg("");
    if (!newValue.trim()) { setActionMsg("Value cannot be empty."); return; }
    fetch(`${BACKEND_URL}/api/secrets/${encodeURIComponent(name)}`, {
      method: "PUT",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({ value: newValue })
    })
    .then(res => {
      if (!res.ok) throw new Error("Update failed");
      setEditMode(false);
      setNewValue("");
      setActionMsg("Updated!");
      refreshList();
    })
    .catch(e => setActionMsg(e.message));
  }

  return (
    <tr>
      <td style={{ padding: 8, fontFamily: "monospace" }}>{name}</td>
      <td style={{ padding: 8 }}>{editMode ? "Set new value" : "Set"}</td>
      <td style={{ padding: 8 }}>
        {editMode ? (
          <form onSubmit={handleUpdate} style={{ display: "inline-flex", gap: "6px" }}>
            <input
              type="password"
              value={newValue}
              placeholder="New value"
              onChange={e => setNewValue(e.target.value)}
              style={{ padding: "6px", borderRadius: 4, border: "1px solid #ccc", fontSize: "13px" }}
            />
            <button type="submit" style={{ padding: "4px 10px", fontSize: "13px", background: "#7c3aed", color: "#fff", border: "none", borderRadius: 4 }}>Set</button>
            <button type="button" onClick={() => { setEditMode(false); setNewValue(""); }} style={{ padding: "4px 8px", fontSize: "13px", background: "#aaa", color: "#fff", border: "none", borderRadius: 4 }}>Cancel</button>
          </form>
        ) : (
          <>
            <button
              onClick={() => setEditMode(true)}
              style={{ padding: "4px 10px", marginRight: 5, fontSize: "13px", background: "#7c3aed", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}
            >Edit</button>
            <button
              onClick={handleDelete}
              style={{ padding: "4px 10px", fontSize: "13px", background: "#e34c36", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}
            >Delete</button>
          </>
        )}
        {actionMsg && <span style={{ color: "green", fontSize: "13px", marginLeft: 7 }}>{actionMsg}</span>}
      </td>
    </tr>
  );
}