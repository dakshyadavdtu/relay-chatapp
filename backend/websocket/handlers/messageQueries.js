'use strict';

/**
 * Tier-0.3: THIN layer. No DB access. All reads delegate to replayService.
 */

const replayService = require('../../services/replay.service');

/**
 * Fetch messages for delivery. Delegates to replay.service (single replay path).
 * @param {string} userId - Recipient user ID
 * @param {string|null} afterMessageId - Only return messages after this ID (exclusive)
 * @param {number} [limit=100] - Max messages to return
 * @returns {Promise<Array<Object>>} Messages ordered ASC, each with messageId
 */
async function getOrderedMessagesForDelivery(userId, afterMessageId = null, limit = 100) {
  return replayService.getUndeliveredMessages(userId, afterMessageId || null, limit);
}

/**
 * Get missed messages for a user after lastSeenMessageId (for reconnect resync).
 * Delegates to getOrderedMessagesForDelivery so ordering logic lives in one place.
 */
async function getMissedMessages(userId, lastSeenMessageId = null, limit = 100) {
  return getOrderedMessagesForDelivery(userId, lastSeenMessageId, limit);
}

module.exports = {
  getOrderedMessagesForDelivery,
  getMissedMessages,
};
