/**
 * routes/whatsapp.js
 *
 * Multi-instance/phone WhatsApp Web JS management API.
 * All routes require authentication. Admin-only routes are marked.
 */
const express = require('express');
const router  = express.Router();
const manager = require('../services/whatsapp/instanceManager');

// ── Instances ──────────────────────────────────────────────────────────────

/** List all instances (with phones) for the current user */
router.get('/instances', async (req, res) => {
  try {
    const instances = await manager.listInstances(req.user.id);
    res.json({ success: true, instances });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/** Create a new instance */
router.post('/instances', async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name) return res.status(400).json({ success: false, error: 'name required' });
    const instance = await manager.createInstance(req.user.id, { name, description });
    res.json({ success: true, instance });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/** Delete an instance (disconnects all phones in it) */
router.delete('/instances/:id', async (req, res) => {
  try {
    await manager.deleteInstance(Number(req.params.id));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Phones ─────────────────────────────────────────────────────────────────

/** Add a phone to an instance (starts QR flow) */
router.post('/instances/:id/phones', async (req, res) => {
  try {
    const { displayName } = req.body;
    const phone = await manager.addPhone(Number(req.params.id), { displayName });
    res.json({ success: true, phone });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/** Remove a phone */
router.delete('/phones/:id', async (req, res) => {
  try {
    await manager.removePhone(Number(req.params.id));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/** Reconnect a phone (restart wwebjs client) */
router.post('/phones/:id/reconnect', async (req, res) => {
  try {
    await manager.reconnectPhone(Number(req.params.id));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/** Logout a phone (clear session, triggers new QR) */
router.post('/phones/:id/logout', async (req, res) => {
  try {
    await manager.logoutPhone(Number(req.params.id));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/** Get status of a phone */
router.get('/phones/:id/status', (req, res) => {
  const status = manager.getPhoneStatus(Number(req.params.id));
  res.json({ success: true, status });
});

/** SSE stream — emits QR code (data: {qr}) then ready (data: {ready:true}) */
router.get('/phones/:id/qr', (req, res) => {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();

  manager.subscribeQr(Number(req.params.id), res);

  req.on('close', () => res.end());
});

/** List WhatsApp groups visible to this phone */
router.get('/phones/:id/groups', async (req, res) => {
  try {
    const groups = await manager.getPhoneGroups(Number(req.params.id));
    res.json({ success: true, groups });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
