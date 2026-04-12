const express = require('express');
const router = express.Router();
const scheduler = require('../scheduler');

router.get('/', async (req, res) => {
  try {
    const { query } = require('../db');
    const { rows } = await query(
      'SELECT * FROM schedules WHERE user_id = $1 ORDER BY created_at ASC',
      [req.user.id]
    );
    const activeJobs = scheduler.getActiveJobs();
    const schedules = rows.map(s => ({
      id:      s.id,
      label:   s.label,
      cron:    s.cron,
      enabled: s.enabled,
      subject: s.subject_id || '',
      active:  s.enabled && !!activeJobs[s.id],
    }));
    res.json({ success: true, schedules });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/', async (req, res) => {
  const { label, cron, enabled, subject } = req.body;
  if (!label || !cron) return res.status(400).json({ success: false, error: 'label and cron are required' });
  try {
    const entry = await scheduler.add({
      userId:    req.user.id,
      label,
      cron,
      enabled,
      subjectId: subject || null,
    });
    res.json({ success: true, schedule: entry });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const updated = await scheduler.update(req.params.id, req.user.id, req.body);
    res.json({ success: true, schedule: updated });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/:id/fire', async (req, res) => {
  try {
    await scheduler.fireNow(req.params.id, req.user.id);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await scheduler.remove(req.params.id, req.user.id);
    res.json({ success: true });
  } catch (err) {
    res.status(404).json({ success: false, error: err.message });
  }
});

module.exports = router;
