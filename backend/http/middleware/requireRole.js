'use strict';

/**
 * Role-based access control middleware.
 * Enforces server-only authority; UI cannot fake role.
 * Must not throw, not block event loop, not modify request body.
 */

const { ROLES } = require('../../auth/roles');

const VALID_ROLES = Object.values(ROLES);

function forbid(res) {
  return res.status(403).json({
    success: false,
    error: 'Forbidden',
    code: 'FORBIDDEN',
  });
}

/**
 * Require one of the allowed roles (variadic).
 * @param {...string} allowedRoles - Roles that may access (e.g. ROLES.ADMIN)
 * @returns {Function} Express middleware
 */
function requireRole(...allowedRoles) {
  const list = Array.isArray(allowedRoles[0]) ? allowedRoles[0] : allowedRoles;
  // Use array instead of Set to comply with state ownership rules
  const allowedRolesList = list.filter((r) => VALID_ROLES.includes(r));

  return function roleMiddleware(req, res, next) {
    if (!req.user || !req.user.userId) {
      return forbid(res);
    }
    const role = req.user.effectiveRole ?? req.user.role;
    if (role === undefined || role === null) {
      return forbid(res);
    }
    if (typeof role !== 'string' || !VALID_ROLES.includes(role)) {
      return forbid(res);
    }
    if (allowedRolesList.length === 0 || !allowedRolesList.includes(role)) {
      return forbid(res);
    }
    next();
  };
}

/** Require ADMIN only. */
function requireAdmin(req, res, next) {
  return requireRole(ROLES.ADMIN)(req, res, next);
}

module.exports = {
  requireRole,
  requireAdmin,
};
