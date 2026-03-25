const express = require('express');
const router = express.Router();
const googleSheets = require('../services/googleSheets');
const channelStore = require('../services/channelStore');

async function resolveSheetName(channelId) {
  if (!channelId) return undefined; // uses googleSheets default
  const ch = await channelStore.getById(channelId);
  return ch?.sheetName || undefined;
}

// GET /api/products?channel=fishing — list all products for a channel
router.get('/', async (req, res) => {
  try {
    const sheetName = await resolveSheetName(req.query.channel);
    const products = await googleSheets.getAllProducts(sheetName);
    res.json({ success: true, products });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/products — add new product manually
router.post('/', async (req, res) => {
  const { Link, image, Text, join_link, wa_group, channel } = req.body;
  if (!Link || !Text) {
    return res.status(400).json({ success: false, error: 'Link and Text are required' });
  }
  try {
    const sheetName = await resolveSheetName(channel);
    await googleSheets.addProduct({ Link, image, Text, join_link, wa_group }, sheetName);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
