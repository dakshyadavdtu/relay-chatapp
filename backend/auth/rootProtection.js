'use strict';

/**
 * Centralized root admin protection.
 * Single place for isRootUser() and guard; used by all admin mutation endpoints.
 * Do not duplicate email/username checks elsewhere.
 */

const config = require('../config/constants');
const { sendError } = require('../utils/errorResponse');

const ROOT_EMAIL = (config.ROOT_ADMIN_EMAIL || '').trim().toLowerCase();
const ROOT_USERNAME = (config.ROOT_ADMIN_USERNAME || '').trim().toLowerCase();

/**
 * Returns true if the given user is the root admin (by email or username).
 * @param {Object} user - User record or { email?, username? }
 * @returns {boolean}
 */
function isRootUser(user) {
  if (!user || typeof user !== 'object') return false;
  const email = (user.email || '').trim().toLowerCase();
  const username = (user.username || '').trim().toLowerCase();
  if (ROOT_EMAIL && email && email === ROOT_EMAIL) return true;
  if (ROOT_USERNAME && username && username === ROOT_USERNAME) return true;
  return false;
}

/**
 * Guard: if target is root and acting user is not root, send 403 and return true.
 * Call at start of admin mutation handlers: if (guardRootTarget(req, targetUser, res)) return;
 * @param {Object} req - Express request (req.user.userId, req.user.isRootAdmin)
 * @param {Object} targetUser - Fetched target user record
 * @param {Object} res - Express response
 * @returns {boolean} true if response was sent (caller should return), false to proceed
 */
function guardRootTarget(req, targetUser, res) {
  if (!isRootUser(targetUser)) return false;
  const actingIsRoot = !!(req.user && req.user.isRootAdmin);
  if (actingIsRoot) return false;
  sendError(res, 403, 'Root admin is protected', 'ROOT_ADMIN_PROTECTED');
  return true;
}

module.exports = {
  isRootUser,
  guardRootTarget,
};
