'use strict';

/**
 * File-backed message storage (dev only). Survives restarts.
 * Same semantics as in-memory db adapter: messageId + (senderId:clientMessageId) uniqueness,
 * delivery tracking per messageId.
 * Atomic write via temp file + rename.
 *
 * MUST NOT be used in production (risk of persisting messages to local disk).
 */
if (process.env.NODE_ENV === 'production') {
  throw new Error(
    'File-backed message store (storage/message.store.js) must not be used in production. Use MongoDB (MESSAGE_STORE not set or not "file").'
  );
}

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '_data');
const DATA_FILE = path.join(DATA_DIR, 'messages.json');
const TMP_FILE = path.join(DATA_DIR, 'messages.json.tmp');

/** @type {Map<string, Object>} messageId -> message record */
const messageById = new Map();
/** @type {Map<string, string>} (senderId:clientMessageId) -> messageId */
const clientMessageIdIndex = new Map();
/** @type {Map<string, Set<string>>} messageId -> Set of userIds delivered */
const deliveryTracking = new Map();

let writeInProgress = false;

function ensureDir() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }
}

function persist() {
  if (writeInProgress) return;
  writeInProgress = true;
  try {
    ensureDir();
    const messages = [];
    for (const [, msg] of messageById) {
      messages.push({ ...msg });
    }
    const delivered = {};
    for (const [mid, set] of deliveryTracking) {
      delivered[mid] = Array.from(set);
    }
    const payload = { messages, delivered };
    fs.writeFileSync(TMP_FILE, JSON.stringify(payload, null, 0), 'utf8');
    fs.renameSync(TMP_FILE, DATA_FILE);
  } finally {
    writeInProgress = false;
  }
}

function hydrate() {
  messageById.clear();
  clientMessageIdIndex.clear();
  deliveryTracking.clear();
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const data = JSON.parse(raw);
    const messages = Array.isArray(data.messages) ? data.messages : [];
    const delivered = data.delivered && typeof data.delivered === 'object' ? data.delivered : {};
    for (const msg of messages) {
      if (!msg || !msg.messageId) continue;
      const record = { ...msg };
      messageById.set(record.messageId, record);
      if (record.clientMessageId && record.senderId) {
        clientMessageIdIndex.set(`${record.senderId}:${record.clientMessageId}`, record.messageId);
      }
      const userIds = delivered[record.messageId];
      if (Array.isArray(userIds)) {
        deliveryTracking.set(record.messageId, new Set(userIds));
      } else {
        deliveryTracking.set(record.messageId, new Set());
      }
    }
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

ensureDir();
hydrate();

// ─── Sync API (used by db.js wrapper) ───────────────────────────────────────

function persistMessageSync(messageData) {
  const {
    messageId,
    senderId,
    recipientId,
    content,
    timestamp,
    state,
    messageType,
    roomId,
    roomMessageId,
    chatId,
    contentType,
    clientMessageId,
  } = messageData;

  if (!messageId || !senderId || !recipientId || !content) {
    throw new Error('Missing required fields for message persistence');
  }

  if (messageById.has(messageId)) {
    return { ...messageById.get(messageId) };
  }

  const idempotencyKey = clientMessageId && typeof clientMessageId === 'string' && clientMessageId.trim()
    ? `${senderId}:${clientMessageId}`
    : null;
  if (idempotencyKey) {
    const existingId = clientMessageIdIndex.get(idempotencyKey);
    if (existingId && messageById.has(existingId)) {
      return { ...messageById.get(existingId) };
    }
  }

  const now = Date.now();
  const newMessage = {
    messageId,
    senderId,
    recipientId,
    content,
    timestamp,
    state,
    messageType,
    roomId,
    roomMessageId,
    chatId,
    contentType,
    clientMessageId,
    createdAt: now,
    updatedAt: now,
  };
  messageById.set(messageId, newMessage);
  deliveryTracking.set(messageId, new Set());
  if (idempotencyKey) clientMessageIdIndex.set(idempotencyKey, messageId);
  persist();
  return { ...newMessage };
}

function updateMessageStateSync(messageId, newState) {
  const message = messageById.get(messageId);
  if (!message) throw new Error(`Message ${messageId} not found in database`);
  message.state = newState;
  message.updatedAt = Date.now();
  messageById.set(messageId, message);
  persist();
}

function getMessageSync(messageId) {
  const message = messageById.get(messageId);
  return message ? { ...message } : null;
}

function markMessageDeliveredSync(messageId, userId) {
  if (!deliveryTracking.has(messageId)) deliveryTracking.set(messageId, new Set());
  deliveryTracking.get(messageId).add(userId);
  persist();
}

function isMessageDeliveredSync(messageId, userId) {
  const set = deliveryTracking.get(messageId);
  return set ? set.has(userId) : false;
}

function getUndeliveredMessagesSync(recipientId, afterMessageId, limit = 100) {
  const messages = [];
  for (const [mid, message] of messageById) {
    if (message.recipientId !== recipientId) continue;
    if (afterMessageId && mid <= afterMessageId) continue;
    const delivered = deliveryTracking.get(mid);
    const isDelivered = delivered && delivered.has(recipientId);
    const stateOk = message.state === 'delivered' || message.state === 'read';
    if (!isDelivered && !stateOk) {
      messages.push({ ...message, delivered: false });
    }
  }
  messages.sort((a, b) => (a.messageId || '').localeCompare(b.messageId || ''));
  return messages.slice(0, limit);
}

function getReadStatesSync(userId, afterMessageId, limit = 1000) {
  const readMessageIds = [];
  for (const [messageId, message] of messageById) {
    if (message.recipientId !== userId || message.state !== 'read') continue;
    if (afterMessageId) {
      const after = messageById.get(afterMessageId);
      if (after) {
        if (message.timestamp < after.timestamp) continue;
        if (message.timestamp === after.timestamp && messageId <= afterMessageId) continue;
      }
    }
    readMessageIds.push(messageId);
  }
  readMessageIds.sort((a, b) => {
    const ma = messageById.get(a);
    const mb = messageById.get(b);
    if (!ma || !mb) return 0;
    if (ma.timestamp !== mb.timestamp) return ma.timestamp - mb.timestamp;
    return a.localeCompare(b);
  });
  return readMessageIds.slice(0, limit);
}

function getMessagesForRecipientSync(recipientId) {
  const messages = [];
  for (const [messageId, message] of messageById) {
    if (message.recipientId === recipientId) {
      messages.push({ messageId, ...message });
    }
  }
  messages.sort((a, b) => a.timestamp - b.timestamp);
  return messages;
}

function getMessagesForSenderSync(senderId) {
  const messages = [];
  for (const [messageId, message] of messageById) {
    if (message.senderId === senderId) {
      messages.push({ messageId, ...message });
    }
  }
  messages.sort((a, b) => a.timestamp - b.timestamp);
  return messages;
}

/** Room messages: one row per recipient with same roomId; return one per roomMessageId (dedupe by roomMessageId). */
function getMessagesByRoomIdSync(roomId) {
  if (!roomId || typeof roomId !== 'string') return [];
  const byRoomMessageId = new Map();
  for (const [messageId, message] of messageById) {
    if (message.roomId !== roomId) continue;
    const rid = message.roomMessageId || messageId;
    if (!byRoomMessageId.has(rid)) byRoomMessageId.set(rid, { messageId, ...message });
  }
  const messages = Array.from(byRoomMessageId.values());
  messages.sort((a, b) => a.timestamp - b.timestamp);
  return messages;
}

function getHistoryPaginatedSync(recipientId, options = {}) {
  const limit = Math.min(100, Math.max(1, parseInt(options.limit, 10) || 50));
  const beforeId = options.beforeId && typeof options.beforeId === 'string' ? options.beforeId.trim() : null;
  const messages = [];
  for (const [messageId, message] of messageById) {
    if (message.recipientId !== recipientId) continue;
    messages.push({ messageId, ...message });
  }
  messages.sort((a, b) => {
    if (b.timestamp !== a.timestamp) return b.timestamp - a.timestamp;
    return b.messageId.localeCompare(a.messageId);
  });
  let startIndex = 0;
  if (beforeId) {
    const idx = messages.findIndex(m => m.messageId === beforeId);
    startIndex = idx === -1 ? 0 : idx + 1;
  }
  const page = messages.slice(startIndex, startIndex + limit);
  const hasMore = startIndex + limit < messages.length;
  const nextCursor = hasMore && page.length > 0 ? page[page.length - 1].messageId : null;
  return { messages: page, nextCursor, hasMore };
}

function deleteMessageSync(messageId) {
  const existed = messageById.has(messageId);
  messageById.delete(messageId);
  deliveryTracking.delete(messageId);
  for (const [key, mid] of clientMessageIdIndex) {
    if (mid === messageId) {
      clientMessageIdIndex.delete(key);
      break;
    }
  }
  if (existed) persist();
  return existed;
}

function editMessageContentSync(messageId, actorUserId, newContent) {
  const message = messageById.get(messageId);
  if (!message) return null;
  message.content = newContent != null ? String(newContent) : message.content;
  message.updatedAt = Date.now();
  messageById.set(messageId, message);
  persist();
  return { ...message };
}

function softDeleteMessageSync(messageId, actorUserId) {
  const message = messageById.get(messageId);
  if (!message) return null;
  message.state = 'deleted';
  message.updatedAt = Date.now();
  messageById.set(messageId, message);
  persist();
  return { ...message };
}

function clearStoreSync() {
  messageById.clear();
  clientMessageIdIndex.clear();
  deliveryTracking.clear();
  persist();
}

function getMessageCountSync() {
  return messageById.size;
}

/** Get all messages for a chat (by chatId). For db adapter getAllHistory / getContextWindow. */
function getMessagesByChatIdSync(chatId) {
  if (!chatId || typeof chatId !== 'string') return [];
  const list = [];
  for (const [messageId, msg] of messageById) {
    if (msg.chatId === chatId) list.push({ messageId, ...msg });
  }
  list.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  return list;
}

/** Get recipient IDs who have delivery/read state for a room message. For db adapter. */
function getDeliveredRecipientIdsForRoomMessageSync(roomMessageId) {
  if (!roomMessageId || typeof roomMessageId !== 'string') return [];
  const ids = new Set();
  for (const [messageId, msg] of messageById) {
    if (msg.roomMessageId !== roomMessageId && msg.roomId !== roomMessageId) continue;
    const state = (msg.state || '').toLowerCase();
    if (state === 'delivered' || state === 'read') {
      if (msg.recipientId) ids.add(msg.recipientId);
    }
    const set = deliveryTracking.get(messageId);
    if (set) for (const uid of set) ids.add(uid);
  }
  return Array.from(ids);
}

module.exports = {
  hydrate,
  persist,
  persistMessageSync,
  updateMessageStateSync,
  getMessageSync,
  markMessageDeliveredSync,
  isMessageDeliveredSync,
  getUndeliveredMessagesSync,
  getReadStatesSync,
  getMessagesForRecipientSync,
  getMessagesForSenderSync,
  getMessagesByRoomIdSync,
  getHistoryPaginatedSync,
  deleteMessageSync,
  clearStoreSync,
  getMessageCountSync,
  getMessagesByChatIdSync,
  getDeliveredRecipientIdsForRoomMessageSync,
  editMessageContentSync,
  softDeleteMessageSync,
};
