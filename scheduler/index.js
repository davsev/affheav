const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const SCHEDULES_FILE = path.join(__dirname, '../config/schedules.json');

let activeJobs = {}; // id → cron.ScheduledTask
let _runWorkflow = null; // injected by server.js

function setWorkflowRunner(fn) {
  _runWorkflow = fn;
}

function loadSchedules() {
  try {
    return JSON.parse(fs.readFileSync(SCHEDULES_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveSchedules(schedules) {
  const dir = path.dirname(SCHEDULES_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(SCHEDULES_FILE, JSON.stringify(schedules, null, 2));
}

function stopAll() {
  for (const [id, job] of Object.entries(activeJobs)) {
    job.stop();
  }
  activeJobs = {};
}

function startAll() {
  const schedules = loadSchedules();
  stopAll();

  for (const s of schedules) {
    if (!s.enabled) continue;
    if (!cron.validate(s.cron)) {
      console.warn(`[scheduler] Invalid cron: "${s.cron}" (id: ${s.id})`);
      continue;
    }

    activeJobs[s.id] = cron.schedule(s.cron, async () => {
      console.log(`[scheduler] Firing job: ${s.label} (${s.cron})`);
      if (_runWorkflow) {
        try {
          await _runWorkflow();
        } catch (err) {
          console.error(`[scheduler] Workflow error in job ${s.id}:`, err.message);
        }
      }
    }, { timezone: 'Asia/Jerusalem' });

    console.log(`[scheduler] Scheduled: ${s.label} → ${s.cron}`);
  }

  return schedules.length;
}

function list() {
  const schedules = loadSchedules();
  return schedules.map(s => ({
    ...s,
    active: s.enabled && !!activeJobs[s.id],
  }));
}

function add({ label, cron: cronExpr, enabled = true }) {
  if (!cron.validate(cronExpr)) throw new Error(`Invalid cron expression: ${cronExpr}`);

  const schedules = loadSchedules();
  const entry = { id: uuidv4(), label, cron: cronExpr, enabled };
  schedules.push(entry);
  saveSchedules(schedules);
  startAll(); // reload all jobs
  return entry;
}

function update(id, { label, cron: cronExpr, enabled }) {
  const schedules = loadSchedules();
  const idx = schedules.findIndex(s => s.id === id);
  if (idx === -1) throw new Error(`Schedule not found: ${id}`);

  if (cronExpr !== undefined && !cron.validate(cronExpr)) {
    throw new Error(`Invalid cron expression: ${cronExpr}`);
  }

  if (label !== undefined) schedules[idx].label = label;
  if (cronExpr !== undefined) schedules[idx].cron = cronExpr;
  if (enabled !== undefined) schedules[idx].enabled = enabled;

  saveSchedules(schedules);
  startAll();
  return schedules[idx];
}

function remove(id) {
  const schedules = loadSchedules();
  const idx = schedules.findIndex(s => s.id === id);
  if (idx === -1) throw new Error(`Schedule not found: ${id}`);

  schedules.splice(idx, 1);
  saveSchedules(schedules);

  if (activeJobs[id]) {
    activeJobs[id].stop();
    delete activeJobs[id];
  }
}

module.exports = { startAll, stopAll, list, add, update, remove, setWorkflowRunner };
