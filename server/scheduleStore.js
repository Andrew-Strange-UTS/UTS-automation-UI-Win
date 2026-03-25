// server/scheduleStore.js
// Persistent storage for saved sequences and their schedules

const fs = require("fs");
const path = require("path");

const paths = require("./utils/paths");
const SCHEDULES_FILE = paths.SCHEDULES_FILE;

function loadAll() {
  try {
    if (fs.existsSync(SCHEDULES_FILE)) {
      return JSON.parse(fs.readFileSync(SCHEDULES_FILE, "utf8"));
    }
  } catch (e) {
    console.error("[scheduleStore] Failed to load schedules:", e.message);
  }
  return [];
}

function saveAll(schedules) {
  const dir = path.dirname(SCHEDULES_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(SCHEDULES_FILE, JSON.stringify(schedules, null, 2));
}

function getAll() {
  return loadAll();
}

function getById(id) {
  return loadAll().find((s) => s.id === id) || null;
}

function create(schedule) {
  const all = loadAll();
  all.push(schedule);
  saveAll(all);
  return schedule;
}

function update(id, updates) {
  const all = loadAll();
  const idx = all.findIndex((s) => s.id === id);
  if (idx === -1) return null;
  all[idx] = { ...all[idx], ...updates };
  saveAll(all);
  return all[idx];
}

function remove(id) {
  const all = loadAll();
  const filtered = all.filter((s) => s.id !== id);
  if (filtered.length === all.length) return false;
  saveAll(filtered);
  return true;
}

module.exports = { getAll, getById, create, update, remove };
