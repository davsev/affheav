const fs      = require('fs');
const path    = require('path');
const express = require('express');
const multer  = require('multer');
const { v4: uuidv4 } = require('uuid');
const { listByUser, getById, create, update, remove, setEnabled } = require('../services/broadcastService');
const broadcastDelivery = require('../services/broadcastDelivery');
const scheduler = require('../scheduler');

// ── Upload Setup ───────────────────────────────────────────────────────────────

const UPLOAD_DIR = path.join(__dirname, '../public/uploads/broadcasts');
fs.mkdirSync(UPLOAD_DIR, { recursive: true }); // idempotent — creates on first require

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename:    (req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname).toLowerCase()}`),
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) return cb(null, true);
    cb(new Error('Images only'));
  },
});

// ── Routes ─────────────────────────────────────────────────────────────────────

const router = express.Router();

// GET / — List all broadcasts for the authenticated user
router.get('/', async (req, res) => {
  try {
    const msgs = await listByUser(req.user.id);
    res.json({ success: true, broadcasts: msgs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST / — Create (supports JSON body or multipart with optional image file)
router.post('/', upload.single('image'), async (req, res) => {
  try {
    const { label, text, subjectId } = req.body;
    let recurrence = req.body.recurrence;
    if (typeof recurrence === 'string') recurrence = JSON.parse(recurrence);
    if (!label || !text || !subjectId || !recurrence) {
      return res.status(400).json({ success: false, error: 'label, text, subjectId, recurrence are required' });
    }
    const imageUrl = req.file
      ? `/uploads/broadcasts/${req.file.filename}`
      : (req.body.imageUrl || undefined);
    const shortLink = req.body.shortLink || undefined;
    const msg = await create(req.user.id, { subjectId, label, text, recurrence, imageUrl, shortLink });
    await scheduler.startBroadcasts(); // register new broadcast in cron
    res.status(201).json({ success: true, broadcast: msg });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// GET /:id — Get single broadcast (ownership enforced by service)
router.get('/:id', async (req, res) => {
  try {
    const msg = await getById(req.params.id, req.user.id);
    if (!msg) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, broadcast: msg });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /:id — Update (supports multipart for image replacement)
router.put('/:id', upload.single('image'), async (req, res) => {
  try {
    const fields = {};
    if (req.body.label      !== undefined) fields.label     = req.body.label;
    if (req.body.text       !== undefined) fields.text      = req.body.text;
    if (req.body.subjectId  !== undefined) fields.subjectId = req.body.subjectId;
    if (req.body.recurrence !== undefined) {
      fields.recurrence = typeof req.body.recurrence === 'string'
        ? JSON.parse(req.body.recurrence)
        : req.body.recurrence;
    }
    if (req.file) fields.imageUrl = `/uploads/broadcasts/${req.file.filename}`;
    else if (req.body.imageUrl !== undefined) fields.imageUrl = req.body.imageUrl || null;
    if (req.body.shortLink !== undefined) fields.shortLink = req.body.shortLink || null;
    const msg = await update(req.params.id, req.user.id, fields);
    if (!msg) return res.status(404).json({ success: false, error: 'Not found' });
    await scheduler.startBroadcasts(); // re-register in case recurrence changed
    res.json({ success: true, broadcast: msg });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// DELETE /:id
router.delete('/:id', async (req, res) => {
  try {
    const msg = await remove(req.params.id, req.user.id);
    if (!msg) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /:id/enabled — Toggle enabled state
router.patch('/:id/enabled', async (req, res) => {
  try {
    const { enabled } = req.body;
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ success: false, error: 'enabled must be a boolean' });
    }
    const msg = await setEnabled(req.params.id, req.user.id, enabled);
    if (!msg) return res.status(404).json({ success: false, error: 'Not found' });
    await scheduler.startBroadcasts(); // sync cron jobs with DB state
    res.json({ success: true, broadcast: msg });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /:id/image — Standalone image upload (replace image on existing record)
router.post('/:id/image', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'No image provided' });
    const imageUrl = `/uploads/broadcasts/${req.file.filename}`;
    const msg = await update(req.params.id, req.user.id, { imageUrl });
    if (!msg) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, broadcast: msg });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// POST /:id/fire-now — Trigger delivery immediately (async, matches schedules.js pattern)
router.post('/:id/fire-now', async (req, res) => {
  try {
    const msg = await getById(req.params.id, req.user.id);
    if (!msg) return res.status(404).json({ success: false, error: 'Not found' });
    // Respond immediately; delivery runs async (matches schedules.js pattern)
    res.json({ success: true, fired: true });
    broadcastDelivery.send(msg, req.user.id).catch(err => {
      console.error(`[broadcasts] fire-now error for broadcast ${msg.id}: ${err.message}`);
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Error Handler ──────────────────────────────────────────────────────────────

// eslint-disable-next-line no-unused-vars
router.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ success: false, error: 'File too large (max 10 MB)' });
  }
  if (err.message === 'Images only') {
    return res.status(400).json({ success: false, error: 'Only image files are accepted' });
  }
  next(err);
});

module.exports = router;
