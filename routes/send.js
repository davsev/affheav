const express = require('express');
const router = express.Router();
const googleSheets = require('../services/googleSheets');
const channelStore = require('../services/channelStore');
const workflow = require('../services/workflow');

async function resolveChannel(channelId) {
  if (!channelId) return null;
  const ch = await channelStore.getById(channelId);
  if (!ch) return null;
  const fbCfg = await channelStore.getFacebookConfig(channelId);
  return { ...ch, facebookPageId: fbCfg.pageId, facebookPageToken: fbCfg.pageToken };
}

// POST /api/send/execute — run next unsent product for a channel
router.post('/execute', async (req, res) => {
  try {
    const channel = await resolveChannel(req.body?.channel);
    const result = await workflow.run(null, { channel });
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
    const channel = await resolveChannel(req.body?.channel);
    const sheetName = channel?.sheetName || undefined;

    const products = await googleSheets.getAllProducts(sheetName);
    const product = products.find(p => p.row_number === rowNumber);
    if (!product) {
      return res.status(404).json({ success: false, error: 'Product not found' });
    }

    const platforms = req.body?.platforms || ['whatsapp', 'facebook'];
    const result = await workflow.run(product, { platforms, channel });
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
