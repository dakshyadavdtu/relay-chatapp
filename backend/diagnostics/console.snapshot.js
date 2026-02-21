'use strict';

/**
 * Builds a read-only user snapshot for console and admin diagnostics.
 * Does not modify any state.
 */

const userDiagnostics = require('./userDiagnosticsAggregator');

/** Lazy require to avoid circular dependency (connectionManager may load lifecycle etc.). */
function getConnectionManager() {
  return require('../websocket/connection/connectionManager');
}

/** Lazy require suspicious detector. */
function getSuspiciousDetector() {
  return require('../suspicious/suspicious.detector');
}

/**
 * Build snapshot for a user.
 * @param {string} userId
 * @returns {{ connectionStatus: string, messageSummary: Object, flags: Array, latency: number|null, lastActivity: number|null, reconnectCount: number, deliveryFailures: number }}
 */
function buildUserSnapshot(userId) {
  try {
    if (!userId || typeof userId !== 'string') {
      return {
        connectionStatus: 'OFFLINE',
        messageSummary: { messageRate: null, totalMessages: 0 },
        flags: [],
        latency: null,
        lastActivity: null,
        reconnectCount: 0,
        deliveryFailures: 0,
      };
    }
    const diag = userDiagnostics.getUserDiagnostics(userId);
    const connectionManager = getConnectionManager();
    const socket = connectionManager.getSocket(userId);
    const connectionStatus = socket ? 'ONLINE' : 'OFFLINE';
    const totalMessages = diag ? diag.messageCountWindow : 0;
    let messageRate = null;
    if (diag && diag.connectionStartTime != null) {
      const minutes = (Date.now() - diag.connectionStartTime) / 60000;
      if (minutes > 0) messageRate = totalMessages / minutes;
    }
    const suspiciousDetector = getSuspiciousDetector();
    const flags = suspiciousDetector.getUserFlags(userId);
    return {
      connectionStatus,
      messageSummary: { messageRate, totalMessages },
      flags,
      latency: null,
      lastActivity: diag ? diag.lastActivity : null,
      reconnectCount: diag ? diag.reconnectCount : 0,
      deliveryFailures: diag ? diag.deliveryFailures : 0,
    };
  } catch (_) {
    return {
      connectionStatus: 'OFFLINE',
      messageSummary: { messageRate: null, totalMessages: 0 },
      flags: [],
      latency: null,
      lastActivity: null,
      reconnectCount: 0,
      deliveryFailures: 0,
    };
  }
}

module.exports = {
  buildUserSnapshot,
};
