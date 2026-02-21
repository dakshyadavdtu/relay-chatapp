'use strict';

/**
 * HTTP user identity controller.
 * Minimal, safe HTTP user surface for frontend discovery.
 *
 * Uses backend/users/user.service.js — same persistence as register/login.
 * API shape: { id, username, displayName, email, avatarUrl, role }.
 *
 * This controller:
 * - Allows frontend to discover users and profiles
 * - Does NOT depend on WebSocket state
 * - Does NOT expose presence/online/typing data
 *
 * See: http/README.md for full contract.
 */

const config = require('../../config/constants');
const { COOKIE_SECURE, COOKIE_SAME_SITE, COOKIE_PATH, REFRESH_COOKIE_PATH } = require('../../config/cookieConfig');
const { sendError, sendSuccess } = require('../../utils/errorResponse');
const { toApiUser } = require('../../utils/apiShape');
const userLookup = require('../../users/user.service');
const sessionStore = require('../../auth/sessionStore');
const connectionManager = require('../../websocket/connection/connectionManager');

const JWT_COOKIE_NAME = config.JWT_COOKIE_NAME;
const REFRESH_COOKIE_NAME = config.REFRESH_COOKIE_NAME;
const tokenClearOptions = {
  httpOnly: true,
  secure: COOKIE_SECURE,
  sameSite: COOKIE_SAME_SITE,
  path: COOKIE_PATH,
  maxAge: 0,
};
const refreshClearOptions = {
  httpOnly: true,
  secure: COOKIE_SECURE,
  sameSite: COOKIE_SAME_SITE,
  path: REFRESH_COOKIE_PATH,
  maxAge: 0,
};

function clearAuthCookies(res) {
  res.clearCookie(JWT_COOKIE_NAME, tokenClearOptions);
  res.clearCookie(REFRESH_COOKIE_NAME, refreshClearOptions);
}

/**
 * List all users (safe fields only). GET /api/users — requires auth.
 * Same canonical shape as GET /api/me: id, username, email, displayName, avatarUrl, role.
 * Real registered users only (no stubs).
 */
async function listUsers(req, res) {
  const list = await userLookup.listUsers();
  const users = list.map((u) => toApiUser(u)).filter(Boolean);
  return sendSuccess(res, { users });
}

/**
 * Search users by username or email. GET /api/users/search?q=query
 */
async function searchUsers(req, res) {
  const { q } = req.query;

  if (!q || typeof q !== 'string' || q.trim().length === 0) {
    return sendError(res, 400, 'Query parameter "q" is required', 'INVALID_QUERY');
  }

  const results = await userLookup.searchUsers(q);
  const users = results.map((u) => toApiUser(u)).filter(Boolean);
  return sendSuccess(res, { users });
}

/**
 * Get user by ID. GET /api/users/:id
 */
async function getUserById(req, res) {
  const { id } = req.params;

  if (!id || typeof id !== 'string') {
    return sendError(res, 400, 'User ID is required', 'INVALID_USER_ID');
  }

  const user = await userLookup.getUserById(id.trim());
  if (!user) {
    return sendError(res, 404, 'User not found', 'USER_NOT_FOUND');
  }

  const apiUser = toApiUser(user);
  if (!apiUser) {
    return sendError(res, 500, 'Invalid user shape', 'INTERNAL_SHAPE_ERROR');
  }
  return sendSuccess(res, { user: apiUser });
}

/**
 * Get current authenticated user. GET /api/users/me
 * Same canonical shape as GET /api/me: id, username, email, displayName, avatarUrl, role.
 */
async function getMe(req, res) {
  if (!req.user || !req.user.userId) {
    return sendError(res, 401, 'Not authenticated', 'UNAUTHORIZED');
  }

  const user = await userLookup.getUserById(req.user.userId);
  if (!user) {
    return sendError(res, 401, 'User not found', 'UNAUTHORIZED');
  }

  const apiUser = toApiUser(user);
  if (!apiUser) {
    return sendError(res, 500, 'Invalid user shape', 'INTERNAL_SHAPE_ERROR');
  }
  return sendSuccess(res, { user: apiUser });
}

/**
 * DELETE /api/users/me — Self-delete account (soft delete).
 * Requires body: { confirm: "DELETE" }. Revokes all sessions, drops WS, clears cookies.
 *
 * DEV CURL TEST (route is under /api, so base = http://localhost:<PORT>/api):
 *   1) Login to get auth cookie (or token if using dev-token mode):
 *      curl -X POST http://localhost:3000/api/login -H "Content-Type: application/json" \
 *        -d '{"username":"testuser","password":"testpass"}' -c cookies.txt -v
 *   2) Call delete (use -b cookies.txt to send cookie):
 *      curl -X DELETE http://localhost:3000/api/users/me \
 *        -H "Content-Type: application/json" -d '{"confirm":"DELETE"}' -b cookies.txt -v
 *   Expected: 200 { "success": true, "data": { "deleted": true } }; Set-Cookie clears auth cookies.
 *   Without confirm: 400 { "success": false, "error": "...", "code": "CONFIRM_REQUIRED" }
 *   Unauthenticated: 401 { "success": false, "code": "UNAUTHORIZED" }
 */
async function deleteMe(req, res) {
  if (!req.user || !req.user.userId) {
    return sendError(res, 401, 'Not authenticated', 'UNAUTHORIZED');
  }

  const confirm = req.body && typeof req.body.confirm === 'string' ? req.body.confirm.trim() : '';
  if (confirm !== 'DELETE') {
    return sendError(res, 400, 'Request body must include { confirm: "DELETE" }', 'CONFIRM_REQUIRED');
  }

  const userId = req.user.userId;

  const updated = await userLookup.softDeleteUser(userId);
  if (!updated) {
    return sendError(res, 404, 'User not found', 'USER_NOT_FOUND');
  }

  try {
    await sessionStore.revokeAllSessions(userId);
  } catch (_) {
    // Continue; sessions may already be gone
  }

  try {
    connectionManager.remove(userId);
  } catch (_) {
    // No WS connected or already closed
  }

  clearAuthCookies(res);
  return sendSuccess(res, { deleted: true });
}

module.exports = {
  listUsers,
  searchUsers,
  getUserById,
  getMe,
  deleteMe,
};
