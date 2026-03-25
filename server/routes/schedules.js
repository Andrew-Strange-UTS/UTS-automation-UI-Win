// server/routes/schedules.js

const express = require("express");
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const scheduleStore = require("../scheduleStore");
const scheduler = require("../scheduler");
const secretsStore = require("../secrets");
const { portableEncrypt, portableDecrypt } = require("../utils/portableEncryption");
const router = express.Router();

const TESTS_ROOT = path.join(__dirname, "../../tmp/repo/tests");
const BUILTINS_DIR = path.join(__dirname, "../builtins");

// Helper: read test code for a sequence step
function readTestCode(test) {
  try {
    if (test.builtin) {
      return fs.readFileSync(path.join(BUILTINS_DIR, test.builtin + ".js"), "utf8");
    }
    return fs.readFileSync(path.join(TESTS_ROOT, test.name, "run.js"), "utf8");
  } catch (e) {
    return null;
  }
}

// Helper: gather all secrets into a flat object
function gatherSecrets() {
  const secrets = {};
  secretsStore.listNames().forEach((name) => {
    secrets[name] = secretsStore.getSecret(name);
  });
  return secrets;
}

// Helper: strip sensitive data from schedule for API responses
function safeSchedule(s) {
  return {
    ...s,
    sequencePayload: undefined,
    bundledSecrets: undefined,
    bundledTestCode: undefined,
    isRunning: scheduler.isRunning(s.id),
    stepNames: s.sequencePayload?.sequence?.map((t) => t.name) || [],
    zephyrSteps: (s.sequencePayload?.sequence || [])
      .filter((t) => t.zephyr)
      .map((t) => ({ name: t.name, ...t.zephyr })),
  };
}

// List all schedules
router.get("/", (req, res) => {
  const all = scheduleStore.getAll().map(safeSchedule);
  res.json({ schedules: all });
});

// Get single schedule (without secrets/code)
router.get("/:id", (req, res) => {
  const schedule = scheduleStore.getById(req.params.id);
  if (!schedule) return res.status(404).json({ error: "Schedule not found" });
  res.json(safeSchedule(schedule));
});

// Get logs for a schedule's last run
router.get("/:id/logs", (req, res) => {
  const logs = scheduler.getRunLogs(req.params.id);
  res.json({ logs });
});

// Create a new schedule (bundles secrets + test code at creation time)
router.post("/", (req, res) => {
  const { name, sequencePayload, time, days, ntfyTopic, teamsWebhookAll, teamsWebhookFail } = req.body;

  if (!name || !sequencePayload || !time || !days || !Array.isArray(days) || days.length === 0) {
    return res.status(400).json({
      error: "Required: name, sequencePayload, time (HH:MM), days (array of mon/tue/wed/thu/fri/sat/sun)",
    });
  }

  if (!/^\d{2}:\d{2}$/.test(time)) {
    return res.status(400).json({ error: "time must be in HH:MM format" });
  }

  const validDays = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  for (const d of days) {
    if (!validDays.includes(d.toLowerCase())) {
      return res.status(400).json({ error: `Invalid day: ${d}` });
    }
  }

  // Bundle secrets
  const bundledSecrets = gatherSecrets();

  // Bundle test code
  const bundledTestCode = {};
  for (const test of sequencePayload.sequence) {
    const code = readTestCode(test);
    bundledTestCode[test.builtin || test.name] = code;
  }

  const schedule = {
    id: uuidv4().slice(0, 8),
    name,
    sequencePayload,
    bundledSecrets,
    bundledTestCode,
    time,
    days: days.map((d) => d.toLowerCase()),
    ntfyTopic: ntfyTopic || "",
    teamsWebhookAll: teamsWebhookAll || "",
    teamsWebhookFail: teamsWebhookFail || "",
    status: "active",
    createdAt: new Date().toISOString(),
    lastRun: null,
    lastResult: null,
  };

  scheduleStore.create(schedule);
  scheduler.startJob(schedule);

  res.json(safeSchedule(schedule));
});

// Update schedule (name, time, days, notifications)
router.patch("/:id", (req, res) => {
  const schedule = scheduleStore.getById(req.params.id);
  if (!schedule) return res.status(404).json({ error: "Schedule not found" });

  const { name, time, days, ntfyTopic, teamsWebhookAll, teamsWebhookFail } = req.body;
  const updates = {};
  if (name) updates.name = name;
  if (ntfyTopic !== undefined) updates.ntfyTopic = ntfyTopic;
  if (teamsWebhookAll !== undefined) updates.teamsWebhookAll = teamsWebhookAll;
  if (teamsWebhookFail !== undefined) updates.teamsWebhookFail = teamsWebhookFail;
  if (time) {
    if (!/^\d{2}:\d{2}$/.test(time)) {
      return res.status(400).json({ error: "time must be in HH:MM format" });
    }
    updates.time = time;
  }
  if (days) {
    const validDays = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
    for (const d of days) {
      if (!validDays.includes(d.toLowerCase())) {
        return res.status(400).json({ error: `Invalid day: ${d}` });
      }
    }
    updates.days = days.map((d) => d.toLowerCase());
  }

  const updated = scheduleStore.update(req.params.id, updates);

  if (updated.status === "active") {
    scheduler.startJob(updated);
  }

  res.json(safeSchedule(updated));
});

// Run now
router.post("/:id/run", (req, res) => {
  const schedule = scheduleStore.getById(req.params.id);
  if (!schedule) return res.status(404).json({ error: "Schedule not found" });
  if (scheduler.isRunning(schedule.id)) {
    return res.status(409).json({ error: "Schedule is already running" });
  }
  scheduler.executeSchedule(schedule.id);
  res.json({ message: "Schedule triggered", id: schedule.id });
});

// Pause
router.post("/:id/pause", (req, res) => {
  const schedule = scheduleStore.getById(req.params.id);
  if (!schedule) return res.status(404).json({ error: "Schedule not found" });
  scheduler.pauseJob(schedule.id);
  const updated = scheduleStore.update(schedule.id, { status: "paused" });
  res.json(safeSchedule(updated));
});

// Resume
router.post("/:id/resume", (req, res) => {
  const schedule = scheduleStore.getById(req.params.id);
  if (!schedule) return res.status(404).json({ error: "Schedule not found" });
  const updated = scheduleStore.update(schedule.id, { status: "active" });
  scheduler.startJob(updated);
  res.json(safeSchedule(updated));
});

// Stop
router.post("/:id/stop", (req, res) => {
  const schedule = scheduleStore.getById(req.params.id);
  if (!schedule) return res.status(404).json({ error: "Schedule not found" });
  scheduler.stopJob(schedule.id);
  const updated = scheduleStore.update(schedule.id, { status: "stopped" });
  res.json(safeSchedule(updated));
});

// Delete
router.delete("/:id", (req, res) => {
  scheduler.stopJob(req.params.id);
  const removed = scheduleStore.remove(req.params.id);
  if (!removed) return res.status(404).json({ error: "Schedule not found" });
  res.json({ message: "Schedule deleted" });
});

// ── Export: encrypt schedule bundle with user password ──
router.post("/:id/export", (req, res) => {
  const { password } = req.body;
  if (!password || password.length < 4) {
    return res.status(400).json({ error: "Password must be at least 4 characters" });
  }

  const schedule = scheduleStore.getById(req.params.id);
  if (!schedule) return res.status(404).json({ error: "Schedule not found" });

  const bundle = {
    version: 1,
    exportedAt: new Date().toISOString(),
    schedule: {
      name: schedule.name,
      time: schedule.time,
      days: schedule.days,
      ntfyTopic: schedule.ntfyTopic,
      teamsWebhookAll: schedule.teamsWebhookAll,
      teamsWebhookFail: schedule.teamsWebhookFail,
    },
    sequencePayload: schedule.sequencePayload,
    bundledSecrets: schedule.bundledSecrets || {},
    bundledTestCode: schedule.bundledTestCode || {},
  };

  const encrypted = portableEncrypt(bundle, password);
  const safeName = schedule.name.replace(/[^a-zA-Z0-9_-]/g, "_");

  res.set({
    "Content-Type": "application/octet-stream",
    "Content-Disposition": `attachment; filename="${safeName}.utsb"`,
    "Content-Length": encrypted.length,
  });
  res.send(encrypted);
});

// ── Import: decrypt bundle and create schedule ──
router.post("/import", (req, res) => {
  const { fileData, password } = req.body;
  if (!fileData || !password) {
    return res.status(400).json({ error: "fileData (base64) and password are required" });
  }

  let bundle;
  try {
    const buffer = Buffer.from(fileData, "base64");
    bundle = portableDecrypt(buffer, password);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  if (!bundle.version || !bundle.sequencePayload || !bundle.schedule) {
    return res.status(400).json({ error: "Invalid bundle format" });
  }

  // Write bundled test code to disk so require() works
  const writtenTests = [];
  if (bundle.bundledTestCode) {
    for (const [name, code] of Object.entries(bundle.bundledTestCode)) {
      if (!code) continue;
      // Check if it's a builtin name
      const builtinPath = path.join(BUILTINS_DIR, name + ".js");
      if (fs.existsSync(builtinPath)) continue; // don't overwrite builtins

      const testDir = path.join(TESTS_ROOT, name);
      fs.mkdirSync(testDir, { recursive: true });
      fs.writeFileSync(path.join(testDir, "run.js"), code);
      writtenTests.push(name);
    }
  }

  // Merge bundled secrets into secrets store
  const importedSecrets = [];
  if (bundle.bundledSecrets) {
    for (const [name, value] of Object.entries(bundle.bundledSecrets)) {
      secretsStore.setSecret(name, value);
      importedSecrets.push(name);
    }
  }

  // Create the schedule
  const schedule = {
    id: uuidv4().slice(0, 8),
    name: bundle.schedule.name,
    sequencePayload: bundle.sequencePayload,
    bundledSecrets: bundle.bundledSecrets || {},
    bundledTestCode: bundle.bundledTestCode || {},
    time: bundle.schedule.time,
    days: bundle.schedule.days,
    ntfyTopic: bundle.schedule.ntfyTopic || "",
    teamsWebhookAll: bundle.schedule.teamsWebhookAll || "",
    teamsWebhookFail: bundle.schedule.teamsWebhookFail || "",
    status: "active",
    createdAt: new Date().toISOString(),
    lastRun: null,
    lastResult: null,
  };

  scheduleStore.create(schedule);
  scheduler.startJob(schedule);

  res.json({
    ...safeSchedule(schedule),
    imported: {
      secrets: importedSecrets,
      tests: writtenTests,
    },
  });
});

module.exports = router;
