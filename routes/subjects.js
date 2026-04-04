const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { getSubjects, saveSubjects } = require('../services/googleSheets');

// GET /api/subjects
router.get('/', async (req, res) => {
  try {
    const subjects = await getSubjects();
    res.json({ success: true, subjects });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/subjects — create new subject
router.post('/', async (req, res) => {
  const { name, waGroupName, whatsappUrl, facebookPageId, facebookToken, facebookAppId, facebookAppSecret } = req.body;
  if (!name) return res.status(400).json({ success: false, error: 'name is required' });

  try {
    const subjects = await getSubjects();
    const entry = {
      id: uuidv4(),
      name,
      waGroupName: waGroupName || '',
      whatsappUrl: whatsappUrl || '',
      facebookPageId: facebookPageId || '',
      facebookToken: facebookToken || '',
      facebookAppId: facebookAppId || '',
      facebookAppSecret: facebookAppSecret || '',
    };
    subjects.push(entry);
    await saveSubjects(subjects);
    res.json({ success: true, subject: entry });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /api/subjects/:id — update subject
router.put('/:id', async (req, res) => {
  try {
    const subjects = await getSubjects();
    const idx = subjects.findIndex(s => s.id === req.params.id);
    if (idx === -1) return res.status(404).json({ success: false, error: 'Subject not found' });

    const fields = ['name', 'waGroupName', 'whatsappUrl', 'facebookPageId', 'facebookToken', 'facebookAppId', 'facebookAppSecret'];
    fields.forEach(f => { if (req.body[f] !== undefined) subjects[idx][f] = req.body[f]; });

    await saveSubjects(subjects);
    res.json({ success: true, subject: subjects[idx] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/subjects/:id
router.delete('/:id', async (req, res) => {
  try {
    const subjects = await getSubjects();
    const idx = subjects.findIndex(s => s.id === req.params.id);
    if (idx === -1) return res.status(404).json({ success: false, error: 'Subject not found' });
    subjects.splice(idx, 1);
    await saveSubjects(subjects);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
