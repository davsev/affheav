const { query } = require('../db');

const SENSITIVE = ['facebook_token', 'facebook_app_id', 'facebook_app_secret', 'aliexpress_tracking_id'];

function _row(r) {
  if (!r) return null;
  return {
    id:                  r.id,
    userId:              r.user_id,
    name:                r.name,
    color:               r.color || '',
    macrodroidUrl:       r.macrodroid_url || '',
    facebookPageId:      r.facebook_page_id || '',
    facebookToken:       r.facebook_token || '',
    facebookAppId:       r.facebook_app_id || '',
    facebookAppSecret:   r.facebook_app_secret || '',
    instagramAccountId:  r.instagram_account_id || '',
    joinLink:            r.join_link || '',
    prompt:              r.openai_prompt || '',
    waEnabled:           r.wa_enabled,
    fbEnabled:           r.fb_enabled,
    instagramEnabled:      r.instagram_enabled,
    aliexpressTrackingId:  r.aliexpress_tracking_id || '',
    createdAt:             r.created_at,
    updatedAt:             r.updated_at,
  };
}

function stripSensitive(subject) {
  const out = { ...subject };
  SENSITIVE.forEach(f => {
    const camel = f.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    out[camel] = !!subject[camel];
  });
  return out;
}

async function getSubjectsByUser(userId) {
  const { rows } = await query(
    'SELECT * FROM subjects WHERE user_id = $1 ORDER BY created_at ASC',
    [userId]
  );
  return rows.map(_row);
}

async function getSubjectById(id, userId) {
  const { rows } = await query(
    'SELECT * FROM subjects WHERE id = $1 AND user_id = $2 LIMIT 1',
    [id, userId]
  );
  return _row(rows[0]);
}

async function createSubject(userId, fields) {
  const { rows } = await query(
    `INSERT INTO subjects
       (user_id, name, color, macrodroid_url, facebook_page_id, facebook_token,
        facebook_app_id, facebook_app_secret, instagram_account_id, join_link,
        openai_prompt, wa_enabled, fb_enabled, instagram_enabled, aliexpress_tracking_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     RETURNING *`,
    [
      userId,
      fields.name,
      fields.color                  || null,
      fields.macrodroidUrl          || null,
      fields.facebookPageId         || null,
      fields.facebookToken          || null,
      fields.facebookAppId          || null,
      fields.facebookAppSecret      || null,
      fields.instagramAccountId     || null,
      fields.joinLink               || null,
      fields.prompt                 || null,
      fields.waEnabled              !== false,
      fields.fbEnabled              !== false,
      fields.instagramEnabled       === true,
      fields.aliexpressTrackingId   || null,
    ]
  );
  return _row(rows[0]);
}

async function updateSubject(id, userId, fields) {
  const allowed = {
    name:                 'name',
    color:                'color',
    macrodroidUrl:        'macrodroid_url',
    facebookPageId:       'facebook_page_id',
    facebookToken:        'facebook_token',
    facebookAppId:        'facebook_app_id',
    facebookAppSecret:    'facebook_app_secret',
    instagramAccountId:   'instagram_account_id',
    joinLink:             'join_link',
    prompt:               'openai_prompt',
    waEnabled:              'wa_enabled',
    fbEnabled:              'fb_enabled',
    instagramEnabled:       'instagram_enabled',
    aliexpressTrackingId:   'aliexpress_tracking_id',
  };

  const updates = [];
  const values  = [];
  let   i       = 1;

  for (const [jsKey, col] of Object.entries(allowed)) {
    if (fields[jsKey] !== undefined) {
      // Sensitive: only update if new non-empty value provided
      if (['facebookToken', 'facebookAppId', 'facebookAppSecret', 'aliexpressTrackingId'].includes(jsKey)) {
        if (!fields[jsKey] || fields[jsKey].trim() === '') continue;
      }
      updates.push(`${col} = $${i++}`);
      values.push(fields[jsKey]);
    }
  }
  if (updates.length === 0) return getSubjectById(id, userId);

  updates.push(`updated_at = NOW()`);
  values.push(id, userId);

  const { rows } = await query(
    `UPDATE subjects SET ${updates.join(', ')}
     WHERE id = $${i} AND user_id = $${i + 1}
     RETURNING *`,
    values
  );
  return _row(rows[0]);
}

async function deleteSubject(id, userId) {
  await query('DELETE FROM subjects WHERE id = $1 AND user_id = $2', [id, userId]);
}

// ── WhatsApp Groups ────────────────────────────────────────────────────────────

function _waRow(r) {
  if (!r) return null;
  return {
    id:        r.id,
    userId:    r.user_id,
    subjectId: r.subject_id,
    name:      r.name,
    waGroup:   r.wa_group,
    joinLink:  r.join_link || '',
    createdAt: r.created_at,
  };
}

async function getGroupsBySubject(subjectId, userId) {
  const { rows } = await query(
    `SELECT wg.* FROM whatsapp_groups wg
     JOIN subjects s ON s.id = wg.subject_id
     WHERE wg.subject_id = $1 AND s.user_id = $2
     ORDER BY wg.created_at ASC`,
    [subjectId, userId]
  );
  return rows.map(_waRow);
}

async function getAllGroupsByUser(userId) {
  const { rows } = await query(
    `SELECT wg.* FROM whatsapp_groups wg
     JOIN subjects s ON s.id = wg.subject_id
     WHERE s.user_id = $1
     ORDER BY s.name, wg.name`,
    [userId]
  );
  return rows.map(_waRow);
}

async function createGroup(userId, { subjectId, name, waGroup, joinLink }) {
  // Verify subject belongs to user
  const sub = await getSubjectById(subjectId, userId);
  if (!sub) throw new Error('Niche not found');

  const { rows } = await query(
    `INSERT INTO whatsapp_groups (user_id, subject_id, name, wa_group, join_link)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [userId, subjectId, name, waGroup, joinLink || null]
  );
  return _waRow(rows[0]);
}

async function updateGroup(id, userId, fields) {
  const allowed = { name: 'name', waGroup: 'wa_group', joinLink: 'join_link' };
  const updates = [];
  const values  = [];
  let   i       = 1;

  for (const [jsKey, col] of Object.entries(allowed)) {
    if (fields[jsKey] !== undefined) {
      updates.push(`${col} = $${i++}`);
      values.push(fields[jsKey]);
    }
  }
  if (updates.length === 0) return null;

  updates.push(`updated_at = NOW()`);
  values.push(id, userId);

  const { rows } = await query(
    `UPDATE whatsapp_groups SET ${updates.join(', ')}
     WHERE id = $${i} AND user_id = $${i + 1}
     RETURNING *`,
    values
  );
  return _waRow(rows[0]);
}

async function deleteGroup(id, userId) {
  await query(
    'DELETE FROM whatsapp_groups WHERE id = $1 AND user_id = $2',
    [id, userId]
  );
}

module.exports = {
  getSubjectsByUser,
  getSubjectById,
  createSubject,
  updateSubject,
  deleteSubject,
  stripSensitive,
  getGroupsBySubject,
  getAllGroupsByUser,
  createGroup,
  updateGroup,
  deleteGroup,
};
