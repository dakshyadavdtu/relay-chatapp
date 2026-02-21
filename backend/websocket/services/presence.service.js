'use strict';

/**
 * Presence service - read layer + broadcast.
 * Presence is mutated ONLY by connection lifecycle.
 * Tier-1: Services may call socketSafety for sending; handlers must not.
 */

const presenceStore = require('../state/presenceStore');

function getPresence(userId) {
  return presenceStore.get(userId) || null;
}

function getPresenceBulk(userIds) {
  const result = {};
  for (const uid of userIds) {
    const p = presenceStore.get(uid);
    result[uid] = p || { status: presenceStore.PresenceStatus.OFFLINE, lastSeen: null };
  }
  return result;
}

function getOnlineUsers() {
  return presenceStore.getAll()
    .filter(([, p]) => p.status === presenceStore.PresenceStatus.ONLINE)
    .map(([uid]) => uid);
}

function clearStore() {
  presenceStore.clear();
}

module.exports = {
  getPresence,
  getPresenceBulk,
  getOnlineUsers,
  clearStore,
  onPresenceChange: presenceStore.addListener.bind(presenceStore),
  PresenceStatus: presenceStore.PresenceStatus,
};
