const { query } = require('../db');
const { v4: uuidv4 } = require('uuid');

const INVITE_EXPIRY_DAYS = 7;

async function createInvitation({ email, invitedBy }) {
  const token     = uuidv4();
  const expiresAt = new Date(Date.now() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

  const { rows } = await query(
    `INSERT INTO invitations (email, token, invited_by, expires_at)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [email.toLowerCase().trim(), token, invitedBy, expiresAt]
  );
  return rows[0];
}

async function findInvitation(token) {
  const { rows } = await query(
    `SELECT * FROM invitations WHERE token = $1 LIMIT 1`,
    [token]
  );
  return rows[0] || null;
}

async function markUsed(token) {
  await query(
    `UPDATE invitations SET used_at = NOW() WHERE token = $1`,
    [token]
  );
}

async function listInvitations() {
  const { rows } = await query(
    `SELECT i.*, u.name AS inviter_name
     FROM invitations i
     LEFT JOIN users u ON u.id = i.invited_by
     ORDER BY i.created_at DESC`
  );
  return rows;
}

async function deleteInvitation(id) {
  await query('DELETE FROM invitations WHERE id = $1', [id]);
}

/**
 * Validate a token: returns the invitation if valid (not expired, not used).
 */
async function validateToken(token) {
  const inv = await findInvitation(token);
  if (!inv) return null;
  if (inv.used_at) return null;
  if (new Date(inv.expires_at) < new Date()) return null;
  return inv;
}

module.exports = {
  createInvitation,
  findInvitation,
  markUsed,
  listInvitations,
  deleteInvitation,
  validateToken,
};
