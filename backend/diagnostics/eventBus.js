'use strict';

/**
 * Minimal event emitter for diagnostic events.
 * Used to emit delivery_failure_detected and similar events.
 */

const { EventEmitter } = require('events');

const bus = new EventEmitter();
bus.setMaxListeners(100);

/**
 * Emit delivery_failure_detected event.
 * Payload: { messageId, recipientId, reason, timestamp }
 * @param {Object} payload
 * @param {string} [payload.messageId]
 * @param {string} [payload.recipientId]
 * @param {string} payload.reason
 * @param {number} [payload.timestamp]
 */
function emitDeliveryFailureDetected(payload) {
  const event = {
    messageId: payload.messageId || null,
    recipientId: payload.recipientId || null,
    reason: payload.reason || 'UNKNOWN',
    timestamp: payload.timestamp != null ? payload.timestamp : Date.now(),
  };
  bus.emit('delivery_failure_detected', event);
}

/**
 * Emit reconnect_auth_failed diagnostic event.
 * Payload: { reason, socketId, timestamp }
 * @param {Object} payload
 * @param {string} payload.reason
 * @param {string} [payload.socketId]
 * @param {number} [payload.timestamp]
 */
function emitReconnectAuthFailed(payload) {
  const event = {
    reason: payload.reason || 'UNKNOWN',
    socketId: payload.socketId || null,
    timestamp: payload.timestamp != null ? payload.timestamp : Date.now(),
  };
  bus.emit('reconnect_auth_failed', event);
}

module.exports = {
  bus,
  emitDeliveryFailureDetected,
  emitReconnectAuthFailed,
  on: bus.on.bind(bus),
  once: bus.once.bind(bus),
};
