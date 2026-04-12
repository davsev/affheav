const cron = require('node-cron');
const { query } = require('../db');

let activeJobs = {}; // id → cron.ScheduledTask
let _runWorkflow = null;

function setWorkflowRunner(fn) { _runWorkflow = fn; }
function getActiveJobs() { return activeJobs; }

function stopAll() {
  for (const job of Object.values(activeJobs)) job.stop();
  activeJobs = {};
}

// ── Single-job scheduling ─────────────────────────────────────────────────────
// Stops any existing job for s.id, then schedules it fresh (if enabled).
// Used by add/update so we never restart unrelated running jobs.
function _scheduleOne(s) {
  if (activeJobs[s.id]) {
    activeJobs[s.id].stop();
    delete activeJobs[s.id];
  }
  if (!s.enabled) return;
  if (!cron.validate(s.cron)) {
    console.warn(`[scheduler] Invalid cron: "${s.cron}" (id: ${s.id})`);
    return;
  }
  activeJobs[s.id] = cron.schedule(s.cron, async () => {
    // Acquire advisory lock — prevents duplicate firing when multiple instances run
    let acquired = false;
    try {
      const { rows } = await query(
        `SELECT pg_try_advisory_lock(('x' || substr(md5($1), 1, 16))::bit(64)::bigint) AS acquired`,
        [s.id]
      );
      acquired = rows[0].acquired;
    } catch (err) {
      console.error(`[scheduler] Lock check failed for job ${s.id}:`, err.message);
    }
    if (!acquired) {
      console.log(`[scheduler] Skipping job "${s.label}" — already running on another instance`);
      return;
    }
    console.log(`[scheduler] Firing job: ${s.label} (${s.cron})`);
    try {
      if (_runWorkflow) {
        await _runWorkflow({ userId: s.user_id, subjectId: s.subject_id || undefined });
      }
    } catch (err) {
      console.error(`[scheduler] Workflow error in job ${s.id}:`, err.message);
    } finally {
      await query(
        `SELECT pg_advisory_unlock(('x' || substr(md5($1), 1, 16))::bit(64)::bigint)`,
        [s.id]
      ).catch(e => console.error(`[scheduler] Lock release failed for job ${s.id}:`, e.message));
    }
  }, { timezone: 'Asia/Jerusalem' });
  console.log(`[scheduler] Scheduled: ${s.label} → ${s.cron}`);
}

// ── Bulk startup ──────────────────────────────────────────────────────────────
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
  for (const s of schedules) _scheduleOne(s);
  return schedules.length;
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
  _scheduleOne(rows[0]); // only starts the new job — others keep running
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
      label    ?? null,
      cronExpr ?? null,
      enabled  ?? null,
      subject !== undefined ? (subject || null) : cur.subject_id,
      id, userId,
    ]
  );
  _scheduleOne(rows[0]); // only restarts this job — others keep running
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

module.exports = { startAll, stopAll, getActiveJobs, add, update, remove, setWorkflowRunner };
