// client/src/components/PrivateRepoCheckbox.js

export default function PrivateRepoCheckbox({ checked, onChange, onHelp }) {
  return (
    <label style={{ display: "flex", alignItems: "center", fontSize: 15, gap: 5 }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        style={{ width: 18, height: 18 }}
      />
      Private repository
      {onHelp && (
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); onHelp(); }}
          title="How to set up a private repo (GitHub token + Marvin secrets)"
          style={{
            marginLeft: 2, width: 20, height: 20, lineHeight: "18px",
            borderRadius: "50%", border: "1px solid #999", background: "#fff",
            color: "#555", fontSize: 13, fontWeight: "bold", cursor: "pointer", padding: 0,
          }}
        >
          ?
        </button>
      )}
    </label>
  );
}
