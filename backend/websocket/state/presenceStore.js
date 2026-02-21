'use strict';

/**
 * MOVED IN PHASE 4 — OWNERSHIP ONLY
 * Tier-1.4: Sole owner of presence state.
 * Presence mutations allowed ONLY via lifecycle.js.
 */

const presenceStore = new Map();
const listeners = new Set();

const PresenceStatus = { ONLINE: 'online', AWAY: 'away', OFFLINE: 'offline' };

/** Read-only. Use getPresence or get. */
function get(userId) {
  return presenceStore.get(userId) || null;
}

function getAll() {
  return Array.from(presenceStore.entries());
}

/**
 * Tier-1.4: Set presence status. Call ONLY from lifecycle.js.
 * @param {string} userId - User ID
 * @param {string} status - Presence status ('online', 'offline', 'away')
 */
function setPresence(userId, status) {
  if (!userId) return;
  const prev = presenceStore.get(userId);
  const previousStatus = prev?.status || null;
  presenceStore.set(userId, { status, lastSeen: Date.now(), metadata: {} });
  for (const cb of listeners) {
    try { cb(userId, status, previousStatus); } catch (e) { /* ignore */ }
  }
}

function deleteUser(userId) {
  presenceStore.delete(userId);
}

function addListener(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function clear() {
  presenceStore.clear();
  listeners.clear();
}

module.exports = {
  get: (userId) => presenceStore.get(userId) || null,
  getPresence: (userId) => presenceStore.get(userId) || null,
  getAll,
  setPresence,
  delete: deleteUser,
  addListener,
  clear,
  PresenceStatus,
};
