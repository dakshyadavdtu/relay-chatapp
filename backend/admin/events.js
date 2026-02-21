'use strict';

/**
 * Admin events - READ-ONLY events for admin WebSocket channels.
 * Reads ONLY from Phase-3 observability API.
 * NEVER reads websocket/state directly.
 * NEVER mutates state.
 */

const observability = require('../observability');
const socketSafety = require('../websocket/safety/socketSafety');

/**
 * Emit observability snapshot to admin client
 * @param {WebSocket} ws - WebSocket connection (already verified as admin)
 * @param {Object} capabilities - Admin capabilities (from ws.context)
 * @param {Function} sendResponse - Response function
 */
function emitObservabilitySnapshot(ws, capabilities, sendResponse) {
  // NEVER assume caller is admin without guard (guard already verified)
  // Read ONLY from Phase-3 observability API
  const snapshot = observability.getSnapshot(capabilities);

  // Emit snapshot as admin event
  sendResponse(ws, {
    type: 'ADMIN_OBSERVABILITY_SNAPSHOT',
    snapshot: snapshot,
    timestamp: Date.now(),
  });
}

/**
 * Emit admin system event
 * @param {WebSocket} ws - WebSocket connection (already verified as admin)
 * @param {string} eventType - Event type
 * @param {Object} data - Event data (must be safe, no raw state)
 * @param {Function} sendResponse - Response function
 */
function emitAdminSystemEvent(ws, eventType, data, sendResponse) {
  // NEVER assume caller is admin without guard
  // NEVER emit user-scoped data to non-admin (guard ensures admin)

  sendResponse(ws, {
    type: 'ADMIN_SYSTEM_EVENT',
    eventType: eventType,
    data: data,
    timestamp: Date.now(),
  });
}

module.exports = {
  emitObservabilitySnapshot,
  emitAdminSystemEvent,
};
