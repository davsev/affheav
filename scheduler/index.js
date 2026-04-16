const cron = require('node-cron');
const { query } = require('../db');

let activeJobs = {}; // id → cron.ScheduledTask
let activeBroadcastJobs = {}; // broadcastId → cron.ScheduledTask
let _runWorkflow = null;
let _log = null; // injected from server.js so scheduler events appear in the UI log stream

function setWorkflowRunner(fn) { _runWorkflow = fn; }
function setLogger(fn) { _log = fn; }
function getActiveJobs() { return activeJobs; }

function log(msg, level = 'info') {
  if (_log) _log(`[scheduler] ${msg}`, level);
  else console.log(`[scheduler] [${level}] ${msg}`);
}

function stopAll() {
  for (const job of Object.values(activeJobs)) job.stop();
  activeJobs = {};
}

function stopBroadcasts() {
  for (const job of Object.values(activeBroadcastJobs)) job.stop();
  activeBroadcastJobs = {};
}

async function startBroadcasts() {
  let broadcasts = [];
  try {
    const { rows } = await query('SELECT * FROM broadcast_messages WHERE enabled = true');
    broadcasts = rows;
  } catch (err) {
    log(`Could not load broadcast_messages: ${err.message}`, 'warn');
    return 0;
  }

  stopBroadcasts();

  for (const b of broadcasts) {
    if (!cron.validate(b.cron)) {
      log(`Invalid cron for broadcast "${b.label}": "${b.cron}"`, 'warn');
      continue;
    }
    activeBroadcastJobs[b.id] = cron.schedule(b.cron, () => runBroadcastJob(b), { timezone: 'Asia/Jerusalem' });
    log(`Broadcast registered: "${b.label}" → ${b.cron}`);
  }

  if (broadcasts.length) {
    log(`📡 ${broadcasts.length} broadcast(s) active: ${broadcasts.map(b => `"${b.label}"`).join(', ')}`);
  } else {
    log('No enabled broadcasts found');
  }

  return broadcasts.length;
}

async function runBroadcastJob(b) {
  const broadcastDelivery = require('../services/broadcastDelivery');
  // Re-fetch from DB so image_url and other fields are always fresh
  let fresh;
  try {
    const { rows } = await query('SELECT * FROM broadcast_messages WHERE id = $1', [b.id]);
    fresh = rows[0];
  } catch (err) {
    log(`Broadcast "${b.label}" DB fetch error: ${err.message}`, 'error');
    return;
  }
  if (!fresh) {
    log(`Broadcast "${b.label}" not found in DB — skipping`, 'warn');
    return;
  }
  log(`Firing broadcast: "${fresh.label}" (${b.cron})`);
  try {
    await broadcastDelivery.send(fresh, fresh.user_id);
  } catch (err) {
    log(`Broadcast "${fresh.label}" error: ${err.message}`, 'error');
  }
}

async function startAll() {
  let schedules = [];
  try {
    const { rows } = await query('SELECT * FROM schedules WHERE enabled = true');
    schedules = rows;
  } catch (err) {
    console.warn('[scheduler] Could not load from DB:', err.message);
    return 0;
  }

  stopAll();

  for (const s of schedules) {
    if (!cron.validate(s.cron)) {
      console.warn(`[scheduler] Invalid cron: "${s.cron}" (id: ${s.id})`);
      continue;
    }
    activeJobs[s.id] = cron.schedule(s.cron, () => runJob(s), { timezone: 'Asia/Jerusalem' });
    log(`Registered: "${s.label}" → ${s.cron}`);
  }

  if (schedules.length) {
    log(`📅 ${schedules.length} schedule(s) active: ${schedules.map(s => `"${s.label}"`).join(', ')}`);
  } else {
    log('No enabled schedules found');
  }

  return schedules.length;
}

async function runJob(s) {
  log(`Firing job: "${s.label}" (${s.cron})`);
  if (_runWorkflow) {
    try {
      await _runWorkflow({ userId: s.user_id, subject: s.subject_id || undefined });
    } catch (err) {
      log(`Workflow error in job "${s.label}": ${err.message}`, 'error');
    }
  } else {
    log('No workflow runner registered — job skipped', 'warn');
  }
}

async function fireNow(id, userId) {
  const { rows } = await query(
    'SELECT * FROM schedules WHERE id = $1 AND user_id = $2',
    [id, userId]
  );
  if (!rows[0]) throw new Error(`Schedule not found: ${id}`);
  await runJob(rows[0]);
}

function _formatRow(s) {
  return {
    id:      s.id,
    label:   s.label,
    cron:    s.cron,
    enabled: s.enabled,
    subject: s.subject_id || '',
    active:  s.enabled && !!activeJobs[s.id],
  };
}

async function add({ userId, label, cron: cronExpr, enabled = true, subjectId = null }) {
  if (!cron.validate(cronExpr)) throw new Error(`Invalid cron expression: ${cronExpr}`);
  const { rows } = await query(
    `INSERT INTO schedules (user_id, subject_id, label, cron, enabled)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [userId, subjectId, label, cronExpr, enabled]
  );
  await startAll();
  return _formatRow(rows[0]);
}

async function update(id, userId, { label, cron: cronExpr, enabled, subject }) {
  const { rows: existing } = await query(
    'SELECT * FROM schedules WHERE id = $1 AND user_id = $2',
    [id, userId]
  );
  if (!existing[0]) throw new Error(`Schedule not found: ${id}`);
  if (cronExpr !== undefined && !cron.validate(cronExpr)) throw new Error(`Invalid cron expression: ${cronExpr}`);

  const cur = existing[0];
  const { rows } = await query(
    `UPDATE schedules SET
       label      = COALESCE($1, label),
       cron       = COALESCE($2, cron),
       enabled    = COALESCE($3, enabled),
       subject_id = $4,
       updated_at = NOW()
     WHERE id = $5 AND user_id = $6
     RETURNING *`,
    [
      label   ?? null,
      cronExpr ?? null,
      enabled  ?? null,
      subject !== undefined ? (subject || null) : cur.subject_id,
      id, userId,
    ]
  );
  await startAll();
  return _formatRow(rows[0]);
}

async function remove(id, userId) {
  const { rowCount } = await query(
    'DELETE FROM schedules WHERE id = $1 AND user_id = $2',
    [id, userId]
  );
  if (!rowCount) throw new Error(`Schedule not found: ${id}`);
  if (activeJobs[id]) { activeJobs[id].stop(); delete activeJobs[id]; }
}

module.exports = {
  startAll, stopAll, getActiveJobs,
  startBroadcasts, stopBroadcasts,
  add, update, remove,
  setWorkflowRunner, setLogger, fireNow,
};
