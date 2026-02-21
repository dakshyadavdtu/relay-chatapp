'use strict';

/**
 * User model schema and validation.
 * Single source of truth for user shape and role enforcement.
 */

const { ROLES } = require('../auth/roles');

/**
 * Valid role values (enum-level restriction)
 */
const VALID_ROLES = Object.values(ROLES);

/**
 * Validate user object with role enforcement
 * @param {Object} user - User object
 * @returns {{ valid: boolean, error?: string }}
 */
function validateUser(user) {
  if (!user || typeof user !== 'object') {
    return { valid: false, error: 'User must be a non-null object' };
  }

  // Role validation: MUST be present and MUST be valid enum value
  if (user.role === undefined || user.role === null) {
    return { valid: false, error: 'Missing required field: role' };
  }

  if (typeof user.role !== 'string') {
    return { valid: false, error: 'role must be a string' };
  }

  if (!VALID_ROLES.includes(user.role)) {
    return { valid: false, error: `role must be one of: ${VALID_ROLES.join(', ')}` };
  }

  return { valid: true };
}

/**
 * Validate role value (enum-level restriction)
 * @param {string} role - Role value to validate
 * @returns {{ valid: boolean, error?: string }}
 */
function validateRole(role) {
  if (role === undefined || role === null) {
    return { valid: false, error: 'Role is required' };
  }

  if (typeof role !== 'string') {
    return { valid: false, error: 'Role must be a string' };
  }

  if (!VALID_ROLES.includes(role)) {
    return { valid: false, error: `Role must be one of: ${VALID_ROLES.join(', ')}` };
  }

  return { valid: true };
}

module.exports = {
  validateUser,
  validateRole,
  VALID_ROLES,
};
