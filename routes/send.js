const express = require('express');
const router = express.Router();
const { query } = require('../db');
const workflow = require('../services/workflow');

// POST /api/send/execute — run next unsent product
router.post('/execute', async (req, res) => {
  try {
    const { subject, platforms, waGroupIds } = req.body || {};
    const opts = { userId: req.user.id };
    if (platforms)              opts.platforms  = platforms;
    if (subject !== undefined)  opts.subject    = subject;
    if (waGroupIds)             opts.waGroupIds = waGroupIds;

    // Quick check: are there any unsent products?
    const countQ = subject
      ? await query('SELECT 1 FROM products WHERE user_id=$1 AND subject_id=$2 AND sent_at IS NULL AND short_link IS NOT NULL AND short_link != \'\' LIMIT 1', [req.user.id, subject])
      : await query('SELECT 1 FROM products WHERE user_id=$1 AND sent_at IS NULL AND short_link IS NOT NULL AND short_link != \'\' LIMIT 1', [req.user.id]);
    if (!countQ.rows[0]) {
      return res.json({ success: false, reason: 'no_unsent_products' });
    }

    res.json({ success: true }); // respond immediately — full result appears in logs panel
    workflow.run(null, opts).catch(err => workflow.log(`Execute error: ${err.message}`, 'error'));
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
      skip_ai:   r.skip_ai    || false,
    };

    const { platforms = ['whatsapp', 'facebook', 'instagram'], subject, waGroupIds } = req.body || {};
    const opts = { platforms, userId: req.user.id };
    if (subject !== undefined) opts.subject    = subject;
    if (waGroupIds)            opts.waGroupIds = waGroupIds;
    const result = await workflow.run(product, opts);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
