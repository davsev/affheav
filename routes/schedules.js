const express = require('express');
const router = express.Router();
const scheduler = require('../scheduler');

// GET /api/schedules
router.get('/', (req, res) => {
  try {
    res.json({ success: true, schedules: scheduler.list() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/schedules — add new schedule
router.post('/', (req, res) => {
  const { label, cron, enabled } = req.body;
  if (!label || !cron) {
    return res.status(400).json({ success: false, error: 'label and cron are required' });
  }
  try {
    const entry = scheduler.add({ label, cron, enabled });
    res.json({ success: true, schedule: entry });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// PUT /api/schedules/:id — update
router.put('/:id', (req, res) => {
  try {
    const updated = scheduler.update(req.params.id, req.body);
    res.json({ success: true, schedule: updated });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// DELETE /api/schedules/:id
router.delete('/:id', (req, res) => {
  try {
    scheduler.remove(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(404).json({ success: false, error: err.message });
  }
});

module.exports = router;
