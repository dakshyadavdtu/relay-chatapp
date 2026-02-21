'use strict';

/**
 * Admin guard - HARD GATE for admin WebSocket operations.
 * Enforces hard isolation - disconnects on violation.
 * NO warnings, NO partial subscriptions, NO fallback.
 */

/**
 * Verify admin capability and disconnect on violation
 * @param {WebSocket} ws - WebSocket connection
 * @returns {boolean} True if admin capability verified, false if disconnected
 */
function verifyAdminCapability(ws) {
  // FAIL CLOSED: Check ws.context exists
  if (!ws || !ws.context) {
    disconnectViolation(ws, 'Missing context');
    return false;
  }

  // FAIL CLOSED: Check ws.context.capabilities exists
  if (!ws.context.capabilities || typeof ws.context.capabilities !== 'object') {
    disconnectViolation(ws, 'Missing capabilities');
    return false;
  }

  // FAIL CLOSED: Check ws.context.capabilities.devtools === true
  if (ws.context.capabilities.devtools !== true) {
    disconnectViolation(ws, 'Insufficient capabilities');
    return false;
  }

  // All checks passed
  return true;
}

/**
 * Disconnect WebSocket on violation
 * @param {WebSocket} ws - WebSocket connection
 * @param {string} reason - Disconnect reason (internal, not exposed)
 */
function disconnectViolation(ws) {
  if (!ws) {
    return;
  }

  try {
    // Close with clear code indicating authorization failure
    // Code 4003 = Unauthorized (custom code for admin violation)
    if (ws.readyState === 1) { // WebSocket.OPEN
      ws.close(4003, 'Admin access required');
    } else {
      // Already closing/closed, terminate to ensure cleanup
      ws.terminate();
    }
  } catch {
    // If close fails, terminate
    try {
      ws.terminate();
    } catch {
      // Ignore - connection already dead
    }
  }
}

module.exports = {
  verifyAdminCapability,
  disconnectViolation,
};
