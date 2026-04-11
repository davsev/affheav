const express = require('express');
const router = express.Router();
const { query } = require('../db');
const workflow = require('../services/workflow');

// POST /api/send/execute — run next unsent product
router.post('/execute', async (req, res) => {
  try {
    const { subject, platforms } = req.body || {};
    const result = await workflow.run(null, {
      userId:    req.user.id,
      subjectId: subject || undefined,
      platforms: platforms || ['whatsapp', 'facebook', 'instagram'],
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/send/:id — send a specific product by UUID
router.post('/:id', async (req, res) => {
  try {
    const { rows } = await query(
      'SELECT * FROM products WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ success: false, error: 'Product not found' });

    const r = rows[0];
    const product = {
      id:        r.id,
      long_url:  r.long_url   || '',
      Link:      r.short_link || '',
      image:     r.image      || '',
      Text:      r.text       || '',
      join_link: r.join_link  || '',
      wa_group:  r.wa_group   || '',
      sent:      r.sent_at    ? new Date(r.sent_at).toISOString() : '',
      subject:   r.subject_id || '',
    };

    const { platforms = ['whatsapp', 'facebook', 'instagram'], subject } = req.body || {};
    const result = await workflow.run(product, {
      userId:    req.user.id,
      subjectId: subject || r.subject_id || undefined,
      platforms,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
