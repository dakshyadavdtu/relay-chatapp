'use strict';

/**
 * Triggers realtime delivery attempt for a persisted message.
 * Used by HTTP sendMessage so recipient gets MESSAGE_RECEIVE when online.
 * Encapsulates websocket dependency; HTTP controller imports this (services/), not websocket/.
 */

const wsMessageService = require('../websocket/services/message.service');

/**
 * Attempt to deliver message to recipient via WebSocket (if online).
 * @param {string} messageId
 * @param {Object} receivePayload - MESSAGE_RECEIVE payload
 * @param {Object} context - { correlationId }
 */
function attemptRealtimeDelivery(messageId, receivePayload, context = {}) {
  wsMessageService.attemptDelivery(messageId, receivePayload, context).catch(() => {
    // Recipient offline or delivery failed; message remains in DB for replay
  });
}

module.exports = { attemptRealtimeDelivery };
