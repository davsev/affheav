const express = require('express');
const router = express.Router();
const promptStore = require('../services/promptStore');

// GET current prompt
router.get('/', (req, res) => {
  res.json({ prompt: promptStore.get() });
});

// POST update prompt
router.post('/', (req, res) => {
  const { prompt } = req.body;
  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'prompt is required' });
  }
  promptStore.set(prompt);
  res.json({ ok: true });
});

// POST reset to default
router.post('/reset', (req, res) => {
  promptStore.reset();
  res.json({ ok: true, prompt: promptStore.getDefault() });
});

module.exports = router;
