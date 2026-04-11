const express = require('express');
const router  = express.Router();
const {
  getSubjectsByUser, getSubjectById, createSubject, updateSubject, deleteSubject,
  stripSensitive,
  getGroupsBySubject, getAllGroupsByUser, createGroup, updateGroup, deleteGroup,
} = require('../services/subjectService');

// GET /api/subjects
router.get('/', async (req, res) => {
  try {
    const subjects = await getSubjectsByUser(req.user.id);
    res.json({ success: true, subjects: subjects.map(stripSensitive) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/subjects
router.post('/', async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ success: false, error: 'name is required' });
  try {
    const subject = await createSubject(req.user.id, req.body);
    res.json({ success: true, subject: stripSensitive(subject) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /api/subjects/:id
router.put('/:id', async (req, res) => {
  try {
    const subject = await updateSubject(req.params.id, req.user.id, req.body);
    if (!subject) return res.status(404).json({ success: false, error: 'Niche not found' });
    res.json({ success: true, subject: stripSensitive(subject) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/subjects/:id
router.delete('/:id', async (req, res) => {
  try {
    await deleteSubject(req.params.id, req.user.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── WhatsApp Groups ────────────────────────────────────────────────────────────

// GET /api/subjects/whatsapp-groups  — all groups for the logged-in user
router.get('/whatsapp-groups', async (req, res) => {
  try {
    const groups = await getAllGroupsByUser(req.user.id);
    res.json({ success: true, groups });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/subjects/:id/whatsapp-groups
router.get('/:id/whatsapp-groups', async (req, res) => {
  try {
    const groups = await getGroupsBySubject(req.params.id, req.user.id);
    res.json({ success: true, groups });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/subjects/:id/whatsapp-groups
router.post('/:id/whatsapp-groups', async (req, res) => {
  const { name, waGroup, joinLink } = req.body;
  if (!name || !waGroup) return res.status(400).json({ success: false, error: 'name and waGroup are required' });
  try {
    const group = await createGroup(req.user.id, {
      subjectId: req.params.id,
      name,
      waGroup,
      joinLink,
    });
    res.json({ success: true, group });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /api/subjects/whatsapp-groups/:groupId
router.put('/whatsapp-groups/:groupId', async (req, res) => {
  try {
    const group = await updateGroup(req.params.groupId, req.user.id, req.body);
    if (!group) return res.status(404).json({ success: false, error: 'Group not found' });
    res.json({ success: true, group });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/subjects/whatsapp-groups/:groupId
router.delete('/whatsapp-groups/:groupId', async (req, res) => {
  try {
    await deleteGroup(req.params.groupId, req.user.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
