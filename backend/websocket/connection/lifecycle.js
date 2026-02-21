'use strict';

/**
 * Tier-1.4: Centralized presence lifecycle management.
 * ONLY this module may write presence state.
 * Presence updates occur ONLY on connect, disconnect, heartbeat timeout.
 *
 * Reconnect-safe OFFLINE: When the last socket closes we do NOT immediately broadcast OFFLINE.
 * We schedule OFFLINE after a short grace window (PRESENCE_OFFLINE_GRACE_MS). If a new socket
 * connects for the same user within that window, onConnect cancels the pending timer and the
 * user stays online. True disconnect still emits OFFLINE after the grace expires.
 */

const presenceStore = require('../state/presenceStore');
const presenceNotifier = require('./presence');
const logger = require('../../utils/logger');
const { transition, TRANSITION_EVENT } = require('../../utils/logger');
const deliveryService = require('../../services/delivery.service');

/** userId -> timeoutId for grace-window OFFLINE; reconnect cancels. */
const pendingOfflineTimers = new Map();

/**
 * Handle user connection - set presence to online.
 * Cancels any pending OFFLINE timer for this user (reconnect within grace window).
 * @param {string} userId - User ID
 */
function onConnect(userId) {
  if (!userId) return;

  const existing = pendingOfflineTimers.get(userId);
  if (existing != null) {
    clearTimeout(existing);
    pendingOfflineTimers.delete(userId);
  }

  const previousStatus = presenceStore.getPresence(userId)?.status || null;
  presenceStore.setPresence(userId, 'online');
  transition({
    event: TRANSITION_EVENT.PRESENCE_ONLINE,
    messageId: null,
    connectionId: null,
    userId,
    fromState: previousStatus,
    toState: 'ONLINE',
  });

  presenceNotifier.notifyPresenceChange(userId, 'online', previousStatus);
}

/**
 * Request OFFLINE after a grace window. If the user reconnects before the window expires, onConnect cancels this.
 * If a timer already exists for userId, does nothing (avoids multiple timers).
 * @param {string} userId - User ID
 * @param {{ graceMs: number, reason?: string }} opts - graceMs delay; reason for logging
 */
function requestDisconnect(userId, { graceMs, reason }) {
  if (!userId) return;
  if (pendingOfflineTimers.has(userId)) return;

  const timeoutId = setTimeout(() => {
    pendingOfflineTimers.delete(userId);
    const connectionManager = require('./connectionManager');
    if (connectionManager.getSockets(userId).length === 0) {
      onDisconnect(userId);
    }
  }, graceMs);
  pendingOfflineTimers.set(userId, timeoutId);
}

/**
 * Handle user disconnection - set presence to offline
 * Idempotent: no-op if already offline and no active connections (stops PRESENCE_OFFLINE recursion).
 * @param {string} userId - User ID
 */
function onDisconnect(userId) {
  if (!userId) return;

  const connectionManager = require('./connectionManager');
  const activeConnectionCount = connectionManager.getSockets(userId).length;
  const currentPresence = presenceStore.getPresence(userId)?.status || null;
  if (activeConnectionCount === 0 && (currentPresence === 'offline' || currentPresence === 'OFFLINE')) {
    return;
  }

  deliveryService.recordFailuresForDisconnectedUser(userId);

  const previousStatus = presenceStore.getPresence(userId)?.status || null;
  presenceStore.setPresence(userId, 'offline');

  transition({
    event: TRANSITION_EVENT.PRESENCE_OFFLINE,
    messageId: null,
    connectionId: null,
    userId,
    fromState: previousStatus,
    toState: 'OFFLINE',
  });

  presenceNotifier.notifyPresenceChange(userId, 'offline', previousStatus);
}


module.exports = {
  onConnect,
  onDisconnect,
  requestDisconnect,
};
