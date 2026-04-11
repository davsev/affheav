const express = require('express');
const router = express.Router();
const { query } = require('../db');

const SENSITIVE_DISPLAY = ['whatsappUrl', 'facebookToken', 'facebookAppId', 'facebookAppSecret', 'instagramAccountId'];

function rowToSubject(r) {
  return {
    id:                  r.id,
    name:                r.name,
    color:               r.color               || '',
    waGroupName:         r.wa_group            || '',
    joinLink:            r.join_link           || '',
    whatsappUrl:         r.macrodroid_url      || '',
    facebookPageId:      r.facebook_page_id    || '',
    facebookToken:       r.facebook_token      || '',
    facebookAppId:       r.facebook_app_id     || '',
    facebookAppSecret:   r.facebook_app_secret || '',
    instagramAccountId:  r.instagram_account_id|| '',
    prompt:              r.openai_prompt       || '',
    waEnabled:           r.wa_enabled,
    fbEnabled:           r.fb_enabled,
    instagramEnabled:    r.instagram_enabled,
  };
}

function stripSensitive(subject) {
  const out = { ...subject };
  SENSITIVE_DISPLAY.forEach(f => { out[f] = !!subject[f]; });
  return out;
}

// GET /api/subjects
router.get('/', async (req, res) => {
  try {
    const { rows } = await query(
      'SELECT * FROM subjects WHERE user_id = $1 ORDER BY created_at ASC',
      [req.user.id]
    );
    res.json({ success: true, subjects: rows.map(r => stripSensitive(rowToSubject(r))) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/subjects
router.post('/', async (req, res) => {
  const { name, waGroupName, joinLink, whatsappUrl, facebookPageId, facebookToken,
    facebookAppId, facebookAppSecret, instagramAccountId, prompt,
    waEnabled, fbEnabled, instagramEnabled, color } = req.body;
  if (!name) return res.status(400).json({ success: false, error: 'name is required' });
  try {
    const { rows } = await query(`
      INSERT INTO subjects
        (user_id, name, color, wa_group, macrodroid_url, facebook_page_id, facebook_token,
         facebook_app_id, facebook_app_secret, instagram_account_id, join_link, openai_prompt,
         wa_enabled, fb_enabled, instagram_enabled)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      RETURNING *`,
      [
        req.user.id, name, color || null, waGroupName || '', whatsappUrl || '',
        facebookPageId || '', facebookToken || '', facebookAppId || '', facebookAppSecret || '',
        instagramAccountId || '', joinLink || '', prompt || '',
        waEnabled !== false, fbEnabled !== false, instagramEnabled === true,
      ]
    );
    res.json({ success: true, subject: stripSensitive(rowToSubject(rows[0])) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /api/subjects/:id
router.put('/:id', async (req, res) => {
  try {
    const { rows: existing } = await query(
      'SELECT * FROM subjects WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (!existing[0]) return res.status(404).json({ success: false, error: 'Subject not found' });

    const cur = existing[0];
    const b = req.body;
    // Sensitive: only update if a new non-empty value is explicitly provided
    const sens = (newVal, curVal) =>
      (newVal && typeof newVal === 'string' && newVal.trim()) ? newVal.trim() : curVal;

    const { rows } = await query(`
      UPDATE subjects SET
        name                = $1,
        color               = $2,
        wa_group            = $3,
        macrodroid_url      = $4,
        facebook_page_id    = $5,
        facebook_token      = $6,
        facebook_app_id     = $7,
        facebook_app_secret = $8,
        instagram_account_id= $9,
        join_link           = $10,
        openai_prompt       = $11,
        wa_enabled          = $12,
        fb_enabled          = $13,
        instagram_enabled   = $14,
        updated_at          = NOW()
      WHERE id = $15 AND user_id = $16
      RETURNING *`,
      [
        b.name          ?? cur.name,
        b.color         ?? cur.color,
        b.waGroupName   ?? cur.wa_group,
        sens(b.whatsappUrl,        cur.macrodroid_url),
        b.facebookPageId ?? cur.facebook_page_id,
        sens(b.facebookToken,      cur.facebook_token),
        sens(b.facebookAppId,      cur.facebook_app_id),
        sens(b.facebookAppSecret,  cur.facebook_app_secret),
        sens(b.instagramAccountId, cur.instagram_account_id),
        b.joinLink      ?? cur.join_link,
        b.prompt        ?? cur.openai_prompt,
        b.waEnabled     ?? cur.wa_enabled,
        b.fbEnabled     ?? cur.fb_enabled,
        b.instagramEnabled ?? cur.instagram_enabled,
        req.params.id,
        req.user.id,
      ]
    );
    res.json({ success: true, subject: stripSensitive(rowToSubject(rows[0])) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/subjects/:id
router.delete('/:id', async (req, res) => {
  try {
    const { rowCount } = await query(
      'DELETE FROM subjects WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (!rowCount) return res.status(404).json({ success: false, error: 'Subject not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
