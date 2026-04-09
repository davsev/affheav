const express = require('express');
const router = express.Router();
const scheduler = require('../scheduler');

router.get('/', (req, res) => {
  try {
    res.json({ success: true, schedules: scheduler.list() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/', async (req, res) => {
  const { label, cron, enabled, subject } = req.body;
  if (!label || !cron) return res.status(400).json({ success: false, error: 'label and cron are required' });
  try {
    const entry = await scheduler.add({ label, cron, enabled, subject });
    res.json({ success: true, schedule: entry });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const updated = await scheduler.update(req.params.id, req.body);
    res.json({ success: true, schedule: updated });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await scheduler.remove(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(404).json({ success: false, error: err.message });
  }
});

module.exports = router;
