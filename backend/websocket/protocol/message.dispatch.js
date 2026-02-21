'use strict';

/**
 * Tier-3: Message dispatch — delegates to existing message engine with defensive checks.
 * Does not replace Tier-1/2; ensures idempotency and state consistency at the boundary.
 */

const messageEngine = require('../handlers/messageEngine');
const messageStore = require('../../services/message.store');
const { MessageState, isDeliveredOrRead } = require('../../models/message.state');
const logger = require('../../utils/logger');

/**
 * Dispatch MESSAGE_SEND: delegate to messageEngine. Tier-3 adds no new logic; engine already does DB-first + idempotency.
 * @param {WebSocket} ws
 * @param {Object} payload - { recipientId, content, clientMessageId? }
 * @returns {Promise<Object>} Response to send to client
 */
async function dispatchSend(ws, payload) {
  return messageEngine.handleMessageSend(ws, payload);
}

/**
 * Dispatch delivery confirmation: delegate to messageEngine.
 * @param {WebSocket} ws
 * @param {Object} payload - { messageId }
 * @returns {Promise<Object>}
 */
async function dispatchDeliveredConfirm(ws, payload) {
  return messageEngine.handleMessageDeliveredConfirm(ws, payload);
}

/**
 * Dispatch read: delegate to messageEngine.
 * @param {WebSocket} ws
 * @param {Object} payload - { messageId }
 * @returns {Promise<Object>}
 */
async function dispatchRead(ws, payload) {
  return messageEngine.handleMessageRead(ws, payload);
}

/**
 * Dispatch replay: delegate to messageEngine (already enforces lastMessageId, idempotent delivery).
 * Defensive: ensure lastMessageId exists in DB before delegating.
 * @param {WebSocket} ws
 * @param {Object} payload - { lastMessageId?, limit? }
 * @returns {Promise<Object>}
 */
async function dispatchReplay(ws, payload) {
  const { lastMessageId } = payload;
  if (lastMessageId != null && lastMessageId !== '') {
    const existing = await messageStore.getById(lastMessageId);
    if (!existing) {
      return {
        type: 'MESSAGE_ERROR',
        error: 'Invalid lastMessageId: message not found in database',
        code: 'INVALID_LAST_MESSAGE_ID',
        lastMessageId,
      };
    }
  }
  return messageEngine.handleMessageReplay(ws, payload);
}

/**
 * Dispatch state sync: delegate to messageEngine.
 * @param {WebSocket} ws
 * @param {Object} payload - { lastMessageId?, lastReadMessageId? }
 * @returns {Promise<Object>}
 */
async function dispatchStateSync(ws, payload) {
  return messageEngine.handleStateSync(ws, payload);
}

/**
 * Check if a message should be skipped during replay (already delivered/read)
 * Used by offline sync to avoid duplicate delivery.
 * @param {string} messageId
 * @param {string} userId
 * @param {Object} msg - Message object with state
 * @returns {Promise<boolean>} true if should skip
 */
async function shouldSkipReplay(messageId, userId, msg) {
  if (isDeliveredOrRead(msg.state)) return true;
  return messageStore.isDeliveredTo(messageId, userId);
}

module.exports = {
  dispatchSend,
  dispatchDeliveredConfirm,
  dispatchRead,
  dispatchReplay,
  dispatchStateSync,
  shouldSkipReplay,
  MessageState,
};
