const express = require('express');
const router  = express.Router();
const { listUsers, findUserById, updateUserById, deleteUser } = require('../services/userService');
const { createInvitation, listInvitations, deleteInvitation, validateToken } = require('../services/inviteService');
const { query } = require('../db');
const { getSubjects, getAllProducts, markMigratedToDb } = require('../services/googleSheets');

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

// ── Admin: one-time migrate subjects from Google Sheets → PostgreSQL ──────────
router.post('/migrate-subjects', isAdmin, async (req, res) => {
  try {
    const { rows: adminRows } = await query(
      `SELECT id, email FROM users WHERE id = $1 LIMIT 1`,
      [req.user.id]
    );
    if (!adminRows.length) {
      return res.status(400).json({ success: false, error: 'Admin user not found in DB' });
    }
    const adminId = adminRows[0].id;

    const subjects = await getSubjects();
    if (!subjects.length) {
      return res.json({ success: true, inserted: 0, skipped: 0, message: 'No subjects found in Google Sheets' });
    }

    let inserted = 0;
    let skipped  = 0;
    const details = [];

    for (const s of subjects) {
      const { rows: existing } = await query(
        `SELECT id FROM subjects WHERE user_id = $1 AND name = $2 LIMIT 1`,
        [adminId, s.name]
      );
      if (existing.length) {
        details.push(`skipped: ${s.name}`);
        skipped++;
        continue;
      }

      await query(
        `INSERT INTO subjects
           (user_id, name, macrodroid_url, facebook_page_id, facebook_token,
            facebook_app_id, facebook_app_secret, instagram_account_id,
            join_link, openai_prompt, wa_enabled, fb_enabled, instagram_enabled)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          adminId,
          s.name,
          s.whatsappUrl        || null,
          s.facebookPageId     || null,
          s.facebookToken      || null,
          s.facebookAppId      || null,
          s.facebookAppSecret  || null,
          s.instagramAccountId || null,
          s.joinLink           || null,
          s.prompt             || null,
          s.waEnabled          !== false,
          s.fbEnabled          !== false,
          s.instagramEnabled   === true,
        ]
      );

      if (s.waGroupName) {
        const { rows: newSubj } = await query(
          `SELECT id FROM subjects WHERE user_id = $1 AND name = $2 LIMIT 1`,
          [adminId, s.name]
        );
        if (newSubj.length) {
          await query(
            `INSERT INTO whatsapp_groups (user_id, subject_id, name, wa_group, join_link)
             VALUES ($1, $2, $3, $4, $5)`,
            [adminId, newSubj[0].id, s.waGroupName, s.waGroupName, s.joinLink || null]
          );
          details.push(`migrated: ${s.name} + group: ${s.waGroupName}`);
        }
      } else {
        details.push(`migrated: ${s.name}`);
      }
      inserted++;
    }

    res.json({ success: true, inserted, skipped, details });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Admin: one-time migrate products from Google Sheets → PostgreSQL ──────────
router.post('/migrate-products', isAdmin, async (req, res) => {
  try {
    const userId = req.user.id;

    // Load subjects from Postgres to map subject-id strings → UUIDs
    const { rows: dbSubjects } = await query(
      'SELECT id, name FROM subjects WHERE user_id = $1',
      [userId]
    );

    // Also load Google Sheets subjects to map old subject id → subject name → Postgres UUID
    const sheetsSubjects = await getSubjects();
    const subjectIdMap = {}; // sheets-subject-id → postgres-uuid
    for (const s of sheetsSubjects) {
      const match = dbSubjects.find(d => d.name === s.name);
      if (match) subjectIdMap[s.id] = match.id;
    }

    // Load all products from Google Sheets (including those without spoo.me link)
    const sheetsProducts = await getAllProducts({ includeAll: true });

    // Load existing short_links from Postgres to skip duplicates
    const { rows: existingRows } = await query(
      'SELECT short_link FROM products WHERE user_id = $1',
      [userId]
    );
    const existingLinks = new Set(existingRows.map(r => r.short_link).filter(Boolean));

    let inserted = 0;
    let skipped  = 0;
    const details = [];

    // Determine max sort_order
    const { rows: maxRow } = await query(
      'SELECT COALESCE(MAX(sort_order), 0) AS max FROM products WHERE user_id = $1',
      [userId]
    );
    let sortOrder = parseInt(maxRow[0].max) + 1;

    for (const p of sheetsProducts) {
      const key = p.Link || p.long_url;
      if (!key) { skipped++; continue; }

      // Skip if already in DB (by short_link)
      if (p.Link && existingLinks.has(p.Link)) {
        details.push(`skipped (exists): ${p.Text?.slice(0, 40) || p.Link}`);
        skipped++;
        continue;
      }

      // Resolve subject UUID
      const subjectPgId = p.subject ? (subjectIdMap[p.subject] || null) : null;

      await query(
        `INSERT INTO products
           (user_id, subject_id, long_url, short_link, image, text,
            join_link, wa_group, sent_at, facebook_at, instagram_at,
            clicks, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          userId,
          subjectPgId,
          p.long_url  || null,
          p.Link      || null,
          p.image     || null,
          p.Text      || null,
          p.join_link || null,
          p.wa_group  || null,
          p.sent      ? new Date(p.sent)     : null,
          p.facebook  ? new Date(p.facebook) : null,
          p.instagram ? new Date(p.instagram): null,
          p.clicks    ?? 0,
          sortOrder++,
        ]
      );

      // Mark row in Google Sheets (column D = "✓ DB")
      try { await markMigratedToDb(p.row_number); } catch { /* non-fatal */ }

      details.push(`imported: ${p.Text?.slice(0, 40) || p.Link}`);
      inserted++;
    }

    res.json({ success: true, inserted, skipped, details });
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
