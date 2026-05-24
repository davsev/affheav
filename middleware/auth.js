'use strict';

/**
 * isApproved — blocks users with status !== 'approved'.
 * Use this on any route that should be inaccessible to pending/suspended users.
 * Pending users can still hit the auth routes (/auth/me, /auth/logout) but not /api/*.
 */
function isApproved(req, res, next) {
  if (!req.user) return res.status(401).json({ success: false, error: 'Unauthorized' });
  if (req.user.status !== 'approved') {
    return res.status(403).json({ success: false, error: 'Account pending approval' });
  }
  next();
}

/**
 * isSuperAdmin — allows only role='admin' (SuperAdmin).
 * NOTE: We keep 'admin' as the DB value to avoid breaking existing sessions.
 */
function isSuperAdmin(req, res, next) {
  if (req.user?.role === 'admin') return next();
  res.status(403).json({ success: false, error: 'Forbidden' });
}

/**
 * isGroupAdminOrAbove — allows 'admin' (SuperAdmin) or 'group_admin'.
 */
function isGroupAdminOrAbove(req, res, next) {
  const role = req.user?.role;
  if (role === 'admin' || role === 'group_admin') return next();
  res.status(403).json({ success: false, error: 'Forbidden' });
}

/**
 * requirePermission(perm) — returns middleware that:
 *   - Passes SuperAdmin and Group Admin unconditionally.
 *   - For group_user: checks req.user.permissions[perm] === true.
 *
 * @param {string} perm - One of: add_products, edit_products, delete_products,
 *   view_logs, trigger_send, manage_schedules, view_settings
 */
function requirePermission(perm) {
  return (req, res, next) => {
    const { role, permissions } = req.user || {};
    if (role === 'admin' || role === 'group_admin') return next();
    if (permissions && permissions[perm] === true) return next();
    res.status(403).json({ success: false, error: 'Forbidden' });
  };
}

module.exports = { isApproved, isSuperAdmin, isGroupAdminOrAbove, requirePermission };
