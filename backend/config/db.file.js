'use strict';

/**
 * Async wrapper around file-backed message store (dev only).
 * Used when MESSAGE_STORE=file and NODE_ENV !== 'production'.
 * Same API as message.mongo for config/db.js.
 */

const fileStore = require('../storage/message.store');

function p(syncFn) {
  return (...args) => Promise.resolve(syncFn(...args));
}

async function persistMessage(messageData) {
  return fileStore.persistMessageSync(messageData);
}

async function getMessage(messageId) {
  return fileStore.getMessageSync(messageId);
}

async function getAllHistory(chatId) {
  const list = fileStore.getMessagesByChatIdSync(chatId);
  if (!chatId || !chatId.startsWith('room:')) {
    return list;
  }
  const byRoomMessageId = new Map();
  for (const m of list) {
    const rid = m.roomMessageId || m.messageId;
    if (!byRoomMessageId.has(rid)) byRoomMessageId.set(rid, m);
  }
  return Array.from(byRoomMessageId.values()).sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
}

async function getContextWindow(chatId, messageId, options = {}) {
  const before = Math.max(0, parseInt(options.before, 10) || 2);
  const after = Math.max(0, parseInt(options.after, 10) || 2);
  if (!chatId || typeof chatId !== 'string' || !messageId || typeof messageId !== 'string') {
    return { anchor: null, context: [] };
  }
  const list = fileStore.getMessagesByChatIdSync(chatId.trim());
  const anchor = list.find((m) => m.messageId === messageId || m.roomMessageId === messageId);
  if (!anchor) return { anchor: null, context: [] };
  const anchorNorm = { messageId: anchor.messageId, ...anchor };
  const idx = list.findIndex((m) => (m.messageId === messageId || m.roomMessageId === messageId));
  const beforeSlice = list.slice(Math.max(0, idx - before), idx);
  const afterSlice = list.slice(idx + 1, idx + 1 + after);
  const context = [...beforeSlice, anchorNorm, ...afterSlice].map((m) => ({ messageId: m.messageId, ...m }));
  return { anchor: anchorNorm, context };
}

async function deleteMessages(messageIds) {
  if (!Array.isArray(messageIds) || messageIds.length === 0) return 0;
  let n = 0;
  for (const id of messageIds) {
    if (fileStore.deleteMessageSync(id)) n++;
  }
  return n;
}

function toSearchResult(m) {
  const content = (m.content && typeof m.content === 'string') ? m.content : '';
  const preview = content.length > 120 ? content.substring(0, 120) + '…' : content;
  return {
    messageId: m.messageId,
    chatId: m.chatId || null,
    chatType: m.chatId && m.chatId.startsWith('room:') ? 'room' : 'direct',
    senderId: m.senderId || null,
    preview,
    createdAt: m.createdAt ?? m.timestamp ?? null,
  };
}

async function searchMessagesInChats(chatIds, query, limit = 20, options = {}) {
  if (!Array.isArray(chatIds) || chatIds.length === 0) return [];
  const cap = Math.min(50, Math.max(1, limit || 20));
  const trimmed = (query && typeof query === 'string' ? query.trim() : '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = trimmed.length > 0 ? new RegExp(trimmed, 'i') : null;
  const byId = new Map();
  for (const chatId of chatIds) {
    const list = fileStore.getMessagesByChatIdSync(chatId);
    for (const m of list) {
      if (regex && !regex.test(m.content || '')) continue;
      if (!byId.has(m.messageId)) byId.set(m.messageId, toSearchResult(m));
    }
  }
  const combined = Array.from(byId.values());
  combined.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  return combined.slice(0, cap);
}

module.exports = {
  persistMessage,
  updateMessageState: p(fileStore.updateMessageStateSync),
  getMessage,
  editMessageContent: p(fileStore.editMessageContentSync),
  softDeleteMessage: p(fileStore.softDeleteMessageSync),
  markMessageDelivered: p(fileStore.markMessageDeliveredSync),
  isMessageDelivered: p(fileStore.isMessageDeliveredSync),
  getUndeliveredMessages: p(fileStore.getUndeliveredMessagesSync),
  getReadStates: p(fileStore.getReadStatesSync),
  getMessagesForRecipient: p(fileStore.getMessagesForRecipientSync),
  getMessagesForSender: p(fileStore.getMessagesForSenderSync),
  getMessagesByRoom: p(fileStore.getMessagesByRoomIdSync),
  getDeliveredRecipientIdsForRoomMessage: p(fileStore.getDeliveredRecipientIdsForRoomMessageSync),
  getHistoryPaginated: p(fileStore.getHistoryPaginatedSync),
  getAllHistory,
  getContextWindow,
  deleteMessage: p(fileStore.deleteMessageSync),
  deleteMessages,
  clearStore: p(fileStore.clearStoreSync),
  getMessageCount: p(fileStore.getMessageCountSync),
  searchMessagesInChats,
};
