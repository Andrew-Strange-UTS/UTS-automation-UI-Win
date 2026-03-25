// client/src/components/PrivateRepoCheckbox.js

export default function PrivateRepoCheckbox({ checked, onChange }) {
  return (
    <label style={{ display: "flex", alignItems: "center", fontSize: 15, gap: 5 }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        style={{ width: 18, height: 18 }}
      />
      Private repository
    </label>
  );
}