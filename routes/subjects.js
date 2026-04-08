const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { getSubjects, saveSubjects } = require('../services/googleSheets');

// Fields that are never sent to the client — only a boolean presence indicator is sent
const SENSITIVE = ['whatsappUrl', 'facebookToken', 'facebookAppId', 'facebookAppSecret', 'instagramAccountId'];

function stripSensitive(subject) {
  const out = { ...subject };
  SENSITIVE.forEach(f => { out[f] = !!subject[f]; }); // true = has value, false = empty
  return out;
}

// GET /api/subjects
router.get('/', async (req, res) => {
  try {
    const subjects = await getSubjects();
    res.json({ success: true, subjects: subjects.map(stripSensitive) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/subjects — create new subject
router.post('/', async (req, res) => {
  const { name, waGroupName, whatsappUrl, facebookPageId, facebookToken, facebookAppId, facebookAppSecret, prompt, waEnabled, fbEnabled, instagramAccountId, instagramEnabled } = req.body;
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
      prompt: prompt || '',
      waEnabled: waEnabled !== false,
      fbEnabled: fbEnabled !== false,
      instagramAccountId: instagramAccountId || '',
      instagramEnabled: instagramEnabled !== false,
    };
    subjects.push(entry);
    await saveSubjects(subjects);
    res.json({ success: true, subject: stripSensitive(entry) });
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

    // Non-sensitive fields: update normally
    const plain = ['name', 'waGroupName', 'facebookPageId', 'prompt', 'waEnabled', 'fbEnabled', 'instagramEnabled'];
    plain.forEach(f => { if (req.body[f] !== undefined) subjects[idx][f] = req.body[f]; });

    // Sensitive fields: only update if a new non-empty value is explicitly provided
    SENSITIVE.forEach(f => {
      if (req.body[f] && typeof req.body[f] === 'string' && req.body[f].trim() !== '') {
        subjects[idx][f] = req.body[f].trim();
      }
    });

    await saveSubjects(subjects);
    res.json({ success: true, subject: stripSensitive(subjects[idx]) });
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
