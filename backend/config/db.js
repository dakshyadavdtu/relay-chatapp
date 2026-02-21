'use strict';

/**
 * Database Adapter — Mongo by default; optional file-backed store in dev only.
 *
 * - Production (NODE_ENV=production): MUST use MongoDB. If MESSAGE_STORE=file, startup throws.
 * - Dev/test: uses Mongo unless MESSAGE_STORE=file (explicit opt-in to file-backed store).
 *
 * DB_URI is required in production (env.validate.js). All methods return Promises.
 * Idempotency: messageId and (senderId, clientMessageId) uniqueness.
 */

// Strict gating: production must never use file-backed message store
if (process.env.NODE_ENV === 'production' && process.env.MESSAGE_STORE === 'file') {
  throw new Error(
    'Production must not use file-backed message store. Set MESSAGE_STORE to something other than "file" or unset it; use MongoDB only.'
  );
}

const useFileStore =
  process.env.NODE_ENV !== 'production' && process.env.MESSAGE_STORE === 'file';

const store = useFileStore ? require('./db.file') : require('../storage/message.mongo');

async function persistMessage(messageData) {
  return store.persistMessage(messageData);
}

async function updateMessageState(messageId, newState) {
  return store.updateMessageState(messageId, newState);
}

async function getMessage(messageId) {
  return store.getMessage(messageId);
}

async function editMessageContent(messageId, actorUserId, newContent) {
  return store.editMessageContent(messageId, actorUserId, newContent);
}

async function softDeleteMessage(messageId, actorUserId) {
  return store.softDeleteMessage(messageId, actorUserId);
}

async function markMessageDelivered(messageId, userId) {
  return store.markMessageDelivered(messageId, userId);
}

async function isMessageDelivered(messageId, userId) {
  return store.isMessageDelivered(messageId, userId);
}

async function getUndeliveredMessages(recipientId, afterMessageId = null, limit = 100) {
  return store.getUndeliveredMessages(recipientId, afterMessageId, limit);
}

async function getReadStates(userId, afterMessageId = null, limit = 1000) {
  return store.getReadStates(userId, afterMessageId, limit);
}

async function getMessagesForRecipient(recipientId) {
  return store.getMessagesForRecipient(recipientId);
}

async function getMessagesForSender(senderId) {
  return store.getMessagesForSender(senderId);
}

async function getMessagesByRoom(roomId) {
  return store.getMessagesByRoom(roomId);
}

async function getDeliveredRecipientIdsForRoomMessage(roomMessageId) {
  return store.getDeliveredRecipientIdsForRoomMessage(roomMessageId);
}

async function getHistoryPaginated(recipientId, options = {}) {
  return store.getHistoryPaginated(recipientId, options);
}

async function getAllHistory(chatId) {
  return store.getAllHistory(chatId);
}

async function getContextWindow(chatId, messageId, options) {
  return store.getContextWindow(chatId, messageId, options);
}

async function deleteMessage(messageId) {
  return store.deleteMessage(messageId);
}

async function deleteMessages(messageIds) {
  if (!Array.isArray(messageIds) || messageIds.length === 0) return 0;
  return store.deleteMessages(messageIds);
}

async function clearStore() {
  return store.clearStore();
}

async function getMessageCount() {
  return store.getMessageCount();
}

async function searchMessagesInChats(chatIds, query, limit, options) {
  return store.searchMessagesInChats(chatIds, query, limit, options);
}

module.exports = {
  persistMessage,
  updateMessageState,
  getMessage,
  editMessageContent,
  softDeleteMessage,
  markMessageDelivered,
  isMessageDelivered,
  getUndeliveredMessages,
  getReadStates,
  getMessagesForRecipient,
  getMessagesForSender,
  getMessagesByRoom,
  getDeliveredRecipientIdsForRoomMessage,
  getHistoryPaginated,
  getAllHistory,
  getContextWindow,
  deleteMessage,
  deleteMessages,
  clearStore,
  getMessageCount,
  searchMessagesInChats,
  useMongo: !useFileStore,
};
