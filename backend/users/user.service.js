'use strict';

/**
 * User lookup service — read-only API over the same persistence as register/login.
 * Use for GET /api/me and GET /api/users. Does not handle auth or password hashing.
 *
 * Persistence: storage/user.store.js (file-backed users.json).
 */

const userStore = require('../storage/user.store');
const { ROLES } = require('../auth/roles');

/**
 * Build public API user shape. Never exposes passwordHash.
 * Matches canonical shape: displayName fallback = username; avatarUrl fallback = null; email present ("" if not set).
 *
 * @param {Object} record - Raw store record (id, username, email?, displayName?, avatarUrl?, role)
 * @returns {{ id: string, username: string, displayName: string, email: string, avatarUrl: string|null, role: string }}
 */
function toPublicUser(record) {
  if (!record || !record.id) return null;
  const username = record.username != null ? String(record.username) : '';
  return {
    id: record.id,
    username,
    displayName:
      record.displayName != null && String(record.displayName).trim() !== ''
        ? String(record.displayName).trim()
        : username,
    email: record.email != null && String(record.email).trim() !== '' ? String(record.email).trim() : '',
    avatarUrl: record.avatarUrl != null && String(record.avatarUrl).trim() !== '' ? String(record.avatarUrl).trim() : null,
    role: record.role || ROLES.USER,
  };
}

/**
 * Get user by id in public API shape. Returns null if not found or soft-deleted.
 *
 * @param {string} userId
 * @returns {Promise<{ id, username, displayName, email, avatarUrl, role }|null>}
 */
async function getUserById(userId) {
  if (!userId || typeof userId !== 'string') return null;
  const record = await userStore.findById(userId.trim());
  if (!record || (record.deletedAt != null && record.deletedAt > 0)) return null;
  return toPublicUser(record);
}

/**
 * List all users in public API shape (for GET /api/users). Same source as register/login.
 *
 * @returns {Promise<Array<{ id, username, displayName, email, avatarUrl, role }>>}
 */
async function listUsers() {
  const withEmail = await userStore.listAllWithEmail();
  return withEmail.map((r) => toPublicUser({ ...r }));
}

/**
 * Search users by username (case-insensitive substring). Returns public shape.
 *
 * @param {string} query - Search string
 * @returns {Promise<Array<{ id, username, displayName, email, avatarUrl, role }>>}
 */
async function searchUsers(query) {
  if (!query || typeof query !== 'string') return [];
  const q = query.trim().toLowerCase();
  if (q.length === 0) return [];
  const all = await userStore.listAllWithEmail();
  return all
    .filter((r) => (r.username || '').toLowerCase().includes(q) || (r.email || '').toLowerCase().includes(q))
    .map((r) => toPublicUser({ ...r }));
}

/**
 * Update user profile (displayName, avatarUrl only). Persists via store.
 *
 * @param {string} userId
 * @param {Object} patch - { displayName?: string|null, avatarUrl?: string|null }
 * @returns {Promise<boolean>} true if user found and update applied
 */
async function updateUser(userId, patch) {
  if (!userId || typeof userId !== 'string' || !patch || typeof patch !== 'object') return false;
  const allowed = {};
  if (patch.hasOwnProperty('displayName')) allowed.displayName = patch.displayName;
  if (patch.hasOwnProperty('avatarUrl')) allowed.avatarUrl = patch.avatarUrl;
  if (Object.keys(allowed).length === 0) return true;
  return await userStore.updateProfile(userId.trim(), allowed);
}

/**
 * Soft-delete the user (anonymize profile, set deletedAt/bannedAt, revoke sessions elsewhere).
 * @param {string} userId
 * @returns {Promise<Object|null>} Updated raw record or null
 */
async function softDeleteUser(userId) {
  if (!userId || typeof userId !== 'string') return null;
  return await userStore.softDeleteUser(userId.trim());
}

module.exports = {
  getUserById,
  listUsers,
  searchUsers,
  updateUser,
  softDeleteUser,
  toPublicUser,
};
