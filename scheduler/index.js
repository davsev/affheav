const cron = require('node-cron');
const { query } = require('../db');
const { runDiscovery } = require('../services/discoveryAgent');

let activeJobs = {}; // id → cron.ScheduledTask
let activeBroadcastJobs = {}; // broadcastId → cron.ScheduledTask
let discoveryJob = null;
let _runWorkflow = null;
let _log = null; // injected from server.js so scheduler events appear in the UI log stream

// Daily by default — override with DISCOVERY_CRON (5-field cron, evaluated in UTC)
const DISCOVERY_CRON = process.env.DISCOVERY_CRON || '0 6 * * *';

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
    activeBroadcastJobs[b.id] = cron.schedule(b.cron, () => runBroadcastJob(b), { timezone: b.timezone || 'UTC' });
    log(`Broadcast registered: "${b.label}" → ${b.cron} (${b.timezone || 'UTC'})`);
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
  // For every_n_days with skip days, enforce the skip at runtime
  // (cron day-of-month + day-of-week uses OR semantics so we can't use the cron field)
  const rec = fresh.recurrence || {};
  if (rec.mode === 'every_n_days' && (rec.skipFriday || rec.skipSaturday)) {
    const dow = new Date().toLocaleDateString('en-US', { timeZone: 'Asia/Jerusalem', weekday: 'long' });
    if ((rec.skipFriday && dow === 'Friday') || (rec.skipSaturday && dow === 'Saturday')) {
      log(`Broadcast "${fresh.label}" skipped — ${dow} excluded by schedule`);
      return;
    }
  }

  log(`Firing broadcast: "${fresh.label}" (${b.cron})`);
  try {
    await broadcastDelivery.send(fresh, fresh.user_id);
  } catch (err) {
    log(`Broadcast "${fresh.label}" error: ${err.message}`, 'error');
  }
}

// Runs the AI product-discovery agent once daily for every user who has at least
// one subject with an AliExpress tracking_id (channel) configured and hasn't opted
// out via the discovery_auto_run_enabled setting. Only fills the review queue
// (product_suggestions) — nothing is added to a user's live product list automatically.
async function startDiscoveryAgent() {
  if (discoveryJob) { discoveryJob.stop(); discoveryJob = null; }
  if (!cron.validate(DISCOVERY_CRON)) {
    log(`Invalid DISCOVERY_CRON: "${DISCOVERY_CRON}" — discovery agent not scheduled`, 'warn');
    return false;
  }
  discoveryJob = cron.schedule(DISCOVERY_CRON, runDiscoveryForAllUsers, { timezone: 'UTC' });
  log(`🔎 Discovery agent scheduled: ${DISCOVERY_CRON} (UTC)`);
  return true;
}

async function runDiscoveryForAllUsers() {
  let userIds = [];
  try {
    const { rows } = await query(`
      SELECT DISTINCT s.user_id
      FROM subjects s
      WHERE s.aliexpress_tracking_id IS NOT NULL AND s.aliexpress_tracking_id != ''
        AND NOT EXISTS (
          SELECT 1 FROM settings st
          WHERE st.user_id = s.user_id
            AND st.key = 'discovery_auto_run_enabled'
            AND st.value = 'false'
        )
    `);
    userIds = rows.map(r => r.user_id);
  } catch (err) {
    log(`Discovery agent: could not load eligible users: ${err.message}`, 'error');
    return;
  }

  for (const userId of userIds) {
    const jobLog = (msg, level = 'info') => {
      if (_log) _log(`[scheduler] ${msg}`, level, { userId });
      else console.log(`[scheduler] [${level}] ${msg}`);
    };
    try {
      const result = await runDiscovery(userId);
      jobLog(`Discovery agent: ${result.newCount} new suggestion(s) from ${result.subjectsSearched} subject(s)${result.aiEnabled ? ' (AI)' : ''}`);
    } catch (err) {
      jobLog(`Discovery agent failed: ${err.message}`, 'error');
    }
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

  // Build subject-timezone lookup map (subjects.timezone may not exist on older deploys)
  const subjectTz = {};
  try {
    const { rows } = await query('SELECT id, timezone FROM subjects');
    rows.forEach(r => { subjectTz[r.id] = r.timezone; });
  } catch (_) {
    // column doesn't exist yet — fall through to per-schedule timezone
  }

  stopAll();

  for (const s of schedules) {
    if (!cron.validate(s.cron)) {
      console.warn(`[scheduler] Invalid cron: "${s.cron}" (id: ${s.id})`);
      continue;
    }
    const tz = (s.subject_id && subjectTz[s.subject_id]) || s.timezone || 'UTC';
    activeJobs[s.id] = cron.schedule(s.cron, () => runJob(s), { timezone: tz });
    log(`Registered: "${s.label}" → ${s.cron} (${tz})`);
  }

  if (schedules.length) {
    log(`📅 ${schedules.length} schedule(s) active: ${schedules.map(s => `"${s.label}"`).join(', ')}`);
  } else {
    log('No enabled schedules found');
  }

  return schedules.length;
}

async function runJob(s) {
  // Use a scoped logger so entries carry userId/subjectId and appear in the SSE panel
  const scope = { userId: s.user_id, subjectId: s.subject_id || null };
  const jobLog = (msg, level = 'info') => {
    if (_log) _log(`[scheduler] ${msg}`, level, scope);
    else console.log(`[scheduler] [${level}] ${msg}`);
  };
  jobLog(`Firing job: "${s.label}" (${s.cron})`);
  if (_runWorkflow) {
    try {
      await _runWorkflow({ userId: s.user_id, subject: s.subject_id || undefined });
    } catch (err) {
      jobLog(`Workflow error in job "${s.label}": ${err.message}`, 'error');
    }
  } else {
    jobLog('No workflow runner registered — job skipped', 'warn');
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
    id:       s.id,
    label:    s.label,
    cron:     s.cron,
    timezone: s.timezone || 'UTC',
    enabled:  s.enabled,
    subject:  s.subject_id || '',
    active:   s.enabled && !!activeJobs[s.id],
  };
}

async function add({ userId, label, cron: cronExpr, timezone = 'UTC', enabled = true, subjectId = null }) {
  if (!cron.validate(cronExpr)) throw new Error(`Invalid cron expression: ${cronExpr}`);
  const { rows } = await query(
    `INSERT INTO schedules (user_id, subject_id, label, cron, timezone, enabled)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [userId, subjectId, label, cronExpr, timezone, enabled]
  );
  await startAll();
  return _formatRow(rows[0]);
}

async function update(id, userId, { label, cron: cronExpr, timezone, enabled, subject }) {
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
       timezone   = COALESCE($3, timezone),
       enabled    = COALESCE($4, enabled),
       subject_id = $5,
       updated_at = NOW()
     WHERE id = $6 AND user_id = $7
     RETURNING *`,
    [
      label    ?? null,
      cronExpr ?? null,
      timezone ?? null,
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
  startDiscoveryAgent,
  add, update, remove,
  setWorkflowRunner, setLogger, fireNow,
};
