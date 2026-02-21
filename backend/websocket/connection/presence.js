'use strict';

/**
 * MOVED IN PHASE 3 — NO LOGIC CHANGE
 * Tier-1.4: Presence notification service.
 * Read-only - emits presence updates to relevant connections.
 * NEVER mutates presenceStore.
 */

const socketSafety = require('../safety/socketSafety');
const config = require('../../config/constants');
const presenceStore = require('../state/presenceStore');

/** Lazy require to avoid circular dependency: connectionManager ← lifecycle ← presence ← connectionManager */
function getConnectionManager() {
  return require('./connectionManager');
}

/**
 * Notify all connected users about a presence change
 * @param {string} userId - User whose presence changed
 * @param {string} newStatus - New presence status
 * @param {string|null} previousStatus - Previous presence status
 */
function notifyPresenceChange(userId, newStatus, previousStatus) {
  const message = {
    type: 'PRESENCE_UPDATE',
    userId,
    status: newStatus,
    previousStatus,
    timestamp: Date.now(),
    version: config.PROTOCOL_VERSION,
  };
  const connectionManager = getConnectionManager();
  for (const uid of connectionManager.getConnectedUsers()) {
    if (uid === userId) continue;
    const sockets = connectionManager.getSockets(uid);
    for (const ws of sockets) {
      const result = socketSafety.sendMessage(ws, message);
      if (result.shouldClose) {
        socketSafety.closeAbusiveConnection(ws, 'Slow consumer: queue overflow', 1008);
      }
    }
  }
}

module.exports = {
  notifyPresenceChange,
};
