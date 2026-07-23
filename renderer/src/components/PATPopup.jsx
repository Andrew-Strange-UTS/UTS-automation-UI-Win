
import React from "react";
import theme from "@/theme";

// A screenshot that simply disappears if the image file is not present, so the
// popup still reads well before the screenshots are added.
function Shot({ src, alt, caption }) {
  const [hidden, setHidden] = React.useState(false);
  if (hidden) return null;
  return (
    <figure style={{ margin: "10px 0 4px", width: "100%" }}>
      <img
        src={src}
        alt={alt}
        onError={() => setHidden(true)}
        style={{
          display: "block",
          maxWidth: "100%",
          width: "100%",
          maxHeight: 340,
          height: "auto",
          objectFit: "contain",
          borderRadius: 8,
          border: "1px solid #eee",
          boxShadow: "0 2px 7px rgba(0,0,0,0.08)",
        }}
      />
      {caption && (
        <figcaption style={{ fontSize: 12, color: "#888", textAlign: "center", marginTop: 4 }}>
          {caption}
        </figcaption>
      )}
    </figure>
  );
}

export default function PATPopup({ open, onClose }) {
  if (!open) return null;
  const stepHeader = { fontSize: 17, fontWeight: "bold", margin: "18px 0 6px", alignSelf: "flex-start" };
  const body = { fontSize: 15, margin: 0, alignSelf: "flex-start", lineHeight: 1.5 };
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
            padding: "32px 36px 24px 36px",
            minWidth: 420,
            maxWidth: "640px",
            width: "92vw",
            pointerEvents: "auto",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            maxHeight: "88vh",
            overflowY: "auto",
          }}
          onClick={(e) => e.stopPropagation()} // Prevent overlay click
        >
          <div style={{ fontSize: 23, fontWeight: "bold", marginBottom: 8 }}>
            🔒 Using a private GitHub repo
          </div>
          <p style={{ fontSize: 15, textAlign: "center", margin: 0, marginBottom: 4, color: "#555" }}>
            To pull tests from a private repo, Marvin needs your GitHub username and
            a Personal Access Token. Set them up once, then tick Private repository
            and Refresh Tests.
          </p>

          {/* Step 1: GitHub */}
          <div style={stepHeader}>1. Create a Personal Access Token on GitHub</div>
          <p style={body}>
            Open the link below and create a token with the <b>repo</b> scope, then
            copy it (GitHub only shows it once):
          </p>
          <a
            href="https://github.com/settings/tokens/new?description=marvin&scopes=repo"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: "#1968d2",
              fontWeight: "bold",
              fontSize: 14,
              margin: "6px 0",
              textDecoration: "underline",
              wordBreak: "break-all",
              alignSelf: "flex-start",
            }}
          >
            https://github.com/settings/tokens/new?description=marvin&scopes=repo
          </a>
          <Shot src="./img/pat-github.png" alt="Creating a GitHub Personal Access Token" caption="On GitHub: create a token with the repo scope" />

          {/* Step 2: Marvin */}
          <div style={stepHeader}>2. Add two secrets in Marvin</div>
          <p style={body}>
            Click <b>Open Secrets</b> and set these two secrets:
          </p>
          <ul style={{ ...body, paddingLeft: 20, marginTop: 4 }}>
            <li><span style={code}>GITHUB_USERNAME</span> &mdash; your GitHub username</li>
            <li><span style={code}>GITHUB_PERSONAL_ACCESS_TOKEN</span> &mdash; the token you just copied</li>
          </ul>
          <Shot src="./img/pat-marvin.png" alt="Adding the GitHub secrets in Marvin" caption="In Marvin: add GITHUB_USERNAME and GITHUB_PERSONAL_ACCESS_TOKEN" />

          {/* Step 3 */}
          <div style={stepHeader}>3. Load the repo</div>
          <p style={{ ...body, marginBottom: 4 }}>
            Tick <b>Private repository</b>, paste the repo URL, and click
            <b> Refresh Tests</b>.
          </p>

          {/* Combined walkthrough screenshot (shown if present) */}
          <Shot src="./img/steps.png" alt="Private repo setup walkthrough" caption="Full walkthrough" />

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
              marginTop: 18,
              marginBottom: 6,
            }}
          >
            Got it
          </button>
        </div>
      </div>
    </>
  );
}
