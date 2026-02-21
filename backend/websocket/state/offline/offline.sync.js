'use strict';

/**
 * Tier-3: Offline sync — replay and state sync. Delegates to message engine (Tier-1/2).
 */

const messageEngine = require('../../handlers/messageEngine');

/**
 * Run state sync for a reconnected client. Returns presence, undelivered count, read/delivered state.
 * @param {WebSocket} ws - Client WebSocket (must be authenticated)
 * @param {Object} payload - { lastMessageId?, lastReadMessageId? }
 * @returns {Promise<Object>} STATE_SYNC_RESPONSE shape
 */
async function runStateSync(ws, payload) {
  return messageEngine.handleStateSync(ws, payload);
}

/**
 * Run message replay for a reconnected client. Fetches undelivered after lastMessageId and delivers sequentially.
 * Idempotent: no duplicates (engine checks delivery tracking and state).
 * @param {WebSocket} ws - Client WebSocket
 * @param {Object} payload - { lastMessageId?, limit? }
 * @returns {Promise<Object>} MESSAGE_REPLAY_COMPLETE or MESSAGE_ERROR
 */
async function runReplay(ws, payload) {
  return messageEngine.handleMessageReplay(ws, payload);
}

module.exports = {
  runStateSync,
  runReplay,
};
