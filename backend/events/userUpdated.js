'use strict';

/**
 * Internal event: user profile updated (displayName/avatarUrl).
 * HTTP (PATCH /api/me) emits; WS layer subscribes and broadcasts USER_UPDATED to clients.
 * No HTTP→WS direct dependency; this module is the bridge.
 */

const listeners = new Set();

/**
 * Emit user_updated (called by auth.controller after PATCH /api/me success).
 * @param {{ userId: string, displayName?: string|null, avatarUrl?: string|null, updatedAt?: number }} payload
 */
function emitUserUpdated(payload) {
  if (!payload || !payload.userId) return;
  listeners.forEach((fn) => {
    try {
      fn(payload);
    } catch (err) {
      if (typeof process !== 'undefined' && process.emitWarning) {
        process.emitWarning('userUpdated listener error: ' + err.message);
      }
    }
  });
}

/**
 * Subscribe to user_updated (called by websocket layer to broadcast).
 * @param {(payload: { userId, displayName?, avatarUrl? }) => void} callback
 * @returns {() => void} Unsubscribe
 */
function onUserUpdated(callback) {
  if (typeof callback !== 'function') return () => {};
  listeners.add(callback);
  return () => listeners.delete(callback);
}

module.exports = {
  emitUserUpdated,
  onUserUpdated,
};
