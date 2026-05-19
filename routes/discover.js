const express = require('express');
const router = express.Router();
const { query } = require('../db');
const { runDiscovery } = require('../services/discoveryAgent');

// GET /api/discover — list pending suggestions for authenticated user
router.get('/', async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT
        ps.id, ps.aliexpress_id, ps.title, ps.image_url, ps.promotion_link,
        ps.sale_price, ps.evaluate_rate, ps.lastest_volume, ps.source_keyword,
        ps.status, ps.created_at,
        s.name AS subject_name, s.id AS subject_id
      FROM product_suggestions ps
      LEFT JOIN subjects s ON s.id = ps.subject_id
      WHERE ps.user_id = $1
        AND ps.status = 'pending'
      ORDER BY ps.created_at DESC
      LIMIT 50
    `, [req.user.id]);
    res.json({ success: true, suggestions: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/discover/run — trigger discovery agent
router.post('/run', async (req, res) => {
  try {
    const result = await runDiscovery(req.user.id);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /api/discover/:id — update suggestion status ('added' | 'dismissed')
router.patch('/:id', async (req, res) => {
  const { status } = req.body;
  if (!['added', 'dismissed', 'pending'].includes(status)) {
    return res.status(400).json({ success: false, error: 'status must be added | dismissed | pending' });
  }
  try {
    const { rowCount } = await query(
      `UPDATE product_suggestions SET status = $1 WHERE id = $2 AND user_id = $3`,
      [status, req.params.id, req.user.id]
    );
    if (rowCount === 0) return res.status(404).json({ success: false, error: 'not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
