'use strict';

const connectionManager = require('./connectionManager');
const config = require('../../config/constants');
const logger = require('../../utils/logger');
const monitoring = require('../../utils/monitoring');
const heartbeatStore = require('../state/heartbeatStore');
const authSessionStore = require('../../auth/sessionStore');
const userDiagnostics = require('../../diagnostics/userDiagnosticsAggregator');

/**
 * Heartbeat interval in milliseconds
 * @type {number}
 */
const HEARTBEAT_INTERVAL = config.HEARTBEAT.interval;

/**
 * Timeout for considering a connection dead
 * @type {number}
 */
const HEARTBEAT_TIMEOUT = config.HEARTBEAT.timeout;

/**
 * Interval reference for cleanup
 * @type {NodeJS.Timeout|null}
 */
let heartbeatInterval = null;

/**
 * Mark a socket as alive (call on pong)
 * @param {WebSocket} ws - WebSocket connection
 */
function markAlive(ws) {
  heartbeatStore.setAlive(ws, true);
}

/**
 * Initialize heartbeat for a new connection
 * @param {WebSocket} ws - WebSocket connection
 */
function initConnection(ws) {
  heartbeatStore.setAlive(ws, true);

  ws.on('pong', () => {
    markAlive(ws);
    // RTT sampling: record latency for admin avg latency (ping ts set in performHeartbeat)
    const pingTs = ws._lastPingTs;
    if (typeof pingTs === 'number' && pingTs > 0) {
      const rttMs = Date.now() - pingTs;
      const userId = connectionManager.getUserId(ws) || ws.userId;
      if (userId) userDiagnostics.recordLatencySample(userId, rttMs);
      delete ws._lastPingTs;
    }
    // Phase 4: keep lastSeenAt fresh so liveOnly filtering does not hide idle-but-connected tabs
    if (ws.sessionId) {
      authSessionStore.touchSession(ws.sessionId).catch(() => {});
    }
  });
}

/**
 * Perform heartbeat check on all connections
 * @param {WebSocketServer} wss - WebSocket server instance
 */
function performHeartbeat(wss) {
  monitoring.increment('heartbeat', 'checks');
  
  wss.clients.forEach((ws) => {
    if (heartbeatStore.getAlive(ws) === false) {
      // Connection didn't respond to last ping
      const userId = connectionManager.getUserId(ws);
      monitoring.increment('heartbeat', 'timeouts');
      logger.warn('Heartbeat', 'connection_timeout', { userId: userId || 'unknown' });
      // Terminate socket - disconnect handler will call lifecycle.onDisconnect
      return ws.terminate();
    }

    // Mark as not alive, wait for pong
    heartbeatStore.setAlive(ws, false);
    ws._lastPingTs = Date.now();

    try {
      ws.ping();
    } catch (err) {
      monitoring.increment('heartbeat', 'failures');
      logger.error('Heartbeat', 'ping_failed', { error: err.message });
    }
  });
}

/**
 * Start heartbeat monitoring
 * @param {WebSocketServer} wss - WebSocket server instance
 */
function startHeartbeat(wss) {
  if (heartbeatInterval) {
    logger.warn('Heartbeat', 'already_running', {});
    return;
  }

  logger.info('Heartbeat', 'started', { interval: HEARTBEAT_INTERVAL, timeout: HEARTBEAT_TIMEOUT });
  
  heartbeatInterval = setInterval(() => {
    performHeartbeat(wss);
  }, HEARTBEAT_INTERVAL);

  // Don't prevent Node.js from exiting
  heartbeatInterval.unref();
}

/**
 * Stop heartbeat monitoring
 */
function stopHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
    logger.info('Heartbeat', 'stopped', {});
  }
}

module.exports = {
  initConnection,
  markAlive,
  startHeartbeat,
  stopHeartbeat,
  HEARTBEAT_INTERVAL,
  HEARTBEAT_TIMEOUT,
};
