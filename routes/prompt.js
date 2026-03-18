const express = require('express');
const router = express.Router();
const promptStore = require('../services/promptStore');
const { setSetting } = require('../services/googleSheets');

// GET current prompt
router.get('/', (req, res) => {
  res.json({ prompt: promptStore.get() });
});

// POST update prompt — persists to Google Sheets
router.post('/', async (req, res) => {
  const { prompt } = req.body;
  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'prompt is required' });
  }
  promptStore.set(prompt);
  try {
    await setSetting('openai_prompt', prompt);
  } catch (e) {
    console.warn('Could not persist prompt to Sheets:', e.message);
  }
  res.json({ ok: true });
});

// POST reset to default — also clears from Sheets
router.post('/reset', async (req, res) => {
  promptStore.reset();
  try {
    await setSetting('openai_prompt', promptStore.getDefault());
  } catch (e) {
    console.warn('Could not persist reset prompt to Sheets:', e.message);
  }
  res.json({ ok: true, prompt: promptStore.getDefault() });
});

module.exports = router;
