'use strict';

/**
 * Offline / reconnect / state-sync service.
 * Delegates replay to backend/services/replay.service.
 * Owns: state sync aggregation logic.
 */

const { MessageState } = require('../../models/message.state');
const replayService = require('../../services/replay.service');
const messageStoreService = require('../../services/message.store');

/**
 * Build state sync response for reconnecting client.
 * @param {string} userId
 * @param {Object} presenceState - From presence read
 * @param {Object} params - { lastMessageId, lastReadMessageId }
 * @returns {Promise<Object>} STATE_SYNC_RESPONSE
 */
async function buildStateSyncResponse(userId, presenceState, params) {
  const { lastMessageId, lastReadMessageId } = params;

  let undeliveredCount = 0;
  let hasMoreMessages = false;
  if (lastMessageId !== undefined) {
    try {
      const undeliveredMessages = await messageStoreService.getUndelivered(userId, lastMessageId || null, 1);
      undeliveredCount = undeliveredMessages.length;
      hasMoreMessages = undeliveredMessages.length > 0;
    } catch {
      undeliveredCount = 0;
      hasMoreMessages = false;
    }
  }

  let readMessageIds = [];
  if (lastReadMessageId !== undefined) {
    try {
      readMessageIds = await messageStoreService.getReadStates(userId, lastReadMessageId || null, 1000);
    } catch {
      readMessageIds = [];
    }
  }

  let deliveredMessageIds = [];
  if (lastMessageId !== undefined && lastMessageId !== null) {
    try {
      const allMessages = await messageStoreService.getMessagesForRecipient(userId);
      const afterMsg = await messageStoreService.getById(lastMessageId);
      if (afterMsg) {
        deliveredMessageIds = allMessages
          .filter(msg => {
            if (msg.timestamp < afterMsg.timestamp) return false;
            if (msg.timestamp === afterMsg.timestamp && msg.messageId <= lastMessageId) return false;
            return msg.state === MessageState.DELIVERED;
          })
          .map(msg => msg.messageId)
          .slice(0, 1000);
      }
    } catch {
      deliveredMessageIds = [];
    }
  }

  return {
    type: 'STATE_SYNC_RESPONSE',
    presence: presenceState,
    undeliveredCount,
    hasMoreMessages,
    deliveredMessageIds,
    deliveredCount: deliveredMessageIds.length,
    readMessageIds,
    readCount: readMessageIds.length,
    timestamp: Date.now(),
  };
}

/**
 * Replay undelivered messages for user.
 * @param {string} userId
 * @param {string|null} lastMessageId
 * @param {number} [limit]
 * @returns {Promise<Object>}
 */
async function replayMessages(userId, lastMessageId, limit) {
  return replayService.replayMessages(userId, lastMessageId, limit);
}

module.exports = {
  buildStateSyncResponse,
  replayMessages,
};
