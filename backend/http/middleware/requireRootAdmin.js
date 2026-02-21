'use strict';

/**
 * Require root admin. Use for role management and root-only user list.
 * - No user => 401
 * - User not root => 403 { code: "ROOT_ADMIN_REQUIRED" }
 */

function requireRootAdmin(req, res, next) {
  if (!req.user || !req.user.userId) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required',
      code: 'UNAUTHORIZED',
    });
  }
  if (!req.user.isRootAdmin) {
    return res.status(403).json({
      success: false,
      error: 'Root admin required',
      code: 'ROOT_ADMIN_REQUIRED',
    });
  }
  next();
}

module.exports = { requireRootAdmin };
