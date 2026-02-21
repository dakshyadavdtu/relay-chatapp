'use strict';

/**
 * Recovery and fault containment module.
 * Handles context rehydration, zombie detection, and failure recovery.
 */

const { rehydrateContext } = require('./actions/reconnect');
const adminGuard = require('../../admin/admin.guard');

/**
 * Rehydrate context on reconnect
 * @param {WebSocket} ws - WebSocket connection
 * @param {string} userId - Authenticated user ID
 * @param {string} [userRole] - User role
 * @returns {boolean} True if successful, false if should disconnect
 */
function rehydrateOnReconnect(ws, userId, userRole) {
  return rehydrateContext(ws, userId, userRole);
}

/**
 * Detect and cleanup zombie/orphan sockets
 * @param {WebSocket} ws - WebSocket connection to check
 * @returns {boolean} True if zombie detected (should disconnect)
 */
function detectZombieSocket(ws) {
  // Detect: WS connections without valid context
  if (!ws || !ws.context) {
    return true;
  }

  // Detect: WS connections missing capabilities
  if (!ws.context.capabilities || typeof ws.context.capabilities !== 'object') {
    return true;
  }

  // Detect: Admin WS without admin capability
  if (ws.adminSubscribed) {
    if (!adminGuard.verifyAdminCapability(ws)) {
      return true;
    }
  }

  return false;
}

/**
 * Cleanup zombie socket
 * @param {WebSocket} ws - WebSocket connection to cleanup
 */
function cleanupZombieSocket(ws) {
  if (!ws) {
    return;
  }

  try {
    // Disconnect immediately - no warnings, no recovery attempts
    if (ws.readyState === 1) { // WebSocket.OPEN
      ws.close(4004, 'Invalid connection state');
    } else {
      ws.terminate();
    }
  } catch {
    try {
      ws.terminate();
    } catch {
      // Ignore - connection already dead
    }
  }
}

module.exports = {
  rehydrateOnReconnect,
  detectZombieSocket,
  cleanupZombieSocket,
};
