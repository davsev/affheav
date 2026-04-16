const { query } = require('../db');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');

// ── Private Helpers ────────────────────────────────────────────────────────────

/**
 * Convert a human-readable recurrence object to a cron expression string.
 * Throws a descriptive Error on any validation failure.
 *
 * @param {{ mode: string, hour: number, minute?: number, day?: number, n?: number, skipFriday?: boolean, skipSaturday?: boolean }} recurrence
 * @returns {string} cron expression
 */
function recurrenceToCron(recurrence) {
  if (!recurrence || typeof recurrence !== 'object') {
    throw new Error('recurrence must be an object');
  }

  const VALID_MODES = ['daily', 'weekly', 'every_n_days'];
  const { mode, hour, minute = 0, day, n, skipFriday = false, skipSaturday = false } = recurrence;

  if (!VALID_MODES.includes(mode)) {
    throw new Error(`Invalid recurrence mode: ${mode}. Must be one of: ${VALID_MODES.join(', ')}`);
  }

  const hourInt   = parseInt(hour, 10);
  const minuteInt = parseInt(minute, 10);
  if (!Number.isInteger(hourInt)   || hourInt   < 0 || hourInt   > 23) throw new Error('hour must be 0–23');
  if (!Number.isInteger(minuteInt) || minuteInt < 0 || minuteInt > 59) throw new Error('minute must be 0–59');

  // Build day-of-week restriction for daily mode (0=Sun … 6=Sat)
  // For every_n_days the skip is enforced at runtime (cron OR-semantics break it)
  let dowExpr = '*';
  if (mode === 'daily' && (skipFriday || skipSaturday)) {
    const allowed = [0, 1, 2, 3, 4, 5, 6].filter(d => !(skipFriday && d === 5) && !(skipSaturday && d === 6));
    dowExpr = allowed.join(',');
  }

  let expr;

  if (mode === 'daily') {
    expr = `${minuteInt} ${hourInt} * * ${dowExpr}`;
  } else if (mode === 'weekly') {
    const dayInt = parseInt(day, 10);
    if (!Number.isInteger(dayInt) || dayInt < 0 || dayInt > 6) {
      throw new Error('day must be an integer between 0 (Sun) and 6 (Sat) for weekly mode');
    }
    expr = `${minuteInt} ${hourInt} * * ${dayInt}`;
  } else if (mode === 'every_n_days') {
    const nInt = parseInt(n, 10);
    if (!Number.isInteger(nInt) || nInt < 1 || nInt > 30) {
      throw new Error('n must be an integer between 1 and 30 for every_n_days mode');
    }
    expr = `${minuteInt} ${hourInt} */${nInt} * *`;
  }

  if (!cron.validate(expr)) {
    throw new Error('Invalid recurrence parameters');
  }

  return expr;
}

/**
 * Compute the next fire time for a broadcast message.
 * Returns null when enabled is false or recurrence is absent.
 * Uses Asia/Jerusalem timezone for all date calculations.
 *
 * @param {{ mode: string, hour: number, day?: number, n?: number }|null} recurrence
 * @param {boolean} enabled
 * @returns {string|null} ISO 8601 string or null
 */
function computeNextRun(recurrence, enabled) {
  if (!enabled || !recurrence) return null;

  const { mode, hour, minute = 0, day, n } = recurrence;
  const hourInt   = parseInt(hour, 10);
  const minuteInt = parseInt(minute, 10);
  const now = new Date();

  // Get local time in Jerusalem timezone
  const jerusalemStr = now.toLocaleString('en-US', {
    timeZone: 'Asia/Jerusalem',
    hour12: false,
  });

  // Parse "M/D/YYYY, HH:MM:SS" format returned by toLocaleString
  const [datePart, timePart] = jerusalemStr.split(', ');
  const [monthStr, dayStr, yearStr] = datePart.split('/');
  const [localHourStr, localMinuteStr] = timePart.split(':');

  const localHour   = parseInt(localHourStr, 10);
  const localMinute = parseInt(localMinuteStr, 10);
  const localDay = new Date(`${yearStr}-${monthStr.padStart(2, '0')}-${dayStr.padStart(2, '0')}`).getDay(); // 0=Sun

  // Helper: has the fire time passed today?
  const pastToday = localHour > hourInt || (localHour === hourInt && localMinute >= minuteInt);

  // Start next from now with seconds/ms zeroed (working in UTC)
  const next = new Date(now);
  next.setUTCSeconds(0);
  next.setUTCMilliseconds(0);

  if (mode === 'daily') {
    if (pastToday) {
      // Already past today's fire time — advance to tomorrow
      next.setUTCDate(next.getUTCDate() + 1);
    }
    _setJerusalemTime(next, hourInt, minuteInt);

  } else if (mode === 'weekly') {
    const dayInt = parseInt(day, 10);
    let daysUntil = (dayInt - localDay + 7) % 7;
    if (daysUntil === 0 && pastToday) {
      daysUntil = 7;
    }
    next.setUTCDate(next.getUTCDate() + daysUntil);
    _setJerusalemTime(next, hourInt, minuteInt);

  } else if (mode === 'every_n_days') {
    const nInt = parseInt(n, 10);
    if (pastToday) {
      next.setUTCDate(next.getUTCDate() + 1);
    }
    _setJerusalemTime(next, hourInt, minuteInt);

    // Snap forward to the next calendar anchor: smallest date >= next where (date - 1) % n === 0
    // "date" here is the day-of-month in Jerusalem time
    let attempts = 0;
    while (attempts < 35) {
      const d = _getJerusalemDayOfMonth(next);
      if ((d - 1) % nInt === 0) break;
      next.setUTCDate(next.getUTCDate() + 1);
      attempts++;
    }
  }

  return next.toISOString();
}

/**
 * Set the UTC hours on a Date so that the wall-clock hour in Jerusalem equals targetHour.
 * This is an approximation: computes the current Jerusalem UTC offset and applies it.
 *
 * @param {Date} date
 * @param {number} targetHour   - 0–23 local Jerusalem hour
 * @param {number} targetMinute - 0–59 local Jerusalem minute
 */
function _setJerusalemTime(date, targetHour, targetMinute = 0) {
  // Compute Jerusalem UTC offset at this date
  const utcMs = date.getTime();
  const jerusalemStr = new Date(utcMs).toLocaleString('en-US', {
    timeZone: 'Asia/Jerusalem',
    hour12: false,
  });
  const [, timePart] = jerusalemStr.split(', ');
  const localHourNow = parseInt(timePart.split(':')[0], 10);
  const utcHourNow = date.getUTCHours();
  const offsetHours = localHourNow - utcHourNow;

  date.setUTCHours(targetHour - offsetHours);
  date.setUTCMinutes(targetMinute);
}

/**
 * Get the Jerusalem day-of-month for a given Date.
 *
 * @param {Date} date
 * @returns {number}
 */
function _getJerusalemDayOfMonth(date) {
  const str = date.toLocaleString('en-US', {
    timeZone: 'Asia/Jerusalem',
    hour12: false,
  });
  const [datePart] = str.split(', ');
  return parseInt(datePart.split('/')[1], 10);
}

const DAY_NAMES_HE = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

/**
 * Convert a recurrence object to a human-readable Hebrew description.
 *
 * @param {{ mode: string, hour: number, minute?: number, day?: number, n?: number, skipFriday?: boolean, skipSaturday?: boolean }|null} recurrence
 * @returns {string}
 */
function recurrenceToDescription(recurrence) {
  if (!recurrence) return '';
  const { mode, hour, minute = 0, day, n, skipFriday = false, skipSaturday = false } = recurrence;
  const hh = String(parseInt(hour, 10)).padStart(2, '0');
  const mm = String(parseInt(minute, 10)).padStart(2, '0');
  const t  = `${hh}:${mm}`;

  let skip = '';
  if (skipFriday && skipSaturday) skip = ' (לא שישי ושבת)';
  else if (skipFriday)            skip = ' (לא שישי)';
  else if (skipSaturday)          skip = ' (לא שבת)';

  if (mode === 'daily')        return `כל יום ב-${t}${skip}`;
  if (mode === 'weekly')       return `כל יום ${DAY_NAMES_HE[parseInt(day, 10)] || ''} ב-${t}`;
  if (mode === 'every_n_days') return `כל ${n} ימים ב-${t}${skip}`;
  return '';
}

/**
 * Convert a DB row to the API object shape.
 *
 * @param {object|null} r
 * @returns {object|null}
 */
function _row(r) {
  if (!r) return null;
  return {
    id:                 r.id,
    userId:             r.user_id,
    subjectId:          r.subject_id,
    label:              r.label,
    text:               r.text,
    imageUrl:           r.image_url,
    recurrence:         r.recurrence,
    cron:               r.cron,
    enabled:            r.enabled,
    scheduleDescription: recurrenceToDescription(r.recurrence),
    nextRunAt:          computeNextRun(r.recurrence, r.enabled),
    createdAt:          r.created_at,
    updatedAt:          r.updated_at,
  };
}

// ── CRUD ───────────────────────────────────────────────────────────────────────

/**
 * List all broadcast messages for a user, newest first.
 *
 * @param {string} userId
 * @returns {Promise<object[]>}
 */
async function listByUser(userId) {
  const { rows } = await query(
    'SELECT * FROM broadcast_messages WHERE user_id = $1 ORDER BY created_at DESC',
    [userId]
  );
  return rows.map(_row);
}

/**
 * Get a single broadcast message by ID (scoped to user).
 *
 * @param {string} id
 * @param {string} userId
 * @returns {Promise<object|null>}
 */
async function getById(id, userId) {
  const { rows } = await query(
    'SELECT * FROM broadcast_messages WHERE id = $1 AND user_id = $2',
    [id, userId]
  );
  return _row(rows[0]);
}

/**
 * Create a new broadcast message.
 *
 * @param {string} userId
 * @param {{ subjectId: string, label: string, text: string, recurrence: object, imageUrl?: string }} fields
 * @returns {Promise<object>}
 */
async function create(userId, fields) {
  const { subjectId, label, text, recurrence, imageUrl } = fields;

  // Validate subject ownership
  const { rows: subjectRows } = await query(
    'SELECT id FROM subjects WHERE id = $1 AND user_id = $2',
    [subjectId, userId]
  );
  if (subjectRows.length === 0) {
    throw new Error('Invalid subject');
  }

  // Convert recurrence to cron string
  const cronExpr = recurrenceToCron(recurrence);

  const { rows } = await query(
    `INSERT INTO broadcast_messages
       (user_id, subject_id, label, text, image_url, recurrence, cron)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [userId, subjectId, label, text, imageUrl || null, JSON.stringify(recurrence), cronExpr]
  );
  return _row(rows[0]);
}

/**
 * Update a broadcast message (partial update).
 *
 * @param {string} id
 * @param {string} userId
 * @param {{ label?: string, text?: string, recurrence?: object, imageUrl?: string, subjectId?: string }} fields
 * @returns {Promise<object|null>}
 */
async function update(id, userId, fields) {
  // Validate subject ownership if changing subject
  if (fields.subjectId !== undefined) {
    const { rows: subjectRows } = await query(
      'SELECT id FROM subjects WHERE id = $1 AND user_id = $2',
      [fields.subjectId, userId]
    );
    if (subjectRows.length === 0) {
      throw new Error('Invalid subject');
    }
  }

  // If replacing image, fetch current row to delete old file
  if (fields.imageUrl !== undefined) {
    const oldRow = await getById(id, userId);
    if (oldRow && oldRow.imageUrl) {
      fs.unlink(path.join(__dirname, '..', 'public', oldRow.imageUrl), err => { /* ignore */ });
    }
  }

  const updates = [];
  const values = [];
  let i = 1;

  if (fields.label !== undefined) {
    updates.push(`label = $${i++}`);
    values.push(fields.label);
  }
  if (fields.text !== undefined) {
    updates.push(`text = $${i++}`);
    values.push(fields.text);
  }
  if (fields.subjectId !== undefined) {
    updates.push(`subject_id = $${i++}`);
    values.push(fields.subjectId);
  }
  if (fields.recurrence !== undefined) {
    const cronExpr = recurrenceToCron(fields.recurrence);
    updates.push(`recurrence = $${i++}`);
    values.push(JSON.stringify(fields.recurrence));
    updates.push(`cron = $${i++}`);
    values.push(cronExpr);
  }
  if (fields.imageUrl !== undefined) {
    updates.push(`image_url = $${i++}`);
    values.push(fields.imageUrl);
  }

  if (updates.length === 0) return getById(id, userId);

  updates.push('updated_at = NOW()');
  values.push(id, userId);

  const { rows } = await query(
    `UPDATE broadcast_messages SET ${updates.join(', ')}
     WHERE id = $${i} AND user_id = $${i + 1}
     RETURNING *`,
    values
  );
  return _row(rows[0]) || null;
}

/**
 * Delete a broadcast message and clean up its image file if present.
 *
 * @param {string} id
 * @param {string} userId
 * @returns {Promise<object|null>} the deleted row object
 */
async function remove(id, userId) {
  const existing = await getById(id, userId);
  if (!existing) return null;

  await query(
    'DELETE FROM broadcast_messages WHERE id = $1 AND user_id = $2',
    [id, userId]
  );

  if (existing.imageUrl) {
    fs.unlink(path.join(__dirname, '..', 'public', existing.imageUrl), err => { /* ignore */ });
  }

  return existing;
}

/**
 * Toggle the enabled flag on a broadcast message.
 *
 * @param {string} id
 * @param {string} userId
 * @param {boolean} enabled
 * @returns {Promise<object|null>}
 */
async function setEnabled(id, userId, enabled) {
  const { rows } = await query(
    'UPDATE broadcast_messages SET enabled = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3 RETURNING *',
    [enabled, id, userId]
  );
  return _row(rows[0]) || null;
}

// ── Exports ────────────────────────────────────────────────────────────────────

module.exports = { listByUser, getById, create, update, remove, setEnabled };
