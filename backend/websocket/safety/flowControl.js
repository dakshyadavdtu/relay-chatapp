'use strict';

/**
 * Flow control module — MOVED IN PHASE 5 — NO LOGIC CHANGE
 * Owns: closeAbusiveConnection (shouldClose / slow consumer action).
 * Decisions (queue full, shouldClose, slow consumer) remain in backpressure/rate-limit;
 * this module performs the close + cleanup action.
 * PHASE 1: Records WS_CLOSED_ABUSIVE flag when closing for flow-control (not rate-limit) reasons.
 */

/**
 * Close connection with appropriate close code (MOVED IN PHASE 5 — NO LOGIC CHANGE)
 * PHASE 1: Records suspicious flag for abusive/flow-control closes (skips rate-limit closes to avoid double-count).
 * @param {WebSocket} ws - WebSocket connection
 * @param {string} reason - Reason for closure
 * @param {number} [code=1008] - WebSocket close code
 */
function closeAbusiveConnection(ws, reason, code = 1008) {
  try {
    // Record flag only for non–rate-limit closes (rate limit already recorded WS_RATE_LIMIT_CLOSE in socketSafety)
    const reasonLower = typeof reason === 'string' ? reason.toLowerCase() : '';
    const isRateLimitClose = reasonLower.includes('rate limit') || reasonLower.includes('rate_limit') || reasonLower.includes('throttl');
    if (!isRateLimitClose) {
      const connectionManager = require('../connection/connectionManager');
      const suspiciousDetector = require('../../suspicious/suspicious.detector');
      const userId = connectionManager.getUserId(ws) || ws?.context?.userId || ws?.context?.user?.userId || null;
      if (userId) {
        try {
          suspiciousDetector.recordFlag(userId, 'WS_CLOSED_ABUSIVE', {
            reason: typeof reason === 'string' ? reason.slice(0, 200) : '',
            code,
          });
        } catch (_) { /* no-op */ }
      }
    }
  } catch (_) { /* no-op */ }

  try {
    if (ws.readyState === 1) { // WebSocket.OPEN
      ws.close(code, reason);
    }
  } catch (err) {
    // Ignore close errors during cleanup
  } finally {
    const socketSafety = require('./socketSafety');
    socketSafety.cleanupSocket(ws);
  }
}

module.exports = {
  closeAbusiveConnection,
};
