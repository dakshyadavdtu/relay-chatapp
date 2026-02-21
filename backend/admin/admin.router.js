'use strict';

/**
 * Admin router - ISOLATED router for admin WebSocket operations.
 * Completely separate from user WebSocket handlers.
 * NO shared middleware, NO shared routing tables.
 */

const adminGuard = require('./admin.guard');
const adminEvents = require('./events');
const socketSafety = require('../websocket/safety/socketSafety');
const config = require('../config/constants');

/**
 * Admin message types (isolated from user message types)
 */
const AdminMessageType = {
  ADMIN_SUBSCRIBE: 'ADMIN_SUBSCRIBE',
  ADMIN_OBSERVABILITY_REQUEST: 'ADMIN_OBSERVABILITY_REQUEST',
};

/**
 * Handle admin WebSocket message
 * @param {WebSocket} ws - WebSocket connection
 * @param {Object} message - Parsed message object
 * @param {Function} sendResponse - Response function
 * @returns {Promise<{ policy: string, response?: Object }>}
 */
async function handleAdminMessage(ws, message, sendResponse) {
  try {
    // HARD GATE: Verify admin capability BEFORE any handler
    if (!adminGuard.verifyAdminCapability(ws)) {
      // Guard already disconnected the connection
      return { policy: 'DISCONNECT' };
    }

    const { type, ...payload } = message;

    // Route to admin-specific handlers (completely isolated)
    switch (type) {
      case AdminMessageType.ADMIN_SUBSCRIBE:
        return await handleAdminSubscribe(ws, payload, sendResponse);

      case AdminMessageType.ADMIN_OBSERVABILITY_REQUEST:
        return await handleObservabilityRequest(ws, payload, sendResponse);

      default:
        // Unknown admin message type - disconnect (no fallback to user handlers)
        adminGuard.disconnectViolation(ws, 'Unknown admin message type');
        return { policy: 'DISCONNECT' };
    }
  } catch (error) {
    // Admin WS handler failure containment
    // Catch locally - do NOT crash WS server
    // Do NOT leak partial data
    // Optionally disconnect that admin socket

    // Disconnect admin socket on handler failure
    adminGuard.disconnectViolation(ws, 'Handler error');
    return { policy: 'DISCONNECT' };
  }
}

/**
 * Handle admin subscription
 * @param {WebSocket} ws - WebSocket connection
 * @param {Object} payload - Message payload
 * @param {Function} sendResponse - Response function
 * @returns {Promise<{ policy: string, response?: Object }>}
 */
async function handleAdminSubscribe(ws, payload, sendResponse) {
  try {
    // Guard already verified admin capability
    // Mark connection as admin-subscribed
    ws.adminSubscribed = true;

    sendResponse(ws, {
      type: 'ADMIN_SUBSCRIBED',
      timestamp: Date.now(),
      version: config.PROTOCOL_VERSION,
    });

    return { policy: 'ALLOW' };
  } catch (error) {
    // Handler failure - disconnect
    adminGuard.disconnectViolation(ws, 'Subscribe handler error');
    return { policy: 'DISCONNECT' };
  }
}

/**
 * Handle observability request
 * @param {WebSocket} ws - WebSocket connection
 * @param {Object} payload - Message payload
 * @param {Function} sendResponse - Response function
 * @returns {Promise<{ policy: string, response?: Object }>}
 */
async function handleObservabilityRequest(ws, payload, sendResponse) {
  try {
    // Guard already verified admin capability
    // Get capabilities from context (already verified by guard)
    const capabilities = ws.context.capabilities;

    // Emit observability snapshot via admin events
    // Observability failures are handled internally (returns SAFE_EMPTY_SNAPSHOT)
    adminEvents.emitObservabilitySnapshot(ws, capabilities, sendResponse);

    return { policy: 'ALLOW' };
  } catch (error) {
    // Handler failure - disconnect
    adminGuard.disconnectViolation(ws, 'Observability handler error');
    return { policy: 'DISCONNECT' };
  }
}

module.exports = {
  handleAdminMessage,
  AdminMessageType,
};
