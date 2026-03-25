const express = require('express');
const router = express.Router();
const googleSheets = require('../services/googleSheets');

// GET /api/products — list all
router.get('/', async (req, res) => {
  try {
    const products = await googleSheets.getAllProducts();
    res.json({ success: true, products });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/products — add new product manually
router.post('/', async (req, res) => {
  const { Link, image, Text, join_link, wa_group } = req.body;
  if (!Link || !Text) {
    return res.status(400).json({ success: false, error: 'Link and Text are required' });
  }
  try {
    await googleSheets.addProduct({ Link, image, Text, join_link, wa_group });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/products/reorder — move a row to a new position
// Body: { fromRow, toRow }  (1-based row numbers including header row)
router.post('/reorder', async (req, res) => {
  const { fromRow, toRow } = req.body;
  if (!fromRow || !toRow || fromRow === toRow) {
    return res.status(400).json({ success: false, error: 'fromRow and toRow required and must differ' });
  }
  try {
    await googleSheets.moveRow(fromRow, toRow);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
