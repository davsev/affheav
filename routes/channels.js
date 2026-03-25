const express = require('express');
const router = express.Router();
const channelStore = require('../services/channelStore');

// GET /api/channels — list all channels
router.get('/', async (req, res) => {
  try {
    const channels = await channelStore.getAll();
    res.json({ success: true, channels });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/channels — add a new channel
router.post('/', async (req, res) => {
  const { name, sheetName } = req.body;
  if (!name || !sheetName) {
    return res.status(400).json({ success: false, error: 'name and sheetName are required' });
  }
  try {
    const channel = await channelStore.add({ name, sheetName });
    res.json({ success: true, channel });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// PUT /api/channels/:id — update channel name or sheetName
router.put('/:id', async (req, res) => {
  try {
    const channel = await channelStore.update(req.params.id, req.body);
    res.json({ success: true, channel });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// DELETE /api/channels/:id — remove a channel
router.delete('/:id', async (req, res) => {
  try {
    await channelStore.remove(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(404).json({ success: false, error: err.message });
  }
});

// GET /api/channels/:id/facebook — get Facebook config (no token value exposed)
router.get('/:id/facebook', async (req, res) => {
  try {
    const cfg = await channelStore.getFacebookConfig(req.params.id);
    res.json({ success: true, pageId: cfg.pageId, hasToken: cfg.hasToken });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/channels/:id/facebook — save Facebook Page ID and token
router.post('/:id/facebook', async (req, res) => {
  const { pageId, pageToken } = req.body;
  if (!pageId && !pageToken) {
    return res.status(400).json({ success: false, error: 'pageId or pageToken required' });
  }
  try {
    await channelStore.setFacebookConfig(req.params.id, { pageId, pageToken });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
