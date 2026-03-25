
import { useState } from "react";

export default function LogGroup({ title, children, defaultCollapsed = true }) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  return (
    <div
      style={{
        marginBottom: "20px",
        padding: "0",
        border: "1px solid #ddd",
        borderRadius: "5px",
        backgroundColor: "#f5f5f5",
        overflow: "hidden",
        boxShadow: collapsed ? "none" : "0 4px 12px rgba(0,0,0,0.07)",
      }}
    >
      <button
        onClick={() => setCollapsed((v) => !v)}
        style={{
          width: "100%",
          background: "none",
          border: "none",
          textAlign: "left",
          padding: "10px 15px",
          fontWeight: "bold",
          fontSize: "16px",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          outline: "none",
        }}
        aria-expanded={!collapsed}
        aria-controls={`loggroup-content-${title}`}
        tabIndex={0}
      >
        <span
          style={{
            display: "inline-block",
            width: 32,
            height: 32,
            marginRight: 7,
            fontSize: 32,
            fontFamily: "monospace",
            fontWeight: "bold",
            transform: "none",
            transition: "transform 0.18s",
            lineHeight: "1",
          }}
        >
          {collapsed ? "▶" : "▼"}
        </span>
        <span>{title}</span>
      </button>
      {!collapsed && (
        <div id={`loggroup-content-${title}`}>
          {children}
        </div>
      )}
    </div>
  );
}