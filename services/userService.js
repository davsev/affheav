const { query } = require('../db');

// In-memory cache to avoid hitting DB on every deserializeUser call
// TTL: 60 seconds per user
const _cache = new Map(); // googleId → { user, expiresAt }
const CACHE_TTL = 60 * 1000;

function _cacheGet(googleId) {
  const entry = _cache.get(googleId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { _cache.delete(googleId); return null; }
  return entry.user;
}
function _cacheSet(googleId, user) {
  _cache.set(googleId, { user, expiresAt: Date.now() + CACHE_TTL });
}
function _cacheInvalidate(googleId) {
  _cache.delete(googleId);
}

function _row(r) {
  if (!r) return null;
  return {
    id:        r.id,
    googleId:  r.google_id,
    email:     r.email,
    name:      r.name,
    photo:     r.photo,
    role:      r.role,
    status:    r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

async function findUser(googleId) {
  const cached = _cacheGet(googleId);
  if (cached) return cached;

  const { rows } = await query(
    'SELECT * FROM users WHERE google_id = $1 LIMIT 1',
    [googleId]
  );
  const user = _row(rows[0]);
  if (user) _cacheSet(googleId, user);
  return user;
}

async function findUserById(id) {
  const { rows } = await query(
    'SELECT * FROM users WHERE id = $1 LIMIT 1',
    [id]
  );
  return _row(rows[0]);
}

async function findUserByEmail(email) {
  const { rows } = await query(
    'SELECT * FROM users WHERE email = $1 LIMIT 1',
    [email]
  );
  return _row(rows[0]);
}

async function createUser({ googleId, email, name, photo }) {
  const adminEmail = process.env.ADMIN_GOOGLE_EMAIL;
  const isAdmin = adminEmail && email === adminEmail;

  const { rows } = await query(
    `INSERT INTO users (google_id, email, name, photo, role, status)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (google_id) DO UPDATE
       SET email = EXCLUDED.email,
           name  = EXCLUDED.name,
           photo = EXCLUDED.photo,
           updated_at = NOW()
     RETURNING *`,
    [googleId, email, name, photo, isAdmin ? 'admin' : 'user', 'active']
  );
  const user = _row(rows[0]);
  _cacheSet(googleId, user);
  return user;
}

async function updateUser(googleId, fields) {
  _cacheInvalidate(googleId);

  const allowed = ['name', 'photo', 'role', 'status'];
  const updates = [];
  const values  = [];
  let   i       = 1;

  for (const key of allowed) {
    if (fields[key] !== undefined) {
      updates.push(`${key} = $${i++}`);
      values.push(fields[key]);
    }
  }
  if (updates.length === 0) return findUser(googleId);

  updates.push(`updated_at = NOW()`);
  values.push(googleId);

  const { rows } = await query(
    `UPDATE users SET ${updates.join(', ')} WHERE google_id = $${i} RETURNING *`,
    values
  );
  const user = _row(rows[0]);
  if (user) _cacheSet(googleId, user);
  return user;
}

async function updateUserById(id, fields) {
  const allowed = ['name', 'photo', 'role', 'status'];
  const updates = [];
  const values  = [];
  let   i       = 1;

  for (const key of allowed) {
    if (fields[key] !== undefined) {
      updates.push(`${key} = $${i++}`);
      values.push(fields[key]);
    }
  }
  if (updates.length === 0) return findUserById(id);

  updates.push(`updated_at = NOW()`);
  values.push(id);

  const { rows } = await query(
    `UPDATE users SET ${updates.join(', ')} WHERE id = $${i} RETURNING *`,
    values
  );
  const user = _row(rows[0]);
  // Invalidate cache by googleId if available
  if (user?.googleId) _cacheInvalidate(user.googleId);
  return user;
}

async function listUsers() {
  const { rows } = await query(
    'SELECT * FROM users ORDER BY created_at ASC'
  );
  return rows.map(_row);
}

async function deleteUser(id) {
  const { rows } = await query(
    'DELETE FROM users WHERE id = $1 RETURNING google_id',
    [id]
  );
  if (rows[0]?.google_id) _cacheInvalidate(rows[0].google_id);
}

module.exports = {
  findUser,
  findUserById,
  findUserByEmail,
  createUser,
  updateUser,
  updateUserById,
  listUsers,
  deleteUser,
};
