import { BACKEND_URL } from "@/config";

// Renders a log string, turning [[SCREENSHOT]]<path> marker lines (emitted by the
// runner on test failure, EPEA-2514) into inline thumbnails while showing the
// rest as plain text.
const SCREENSHOT_RE = /\[\[SCREENSHOT\]\](.+)\s*$/;

export default function LogContent({ log }) {
  const text = log || "No logs yet.";
  const lines = text.split(/\r?\n/);

  // Group consecutive non-image lines into text blocks, with images interleaved.
  const blocks = [];
  let buffer = [];
  const flush = () => {
    if (buffer.length) {
      blocks.push({ type: "text", value: buffer.join("\n") });
      buffer = [];
    }
  };
  for (const line of lines) {
    const m = line.match(SCREENSHOT_RE);
    if (m) {
      flush();
      blocks.push({ type: "image", path: m[1].trim() });
    } else {
      buffer.push(line);
    }
  }
  flush();

  return (
    <div style={{ padding: 15 }}>
      {blocks.map((b, i) =>
        b.type === "image" ? (
          <figure key={i} style={{ margin: "10px 0" }}>
            <figcaption style={{ fontSize: "12px", color: "#8a5300", marginBottom: "4px" }}>
              📷 Failure screenshot
            </figcaption>
            <a
              href={`${BACKEND_URL}/api/screenshot?path=${encodeURIComponent(b.path)}`}
              target="_blank"
              rel="noreferrer"
            >
              <img
                src={`${BACKEND_URL}/api/screenshot?path=${encodeURIComponent(b.path)}`}
                alt="Failure screenshot"
                style={{ maxWidth: "480px", maxHeight: "320px", border: "1px solid #ccc", borderRadius: "4px", display: "block" }}
                onError={(e) => { e.target.style.display = "none"; }}
              />
            </a>
          </figure>
        ) : (
          <pre key={i} style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: "13px" }}>
            {b.value}
          </pre>
        )
      )}
    </div>
  );
}
