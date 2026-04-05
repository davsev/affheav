const express = require('express');
const router = express.Router();
const googleSheets = require('../services/googleSheets');
const workflow = require('../services/workflow');

// POST /api/execute — run next unsent product (optional body: { subject, platforms })
router.post('/execute', async (req, res) => {
  try {
    const { subject, platforms } = req.body || {};
    const opts = {};
    if (platforms) opts.platforms = platforms;
    if (subject !== undefined) opts.subject = subject;
    const result = await workflow.run(null, opts);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/send/:rowNumber — send a specific product by row number
router.post('/:rowNumber', async (req, res) => {
  const rowNumber = parseInt(req.params.rowNumber, 10);
  if (isNaN(rowNumber)) {
    return res.status(400).json({ success: false, error: 'Invalid row number' });
  }

  try {
    const products = await googleSheets.getAllProducts();
    const product = products.find(p => p.row_number === rowNumber);
    if (!product) {
      return res.status(404).json({ success: false, error: 'Product not found' });
    }

    const { platforms = ['whatsapp', 'facebook'], subject } = req.body || {};
    const opts = { platforms };
    if (subject !== undefined) opts.subject = subject;
    const result = await workflow.run(product, opts);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
