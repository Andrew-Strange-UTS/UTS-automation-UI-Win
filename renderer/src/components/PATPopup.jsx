
import React from "react";
import theme from "@/theme";

export default function PATPopup({ open, onClose }) {
  if (!open) return null;
  return (
    <>
      {/* Overlay blocks content */}
      <div
        style={{
          position: "fixed",
          zIndex: 9999,
          left: 0,
          top: 0,
          width: "100vw",
          height: "100vh",
          background: "rgba(0,0,0,0.44)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
        onClick={onClose}
      />
      {/* Dialog */}
      <div
        style={{
          position: "fixed",
          zIndex: 10000,
          left: 0,
          top: 0,
          width: "100vw",
          height: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            background: "#fff",
            borderRadius: "12px",
            boxShadow: "0 8px 32px rgba(0,0,0,0.25)",
            padding: "36px 36px 24px 36px",
            minWidth: 420,
            maxWidth: "92vw",
            pointerEvents: "auto",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            maxHeight: "88vh",
            overflowY: "auto"
          }}
          onClick={(e) => e.stopPropagation()} // Prevent overlay click
        >
          <div style={{ fontSize: 24, fontWeight: "bold", marginBottom: 10 }}>
            🚩 Add GitHub Personal Access Token
          </div>
          <p style={{ fontSize: 17, textAlign: "center", margin: 0, marginBottom: 6 }}>
            Please add 2 secrets called <b>GITHUB_USERNAME</b> and <b>GITHUB_PERSONAL_ACCESS_TOKEN</b> and add your GitHub Username and the token (with the access) you get from:
          </p>
          <a
            href="https://github.com/settings/tokens/new?description=gitingest&scopes=repo"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: "#1968d2",
              fontWeight: "bold",
              fontSize: 16,
              marginBottom: 28,
              textDecoration: "underline",
              wordBreak: "break-all"
            }}
          >
            https://github.com/settings/tokens/new?description=gitingest&scopes=repo
          </a>
                    {/* IMAGE AT THE BOTTOM */}
          <img
            src="/img/steps.png"
            alt="GitHub SSO token steps"
            style={{
              display: "block",
              marginTop: 28,
              marginBottom: 0,
              maxWidth: "100%",
              width: "100%",
              maxHeight: 320,
              height: "auto",
              objectFit: "contain",
              borderRadius: 8,
              boxShadow: "0 2px 7px rgba(0,0,0,0.08)",
            }}
          />
          <button
            onClick={onClose}
            style={{
              background: theme.primary,
              color: theme.primaryText,
              border: "none",
              borderRadius: 6,
              padding: "10px 26px",
              fontSize: 16,
              fontWeight: "bold",
              cursor: "pointer",
              marginTop: 8,
              marginBottom: 15,
            }}
          >
            Close
          </button>

        </div>
      </div>
    </>
  );
}