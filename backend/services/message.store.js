'use strict';

/**
 * Tier-3: Message read layer. Wraps dbAdapter for reads.
 * Lifecycle writes (persist) are owned by message.service.js only.
 * 
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * DB ADAPTER OWNERSHIP (ALLOWED)
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 
 * This file is ALLOWED to import config/db.js because:
 * - It is a read-only wrapper around dbAdapter
 * - It provides a service-level API for message reads
 * - It is part of the services/ layer (canonical read path)
 * 
 * This file MUST NOT:
 * - Perform writes (only message.service.js can write)
 * - Be imported by controllers/handlers (use service APIs instead)
 * 
 * See: docs/MIGRATION_CHECKLIST.md for DB ownership rules.
 */

const dbAdapter = require('../config/db');
const replayService = require('./replay.service');
const logger = require('../utils/logger');

const DEFAULT_REPLAY_LIMIT = 100;
const MAX_REPLAY_LIMIT = 500;

/**
 * Get a single message by ID
 * @param {string} messageId
 * @returns {Promise<Object|null>}
 */
async function getById(messageId) {
  if (!messageId || typeof messageId !== 'string') return null;
  try {
    return await dbAdapter.getMessage(messageId);
  } catch (err) {
    logger.error('MessageStore', 'get_failed', { messageId, error: err.message });
    return null;
  }
}

/**
 * Check if message was already delivered to user (for idempotent replay)
 * @param {string} messageId
 * @param {string} userId
 * @returns {Promise<boolean>}
 */
async function isDeliveredTo(messageId, userId) {
  try {
    return await dbAdapter.isMessageDelivered(messageId, userId);
  } catch (err) {
    return false;
  }
}

/**
 * Get undelivered messages. Delegates to replay.service (single replay path).
 * @param {string} recipientId
 * @param {string|null} afterMessageId - Exclusive cursor
 * @param {number} [limit]
 * @returns {Promise<Array<Object>>}
 */
async function getUndelivered(recipientId, afterMessageId = null, limit = DEFAULT_REPLAY_LIMIT) {
  const cappedLimit = Math.min(MAX_REPLAY_LIMIT, Math.max(1, limit));
  return replayService.getUndeliveredMessages(recipientId, afterMessageId, cappedLimit);
}

/**
 * Get paginated chat history for a recipient (Tier-3 history API)
 * @param {string} recipientId
 * @param {{ beforeId?: string, limit?: number }} options
 * @returns {Promise<{ messages: Array<Object>, nextCursor: string|null, hasMore: boolean }>}
 */
async function getHistoryPaginated(recipientId, options = {}) {
  if (!recipientId || typeof recipientId !== 'string') {
    return { messages: [], nextCursor: null, hasMore: false };
  }
  try {
    return await dbAdapter.getHistoryPaginated(recipientId, options);
  } catch (err) {
    logger.error('MessageStore', 'get_history_failed', { recipientId, error: err.message });
    return { messages: [], nextCursor: null, hasMore: false };
  }
}

/**
 * Get all messages for a recipient
 * @param {string} recipientId
 * @returns {Promise<Array<Object>>}
 */
async function getMessagesForRecipient(recipientId) {
  if (!recipientId || typeof recipientId !== 'string') return [];
  try {
    return await dbAdapter.getMessagesForRecipient(recipientId);
  } catch (err) {
    logger.error('MessageStore', 'get_messages_for_recipient_failed', { recipientId, error: err.message });
    return [];
  }
}

/**
 * Get all messages where user is sender (for chat list: outgoing conversations)
 * @param {string} senderId
 * @returns {Promise<Array<Object>>}
 */
async function getMessagesForSender(senderId) {
  if (!senderId || typeof senderId !== 'string') return [];
  try {
    return await dbAdapter.getMessagesForSender(senderId);
  } catch (err) {
    logger.error('MessageStore', 'get_messages_for_sender_failed', { senderId, error: err.message });
    return [];
  }
}

/**
 * Get all messages for a room (by roomId). Used for room history.
 * @param {string} roomId
 * @returns {Promise<Array<Object>>}
 */
async function getMessagesByRoom(roomId) {
  if (!roomId || typeof roomId !== 'string') return [];
  try {
    return await dbAdapter.getMessagesByRoom(roomId);
  } catch (err) {
    logger.error('MessageStore', 'get_messages_by_room_failed', { roomId, error: err.message });
    return [];
  }
}

/**
 * Get recipient IDs who have received (state delivered/read) for a room message. Used for aggregation cache fallback.
 * @param {string} roomMessageId
 * @returns {Promise<string[]>}
 */
async function getDeliveredRecipientIdsForRoomMessage(roomMessageId) {
  if (!roomMessageId || typeof roomMessageId !== 'string') return [];
  try {
    return await dbAdapter.getDeliveredRecipientIdsForRoomMessage(roomMessageId);
  } catch (err) {
    logger.error('MessageStore', 'get_delivered_recipients_room_failed', { roomMessageId, error: err.message });
    return [];
  }
}

/**
 * Get full history for a chat (no pagination). Used for export.
 * @param {string} chatId - direct:u1:u2 or room:roomId
 * @returns {Promise<Array<Object>>}
 */
async function getAllHistory(chatId) {
  if (!chatId || typeof chatId !== 'string') return [];
  try {
    return await dbAdapter.getAllHistory(chatId.trim());
  } catch (err) {
    logger.error('MessageStore', 'get_all_history_failed', { chatId, error: err.message });
    return [];
  }
}

/**
 * Get bounded context window around an anchor message (O(1) bounded queries instead of O(N) history scan).
 * @param {string} chatId - direct:u1:u2 or room:roomId
 * @param {string} messageId - Anchor (or roomMessageId in rooms)
 * @param {{ before?: number, after?: number }} options - Default { before: 2, after: 2 }
 * @returns {Promise<{ anchor: Object|null, context: Array }>} context oldest→newest, max before+1+after
 */
async function getContextWindow(chatId, messageId, options = {}) {
  if (!chatId || typeof chatId !== 'string' || !messageId || typeof messageId !== 'string') {
    return { anchor: null, context: [] };
  }
  try {
    return await dbAdapter.getContextWindow(chatId.trim(), messageId.trim(), options);
  } catch (err) {
    logger.error('MessageStore', 'get_context_window_failed', { chatId, messageId, error: err.message });
    return { anchor: null, context: [] };
  }
}

/**
 * Get read states for a user (for state sync)
 * @param {string} userId
 * @param {string|null} afterMessageId
 * @param {number} limit
 * @returns {Promise<Array<string>>} messageIds
 */
async function getReadStates(userId, afterMessageId = null, limit = 1000) {
  try {
    return await dbAdapter.getReadStates(userId, afterMessageId, limit);
  } catch (err) {
    logger.error('MessageStore', 'get_read_states_failed', { userId, error: err.message });
    return [];
  }
}

/**
 * Search messages by content within allowed chatIds (case-insensitive partial match).
 * Supports read-after-write: primary read, recent fallback, optional includeClientMsgId.
 * @param {string[]} chatIds - Allowed chatIds
 * @param {string} query - Search string
 * @param {number} [limit=20] - Max results
 * @param {Object} [options] - { includeClientMsgId?: string } force-include by client message id
 * @returns {Promise<Array<{ messageId, chatId, chatType, senderId, preview, createdAt }>>}
 */
async function searchMessagesInChats(chatIds, query, limit = 20, options = {}) {
  if (!Array.isArray(chatIds) || chatIds.length === 0) {
    return [];
  }
  const trimmed = query && typeof query === 'string' ? query.trim() : '';
  try {
    return await dbAdapter.searchMessagesInChats(
      chatIds,
      trimmed,
      Math.min(50, Math.max(1, limit || 20)),
      options
    );
  } catch (err) {
    logger.error('MessageStore', 'search_messages_failed', { query: (query || '').substring(0, 50), error: err.message });
    return [];
  }
}

module.exports = {
  getById,
  isDeliveredTo,
  getUndelivered,
  getHistoryPaginated,
  getMessagesForRecipient,
  getMessagesForSender,
  getMessagesByRoom,
  getDeliveredRecipientIdsForRoomMessage,
  getAllHistory,
  getContextWindow,
  getReadStates,
  searchMessagesInChats,
};
