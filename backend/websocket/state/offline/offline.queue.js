'use strict';

/**
 * Tier-3: Offline message queue.
 * Provides undelivered messages for a user (after optional cursor). Used by replay and resync.
 */

const messageStore = require('../../../services/message.store');
const { isDeliveredOrRead } = require('../../../models/message.state');

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

/**
 * Get undelivered messages for a recipient, strictly after lastMessageId (exclusive).
 * Ordered by timestamp ascending for sequential replay.
 * @param {string} recipientId - User ID (recipient)
 * @param {string|null} afterMessageId - Cursor; only messages after this (exclusive)
 * @param {number} [limit]
 * @returns {Promise<Array<Object>>} Messages in delivery order
 */
async function getUndelivered(recipientId, afterMessageId = null, limit = DEFAULT_LIMIT) {
  if (!recipientId || typeof recipientId !== 'string') {
    return [];
  }
  const capped = Math.min(MAX_LIMIT, Math.max(1, limit));
  return messageStore.getUndelivered(recipientId, afterMessageId || null, capped);
}

/**
 * Get count of undelivered messages for a recipient (after optional cursor).
 * Used for STATE_SYNC "hasMoreMessages" without fetching full list.
 * @param {string} recipientId
 * @param {string|null} afterMessageId
 * @returns {Promise<number>}
 */
async function getUndeliveredCount(recipientId, afterMessageId = null) {
  const list = await messageStore.getUndelivered(recipientId, afterMessageId || null, 1);
  const hasAny = list.length > 0;
  if (!hasAny) return 0;
  const fullCount = await messageStore.getUndelivered(recipientId, afterMessageId || null, MAX_LIMIT);
  return fullCount.length;
}

/**
 * Check if a message is eligible for replay (not yet delivered/read for this user).
 * @param {string} messageId
 * @param {string} userId - Recipient
 * @param {Object} msg - Message with state
 * @returns {Promise<boolean>} true if should be replayed
 */
async function isEligibleForReplay(messageId, userId, msg) {
  if (!msg || !messageId || !userId) return false;
  if (isDeliveredOrRead(msg.state)) return false;
  const delivered = await messageStore.isDeliveredTo(messageId, userId);
  return !delivered;
}

module.exports = {
  getUndelivered,
  getUndeliveredCount,
  isEligibleForReplay,
};
