
import React from "react";
import theme from "@/theme";

export default function PATPopup({ open, onClose }) {
  const [imgHidden, setImgHidden] = React.useState(false);
  if (!open) return null;

  const code = { background: "#f2f2f2", padding: "1px 6px", borderRadius: 4, fontFamily: "monospace" };

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
            overflowY: "auto",
          }}
          onClick={(e) => e.stopPropagation()} // Prevent overlay click
        >
          <div style={{ fontSize: 24, fontWeight: "bold", marginBottom: 10 }}>
            🚩 Add GitHub Personal Access Token
          </div>

          <p style={{ fontSize: 16, textAlign: "center", margin: 0, marginBottom: 6 }}>
            To pull tests from a <b>private</b> GitHub repo, Marvin needs your GitHub
            username and a Personal Access Token.
          </p>

          <p style={{ fontSize: 16, textAlign: "left", margin: "10px 0 4px", alignSelf: "flex-start" }}>
            In Marvin, click <b>Open Secrets</b> and add these two secrets:
          </p>
          <ul style={{ fontSize: 15, textAlign: "left", alignSelf: "flex-start", margin: 0, paddingLeft: 22, lineHeight: 1.6 }}>
            <li><span style={code}>GITHUB_USERNAME</span> &mdash; your GitHub username</li>
            <li><span style={code}>GITHUB_PERSONAL_ACCESS_TOKEN</span> &mdash; the token from the link below</li>
          </ul>

          <p style={{ fontSize: 16, textAlign: "center", margin: "14px 0 4px" }}>
            Create the token (with the <b>repo</b> scope) here:
          </p>
          <a
            href="https://github.com/settings/tokens/new?description=marvin&scopes=repo"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: "#1968d2",
              fontWeight: "bold",
              fontSize: 15,
              marginBottom: 20,
              textDecoration: "underline",
              wordBreak: "break-all",
            }}
          >
            https://github.com/settings/tokens/new?description=marvin&scopes=repo
          </a>

          {/* GitHub token steps screenshot */}
          {!imgHidden && (
            <img
              src="./img/steps.png"
              alt="GitHub token steps"
              onError={() => setImgHidden(true)}
              style={{
                display: "block",
                marginTop: 8,
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
          )}

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
              marginTop: 16,
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
