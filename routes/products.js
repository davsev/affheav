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

module.exports = router;
