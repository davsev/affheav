const express = require('express');
const router  = express.Router();
const svc = require('../services/affiliateSourceService');

// GET /api/affiliate-sources
router.get('/', async (req, res) => {
  try {
    const sources = await svc.getSourcesByUser(req.user.id);
    res.json({ success: true, sources });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/affiliate-sources/detect?url=...
router.get('/detect', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.json({ success: true, source: null });
  try {
    const source = await svc.detectSourceByUrl(url, req.user.id);
    res.json({ success: true, source });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/affiliate-sources
router.post('/', async (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ success: false, error: 'name is required' });
  try {
    const source = await svc.createSource(req.user.id, req.body);
    res.json({ success: true, source });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /api/affiliate-sources/:id
router.put('/:id', async (req, res) => {
  try {
    const source = await svc.updateSource(req.params.id, req.user.id, req.body);
    if (!source) return res.status(404).json({ success: false, error: 'Source not found' });
    res.json({ success: true, source });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/affiliate-sources/:id
router.delete('/:id', async (req, res) => {
  try {
    await svc.deleteSource(req.params.id, req.user.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
