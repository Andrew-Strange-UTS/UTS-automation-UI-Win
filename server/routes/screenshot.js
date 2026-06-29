// server/routes/screenshot.js
// Serves failure screenshots saved under the per-run sequence folders so the
// log viewer can show them inline. Only files inside TESTS_ROOT are served.

const express = require("express");
const fs = require("fs");
const path = require("path");
const { TESTS_ROOT } = require("../utils/paths");
const router = express.Router();

router.get("/", (req, res) => {
  const requested = req.query.path;
  if (!requested || typeof requested !== "string") {
    return res.status(400).json({ error: "Missing ?path" });
  }
  // Resolve and confine to TESTS_ROOT to prevent path traversal.
  const resolved = path.resolve(requested);
  const root = path.resolve(TESTS_ROOT);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    return res.status(403).json({ error: "Path outside the allowed directory" });
  }
  if (!fs.existsSync(resolved)) {
    return res.status(404).json({ error: "Screenshot not found" });
  }
  res.type("image/png");
  fs.createReadStream(resolved).pipe(res);
});

module.exports = router;
