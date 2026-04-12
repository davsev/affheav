const express = require('express');
const router = express.Router();
const promptStore = require('../services/promptStore');
const { query } = require('../db');

async function persistPrompt(userId, value) {
  await query(
    `INSERT INTO settings (user_id, key, value)
     VALUES ($1, 'openai_prompt', $2)
     ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [userId, value]
  );
}

// GET current prompt
router.get('/', (req, res) => {
  res.json({ prompt: promptStore.get() });
});

// POST update prompt — persists to DB
router.post('/', async (req, res) => {
  const { prompt } = req.body;
  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'prompt is required' });
  }
  promptStore.set(prompt);
  try {
    await persistPrompt(req.user.id, prompt);
  } catch (e) {
    console.warn('Could not persist prompt to DB:', e.message);
  }
  res.json({ ok: true });
});

// POST reset to default
router.post('/reset', async (req, res) => {
  promptStore.reset();
  try {
    await persistPrompt(req.user.id, promptStore.getDefault());
  } catch (e) {
    console.warn('Could not persist reset prompt to DB:', e.message);
  }
  res.json({ ok: true, prompt: promptStore.getDefault() });
});

module.exports = router;
