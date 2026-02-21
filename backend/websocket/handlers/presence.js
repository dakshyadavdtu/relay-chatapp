'use strict';

/**
 * Presence handler - read-only. Tier-1 invariant: presence reflects connection lifecycle only.
 * Presence mutations occur ONLY in connectionManager (onConnect, onDisconnect).
 * No direct store access; delegates to presenceService.
 */

const connectionManager = require('../connection/connectionManager');
const presenceService = require('../services/presence.service');

/**
 * Handle PRESENCE_PING. Tier-1: NO mutation. Returns PONG; status not persisted.
 * Client-requested status (away/busy) would require handler mutation - forbidden.
 */
function handlePresencePing(ws, payload, context = {}) {
  const userId = connectionManager.getUserId(ws);
  if (!userId) {
    return { type: 'PRESENCE_ERROR', error: 'Not authenticated', code: 'AUTH_REQUIRED' };
  }
  const { status = presenceService.PresenceStatus.ONLINE, metadata } = payload;
  return { type: 'PRESENCE_PONG', userId, status, timestamp: Date.now() };
}

// Re-export from service for backward compat (index.js, wsServer.js)
const getPresence = presenceService.getPresence;
const getPresenceBulk = presenceService.getPresenceBulk;
const getOnlineUsers = presenceService.getOnlineUsers;
const onPresenceChange = presenceService.onPresenceChange;
const clearStore = presenceService.clearStore;
const PresenceStatus = presenceService.PresenceStatus;

// Keep userConnected/userDisconnected for backward compat - they now no-op (connectionManager owns writes)
function userConnected(userId) {}
function userDisconnected(userId) {}

module.exports = {
  handlePresencePing,
  userConnected,
  userDisconnected,
  getPresence,
  getPresenceBulk,
  getOnlineUsers,
  onPresenceChange,
  clearStore,
  PresenceStatus,
};
