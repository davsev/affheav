const express = require('express');
const router = express.Router();
const promptStore = require('../services/promptStore');
const { setSetting } = require('../services/googleSheets');

// GET /api/prompt?channel=fishing — get prompt for a channel
router.get('/', (req, res) => {
  const channelId = req.query.channel || 'fishing';
  res.json({ prompt: promptStore.get(channelId) });
});

// POST /api/prompt — update prompt for a channel, persists to Google Sheets
router.post('/', async (req, res) => {
  const { prompt, channel: channelId = 'fishing' } = req.body;
  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'prompt is required' });
  }
  promptStore.set(channelId, prompt);
  try {
    await setSetting(`openai_prompt_${channelId}`, prompt);
  } catch (e) {
    console.warn('Could not persist prompt to Sheets:', e.message);
  }
  res.json({ ok: true });
});

// POST /api/prompt/reset — reset to default for a channel
router.post('/reset', async (req, res) => {
  const { channel: channelId = 'fishing' } = req.body;
  promptStore.reset(channelId);
  try {
    await setSetting(`openai_prompt_${channelId}`, promptStore.getDefault());
  } catch (e) {
    console.warn('Could not persist reset prompt to Sheets:', e.message);
  }
  res.json({ ok: true, prompt: promptStore.getDefault() });
});

module.exports = router;
