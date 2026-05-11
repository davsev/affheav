const express = require('express');
const router  = express.Router();
const { query } = require('../db');

// GET /api/settings — return all per-user settings as { key: value }
router.get('/', async (req, res) => {
  try {
    const { rows } = await query(
      'SELECT key, value FROM settings WHERE user_id = $1',
      [req.user.id]
    );
    const settings = Object.fromEntries(rows.map(r => [r.key, r.value]));
    res.json({ success: true, settings });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /api/settings — upsert a single setting
// Body: { key: string, value: string }
router.patch('/', async (req, res) => {
  const { key, value } = req.body || {};
  if (!key) return res.status(400).json({ success: false, error: 'key required' });
  try {
    await query(
      `INSERT INTO settings (user_id, key, value, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (user_id, key) DO UPDATE SET value = $3, updated_at = NOW()`,
      [req.user.id, key, String(value ?? '')]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
