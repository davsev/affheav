const express = require('express');
const router  = express.Router();
const { listUsers, findUserById, updateUserById, deleteUser } = require('../services/userService');
const { createInvitation, listInvitations, deleteInvitation, validateToken } = require('../services/inviteService');

const isAdmin = (req, res, next) => {
  if (req.user?.role === 'admin') return next();
  res.status(403).json({ success: false, error: 'Forbidden' });
};

// ── Current user ──────────────────────────────────────────────────────────────
router.get('/me', (req, res) => {
  const { id, email, name, photo, role } = req.user;
  res.json({ success: true, user: { id, email, name, photo, role } });
});

// ── Admin: list all users ─────────────────────────────────────────────────────
router.get('/', isAdmin, async (req, res) => {
  try {
    const users = await listUsers();
    res.json({ success: true, users });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Admin: update user role / status ─────────────────────────────────────────
router.put('/:id', isAdmin, async (req, res) => {
  try {
    const { role, status } = req.body;

    const validRoles    = ['admin', 'user'];
    const validStatuses = ['active', 'suspended'];

    if (role   && !validRoles.includes(role))     return res.status(400).json({ success: false, error: 'Invalid role' });
    if (status && !validStatuses.includes(status)) return res.status(400).json({ success: false, error: 'Invalid status' });

    // Prevent admin from demoting themselves
    if (req.params.id === req.user.id && role === 'user') {
      return res.status(400).json({ success: false, error: 'Cannot change your own role' });
    }

    const user = await updateUserById(req.params.id, { role, status });
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });

    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Admin: delete user ────────────────────────────────────────────────────────
router.delete('/:id', isAdmin, async (req, res) => {
  try {
    if (req.params.id === req.user.id) {
      return res.status(400).json({ success: false, error: 'Cannot delete your own account' });
    }
    await deleteUser(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Admin: send invite ────────────────────────────────────────────────────────
router.post('/invites', isAdmin, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, error: 'Email required' });

    const inv = await createInvitation({ email, invitedBy: req.user.id });

    const baseUrl   = process.env.APP_BASE_URL || `${req.protocol}://${req.get('host')}`;
    const inviteUrl = `${baseUrl}/auth/invite/${inv.token}`;

    res.json({ success: true, invitation: { ...inv, inviteUrl } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Admin: list invitations ───────────────────────────────────────────────────
router.get('/invites', isAdmin, async (req, res) => {
  try {
    const invitations = await listInvitations();
    res.json({ success: true, invitations });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Admin: delete invitation ──────────────────────────────────────────────────
router.delete('/invites/:id', isAdmin, async (req, res) => {
  try {
    await deleteInvitation(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Public: validate invite token (for UI feedback) ───────────────────────────
router.get('/invites/validate/:token', async (req, res) => {
  try {
    const inv = await validateToken(req.params.token);
    if (!inv) return res.status(400).json({ success: false, error: 'Invalid or expired invite' });
    res.json({ success: true, email: inv.email });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
