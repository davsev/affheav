'use strict';
const { query } = require('../db');

/**
 * scopeGroup middleware — attaches req.groupAdminId to the request.
 *
 * SuperAdmin (role='admin'): req.groupAdminId = null (no filter, sees all)
 * Group Admin (role='group_admin'): req.groupAdminId = self.id
 * Group User (role='group_user'): req.groupAdminId = self.groupAdminId
 *
 * Products are scoped by group_admin_id on the products table.
 * Routes use: groupAdminId ? 'WHERE group_admin_id = $1' : '' (no filter for SuperAdmin)
 */
async function scopeGroup(req, res, next) {
  try {
    const { id, role, groupAdminId } = req.user;
    if (role === 'admin') {
      req.groupAdminId = null;
    } else if (role === 'group_admin') {
      req.groupAdminId = id;
    } else {
      // group_user — scope to their Group Admin's group
      req.groupAdminId = groupAdminId;
    }
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { scopeGroup };
