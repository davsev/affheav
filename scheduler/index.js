const cron = require('node-cron');
const { v4: uuidv4 } = require('uuid');
const { getSetting, setSetting } = require('../services/googleSheets');

let activeJobs  = {}; // id → cron.ScheduledTask
let _schedules  = []; // flat list with channelId on each entry
let _runWorkflow = null;

function setWorkflowRunner(fn) {
  _runWorkflow = fn;
}

async function loadSchedules() {
  try {
    const raw = await getSetting('schedules');
    _schedules = raw ? JSON.parse(raw) : [];
    // Migrate: add channelId to old entries that don't have it
    let migrated = false;
    _schedules.forEach(s => {
      if (!s.channelId) { s.channelId = 'fishing'; migrated = true; }
    });
    if (migrated) await saveSchedules();
  } catch {
    _schedules = [];
  }
  return _schedules;
}

async function saveSchedules() {
  await setSetting('schedules', JSON.stringify(_schedules));
}

function stopAll() {
  for (const job of Object.values(activeJobs)) job.stop();
  activeJobs = {};
}

async function startAll() {
  await loadSchedules();
  stopAll();

  for (const s of _schedules) {
    if (!s.enabled) continue;
    if (!cron.validate(s.cron)) {
      console.warn(`[scheduler] Invalid cron: "${s.cron}" (id: ${s.id})`);
      continue;
    }
    const channelId = s.channelId || 'fishing';
    activeJobs[s.id] = cron.schedule(s.cron, async () => {
      console.log(`[scheduler] Firing job: ${s.label} (${s.cron}) [channel: ${channelId}]`);
      if (_runWorkflow) {
        try { await _runWorkflow(channelId); } catch (err) {
          console.error(`[scheduler] Workflow error in job ${s.id}:`, err.message);
        }
      }
    }, { timezone: 'Asia/Jerusalem' });
    console.log(`[scheduler] Scheduled: ${s.label} → ${s.cron} [channel: ${channelId}]`);
  }

  return _schedules.length;
}

// list(channelId) — if channelId provided, filter; else return all
function list(channelId = null) {
  const items = channelId
    ? _schedules.filter(s => s.channelId === channelId)
    : _schedules;
  return items.map(s => ({ ...s, active: s.enabled && !!activeJobs[s.id] }));
}

async function add({ label, cron: cronExpr, enabled = true, channelId = 'fishing' }) {
  if (!cron.validate(cronExpr)) throw new Error(`Invalid cron expression: ${cronExpr}`);
  await loadSchedules();
  const entry = { id: uuidv4(), label, cron: cronExpr, enabled, channelId };
  _schedules.push(entry);
  await saveSchedules();
  await startAll();
  return entry;
}

async function update(id, { label, cron: cronExpr, enabled }) {
  await loadSchedules();
  const idx = _schedules.findIndex(s => s.id === id);
  if (idx === -1) throw new Error(`Schedule not found: ${id}`);
  if (cronExpr !== undefined && !cron.validate(cronExpr)) throw new Error(`Invalid cron expression: ${cronExpr}`);
  if (label   !== undefined) _schedules[idx].label   = label;
  if (cronExpr!== undefined) _schedules[idx].cron    = cronExpr;
  if (enabled !== undefined) _schedules[idx].enabled = enabled;
  await saveSchedules();
  await startAll();
  return _schedules[idx];
}

async function remove(id) {
  await loadSchedules();
  const idx = _schedules.findIndex(s => s.id === id);
  if (idx === -1) throw new Error(`Schedule not found: ${id}`);
  _schedules.splice(idx, 1);
  await saveSchedules();
  if (activeJobs[id]) { activeJobs[id].stop(); delete activeJobs[id]; }
}

module.exports = { startAll, stopAll, list, add, update, remove, setWorkflowRunner };
