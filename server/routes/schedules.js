// server/routes/schedules.js
// Thin proxy to the standalone scheduler service at localhost:5050.
// The Electron backend no longer runs cron jobs — it forwards all
// schedule operations to the shared system-wide scheduler service.

const express = require("express");
const fs = require("fs");
const path = require("path");
const router = express.Router();
const secretsStore = require("../secrets");

const SCHEDULER_URL = process.env.UTS_SCHEDULER_URL || "http://localhost:5050";
const TESTS_ROOT = path.join(__dirname, "../../data/repo/tests");
const BUILTINS_DIR = path.join(__dirname, "../builtins");

// ─── Helpers ───

function readTestCode(test) {
  try {
    if (test.builtin) {
      return fs.readFileSync(path.join(BUILTINS_DIR, test.builtin + ".js"), "utf8");
    }
    const { TESTS_ROOT: configuredRoot } = require("../utils/paths");
    return fs.readFileSync(path.join(configuredRoot, test.name, "run.js"), "utf8");
  } catch {
    return null;
  }
}

function gatherSecrets() {
  const s = {};
  secretsStore.listNames().forEach((name) => { s[name] = secretsStore.getSecret(name); });
  return s;
}

// ─── Generic proxy ───

async function proxy(req, res) {
  const targetUrl = `${SCHEDULER_URL}${req.originalUrl}`;
  try {
    const options = { method: req.method, headers: {} };
    if (req.method !== "GET" && req.method !== "HEAD") {
      options.headers["Content-Type"] = "application/json";
      options.body = JSON.stringify(req.body);
    }
    const upstream = await fetch(targetUrl, options);
    const contentType = upstream.headers.get("content-type") || "";

    // Binary response (export .utsb file)
    if (contentType.includes("application/octet-stream")) {
      const disposition = upstream.headers.get("content-disposition");
      res.set("Content-Type", "application/octet-stream");
      if (disposition) res.set("Content-Disposition", disposition);
      const buffer = Buffer.from(await upstream.arrayBuffer());
      res.set("Content-Length", buffer.length);
      return res.status(upstream.status).send(buffer);
    }

    const data = await upstream.json();
    return res.status(upstream.status).json(data);
  } catch (err) {
    return res.status(503).json({
      error: "Scheduler service is not running. Start the Marvin Scheduler Service to manage schedules.",
      detail: err.message,
    });
  }
}

// ─── Enriched proxy for create (bundles secrets + test code) ───

async function enrichAndProxy(req, res) {
  const targetUrl = `${SCHEDULER_URL}${req.originalUrl}`;
  try {
    // Bundle secrets and test code from the Electron app's local data
    const body = { ...req.body };
    if (body.sequencePayload && body.sequencePayload.sequence) {
      body.bundledSecrets = gatherSecrets();
      body.bundledTestCode = {};
      body.bundledImages = {};
      for (const test of body.sequencePayload.sequence) {
        const code = readTestCode(test);
        body.bundledTestCode[test.builtin || test.name] = code;
        // Bundle images from the test's images/ folder
        if (!test.builtin) {
          const { TESTS_ROOT: configuredRoot } = require("../utils/paths");
          const imagesDir = path.join(configuredRoot, test.name, "images");
          if (fs.existsSync(imagesDir)) {
            body.bundledImages[test.name] = {};
            const files = fs.readdirSync(imagesDir).filter(f => /\.(png|jpg|jpeg|bmp)$/i.test(f));
            for (const file of files) {
              body.bundledImages[test.name][file] = fs.readFileSync(path.join(imagesDir, file)).toString("base64");
            }
          }
        }
      }
    }

    const upstream = await fetch(targetUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await upstream.json();
    return res.status(upstream.status).json(data);
  } catch (err) {
    return res.status(503).json({
      error: "Scheduler service is not running. Start the Marvin Scheduler Service to manage schedules.",
      detail: err.message,
    });
  }
}

// ─── Routes ───

router.get("/", proxy);
router.get("/:id", proxy);
router.get("/:id/logs", proxy);
router.post("/", enrichAndProxy);      // bundles secrets + test code before forwarding
router.post("/import", proxy);          // import body already contains bundled data
router.patch("/:id", proxy);
router.post("/:id/run", proxy);
router.post("/:id/pause", proxy);
router.post("/:id/resume", proxy);
router.post("/:id/stop", proxy);
router.post("/:id/export", proxy);
router.delete("/:id", proxy);

module.exports = router;
