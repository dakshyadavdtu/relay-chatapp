'use strict';

/**
 * MongoDB message store. Uses same logical API as file store for db adapter.
 * Stores messages with chatId (direct:u1:u2 | room:roomId) for history and export.
 * Read-after-write: insertOne uses writeConcern majority; search uses readPreference primary + recent fallback.
 */

const { ObjectId } = require('mongodb');
const { ReadPreference } = require('mongodb');
const { toRoomChatId } = require('../utils/chatId');
const mongoClient = require('./mongo.client');

const COLLECTION = 'messages';
const DELIVERY_COLLECTION = 'deliveries';

let indexesEnsured = false;

async function getDb() {
  const db = await mongoClient.getDb();
  if (!indexesEnsured) {
    await ensureIndexes(db);
    indexesEnsured = true;
  }
  return db;
}

async function ensureIndexes(database) {
  const col = database.collection(COLLECTION);
  await col.createIndex({ messageId: 1 }, { unique: true });
  await col.createIndex({ chatId: 1, createdAt: -1 });
  await col.createIndex({ chatId: 1, senderId: 1, clientMessageId: 1 }, { unique: true, sparse: true });
  await col.createIndex({ recipientId: 1 });
  await col.createIndex({ senderId: 1 });
  await col.createIndex({ roomId: 1 });
  await col.createIndex({ chatId: 1, messageId: 1 });
  await col.createIndex({ chatId: 1, roomMessageId: 1 }, { sparse: true });
  // Content index for global message search (regex / text); supports efficient scan + sort by createdAt
  try {
    await col.createIndex({ content: 1 });
  } catch (e) {
    if (e.code !== 85 && e.codeName !== 'IndexOptionsConflict') throw e;
  }
  const delCol = database.collection(DELIVERY_COLLECTION);
  await delCol.createIndex({ messageId: 1, userId: 1 }, { unique: true });
}

function normalizeMessage(doc) {
  if (!doc) return null;
  const msg = { ...doc };
  delete msg._id;
  if (doc.timestamp != null) msg.timestamp = doc.timestamp;
  if (doc.createdAt != null) msg.createdAt = doc.createdAt;
  return msg;
}

async function persistMessage(messageData) {
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

  if (!messageId || !senderId || !content) {
    throw new Error('Missing required fields for message persistence');
  }

  const isRoomChat = chatId && typeof chatId === 'string' && chatId.startsWith('room:');
  const effectiveRecipientId = recipientId || (isRoomChat ? chatId.slice(5) : null);
  if (!effectiveRecipientId) {
    throw new Error('Missing required fields for message persistence');
  }

  const database = await getDb();
  const col = database.collection(COLLECTION);
  const existing = await col.findOne({ messageId });
  if (existing) return normalizeMessage(existing);

  const idempotencyKey = clientMessageId && typeof clientMessageId === 'string' && clientMessageId.trim()
    ? `${senderId}:${clientMessageId}`
    : null;
  if (idempotencyKey) {
    const byClient = await col.findOne({ senderId, clientMessageId: clientMessageId.trim() });
    if (byClient) return normalizeMessage(byClient);
  }

  const now = timestamp != null ? (typeof timestamp === 'number' ? timestamp : Date.now()) : Date.now();
  const doc = {
    messageId,
    senderId,
    recipientId: effectiveRecipientId,
    content,
    timestamp: now,
    createdAt: now,
    updatedAt: now,
    state: state || 'sent',
    messageType: messageType || 'direct',
    roomId: roomId || null,
    roomMessageId: roomMessageId || null,
    chatId: chatId || null,
    contentType: contentType || 'text',
    clientMessageId: clientMessageId || null,
    editedAt: null,
    deleted: false,
    deletedAt: null,
  };
  await col.insertOne(doc, { writeConcern: { w: 'majority' } });

  return normalizeMessage(doc);
}

async function updateMessageState(messageId, newState) {
  const database = await getDb();
  const result = await database.collection(COLLECTION).updateOne(
    { messageId },
    { $set: { state: newState, updatedAt: Date.now() } }
  );
  if (result.matchedCount === 0) throw new Error(`Message ${messageId} not found`);
}

/**
 * Edit message content. Only the sender may edit.
 * @param {string} messageId - Message ID
 * @param {string} actorUserId - User ID (must equal message.senderId)
 * @param {string} newContent - New content
 * @returns {Promise<Object|null>} Updated message doc (normalized) or null if not found / not sender
 */
async function editMessageContent(messageId, actorUserId, newContent) {
  if (!messageId || !actorUserId || newContent == null) return null;
  const database = await getDb();
  const col = database.collection(COLLECTION);
  const now = Date.now();
  const result = await col.findOneAndUpdate(
    { messageId, senderId: actorUserId },
    { $set: { content: String(newContent), editedAt: now, updatedAt: now } },
    { returnDocument: 'after' }
  );
  const doc = result?.value ?? result;
  return doc ? normalizeMessage(doc) : null;
}

/**
 * Soft-delete message. Only the sender may delete. Content is left unchanged; UI uses deleted flag.
 * @param {string} messageId - Message ID
 * @param {string} actorUserId - User ID (must equal message.senderId)
 * @returns {Promise<Object|null>} Updated message doc (normalized) or null if not found / not sender
 */
async function softDeleteMessage(messageId, actorUserId) {
  if (!messageId || !actorUserId) return null;
  const database = await getDb();
  const col = database.collection(COLLECTION);
  const now = Date.now();
  const result = await col.findOneAndUpdate(
    { messageId, senderId: actorUserId },
    { $set: { deleted: true, deletedAt: now, updatedAt: now } },
    { returnDocument: 'after' }
  );
  const doc = result?.value ?? result;
  return doc ? normalizeMessage(doc) : null;
}

async function getMessage(messageId) {
  const database = await getDb();
  const doc = await database.collection(COLLECTION).findOne({ messageId });
  return normalizeMessage(doc);
}

async function markMessageDelivered(messageId, userId) {
  const database = await getDb();
  const delCol = database.collection(DELIVERY_COLLECTION);
  await delCol.updateOne(
    { messageId, userId },
    { $setOnInsert: { messageId, userId, deliveredAt: Date.now() } },
    { upsert: true }
  );
}

async function isMessageDelivered(messageId, userId) {
  const database = await getDb();
  const doc = await database.collection(DELIVERY_COLLECTION).findOne({ messageId, userId });
  return !!doc;
}

async function getUndeliveredMessages(recipientId, afterMessageId = null, limit = 100) {
  const database = await getDb();
  const col = database.collection(COLLECTION);
  const delCol = database.collection(DELIVERY_COLLECTION);
  const delivered = await delCol.find({ userId: recipientId }).toArray();
  const deliveredSet = new Set(delivered.map((d) => d.messageId));
  const filter = afterMessageId
    ? { recipientId, messageId: { $gt: afterMessageId } }
    : { recipientId };
  const messages = await col.find(filter).sort({ messageId: 1 }).limit(limit).toArray();
  return messages
    .filter((m) => !deliveredSet.has(m.messageId) && m.state !== 'delivered' && m.state !== 'read')
    .map((m) => ({ ...normalizeMessage(m), delivered: false }));
}

async function getReadStates(userId, afterMessageId = null, limit = 1000) {
  const database = await getDb();
  const col = database.collection(COLLECTION);
  let cursor = col.find({ recipientId: userId, state: 'read' }).sort({ timestamp: 1, messageId: 1 });
  const all = await cursor.toArray();
  let out = all.map((m) => m.messageId);
  if (afterMessageId) {
    const idx = out.indexOf(afterMessageId);
    out = idx === -1 ? out : out.slice(idx + 1);
  }
  return out.slice(0, limit);
}

async function getMessagesForRecipient(recipientId) {
  const database = await getDb();
  const docs = await database.collection(COLLECTION).find({ recipientId }).sort({ timestamp: 1 }).toArray();
  return docs.map((d) => ({ messageId: d.messageId, ...normalizeMessage(d) }));
}

async function getMessagesForSender(senderId) {
  const database = await getDb();
  const docs = await database.collection(COLLECTION).find({ senderId }).sort({ timestamp: 1 }).toArray();
  return docs.map((d) => ({ messageId: d.messageId, ...normalizeMessage(d) }));
}

async function getMessagesByRoom(roomId) {
  if (!roomId || typeof roomId !== 'string') return [];
  const database = await getDb();
  const chatId = toRoomChatId(roomId);
  const docs = await database.collection(COLLECTION).find({ chatId }).sort({ timestamp: 1 }).toArray();
  const byRoomMessageId = new Map();
  for (const d of docs) {
    const rid = d.roomMessageId || d.messageId;
    if (!byRoomMessageId.has(rid)) byRoomMessageId.set(rid, { messageId: d.messageId, ...normalizeMessage(d) });
  }
  return Array.from(byRoomMessageId.values()).sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
}

/**
 * Get recipient IDs who have received (state delivered/read) for a given room message.
 * Scoped to one roomMessageId for safe fallback after cache loss.
 * @param {string} roomMessageId
 * @returns {Promise<string[]>}
 */
async function getDeliveredRecipientIdsForRoomMessage(roomMessageId) {
  if (!roomMessageId || typeof roomMessageId !== 'string') return [];
  const database = await getDb();
  const docs = await database
    .collection(COLLECTION)
    .find({ roomMessageId, state: { $in: ['delivered', 'read'] } })
    .project({ recipientId: 1 })
    .toArray();
  const ids = [...new Set(docs.map((d) => d.recipientId).filter(Boolean))];
  return ids;
}

async function getHistory(chatId, options = {}) {
  const limit = Math.min(100, Math.max(1, parseInt(options.limit, 10) || 50));
  const beforeId = options.beforeId && typeof options.beforeId === 'string' ? options.beforeId.trim() : null;
  const database = await getDb();
  const col = database.collection(COLLECTION);
  let cursor = col.find({ chatId }).sort({ createdAt: -1, messageId: -1 });
  const all = await cursor.toArray();
  const messages = all.map((d) => ({ messageId: d.messageId, ...normalizeMessage(d) }));
  let startIndex = 0;
  if (beforeId) {
    const idx = messages.findIndex((m) => m.messageId === beforeId);
    startIndex = idx === -1 ? 0 : idx + 1;
  }
  const page = messages.slice(startIndex, startIndex + limit);
  const hasMore = startIndex + limit < messages.length;
  const nextCursor = hasMore && page.length > 0 ? page[page.length - 1].messageId : null;
  return { messages: page, nextCursor, hasMore };
}

async function getAllHistory(chatId) {
  const database = await getDb();
  const col = database.collection(COLLECTION);
  const docs = await col.find({ chatId }).sort({ createdAt: 1, messageId: 1 }).toArray();
  const list = docs.map((d) => ({ messageId: d.messageId, ...normalizeMessage(d) }));
  if (chatId.startsWith('room:')) {
    const byRoomMessageId = new Map();
    for (const m of list) {
      const rid = m.roomMessageId || m.messageId;
      if (!byRoomMessageId.has(rid)) byRoomMessageId.set(rid, m);
    }
    return Array.from(byRoomMessageId.values()).sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  }
  return list;
}

/**
 * Get a small context window around an anchor message (O(1) bounded queries instead of O(N) history scan).
 * Works for group rooms with duplicate/alias message ids; dedup by dedupKey = roomMessageId || messageId.
 * @param {string} chatId - direct:u1:u2 or room:roomId
 * @param {string} messageId - Anchor message id (or roomMessageId in rooms)
 * @param {{ before?: number, after?: number }} options - Count of messages before/after (default 2 each)
 * @returns {Promise<{ anchor: Object|null, context: Array }>} context is oldest→newest, max before+1+after
 */
async function getContextWindow(chatId, messageId, options = {}) {
  const before = Math.max(0, parseInt(options.before, 10) || 2);
  const after = Math.max(0, parseInt(options.after, 10) || 2);
  if (!chatId || typeof chatId !== 'string' || !messageId || typeof messageId !== 'string') {
    return { anchor: null, context: [] };
  }
  const database = await getDb();
  const col = database.collection(COLLECTION);

  // 1) Resolve anchor (messageId or roomMessageId for rooms)
  const anchorDoc = await col.findOne({
    chatId: chatId.trim(),
    $or: [{ messageId }, { roomMessageId: messageId }],
  });
  if (!anchorDoc) {
    return { anchor: null, context: [] };
  }
  const anchorTs = anchorDoc.createdAt != null ? anchorDoc.createdAt : anchorDoc.timestamp;
  const anchorNorm = { messageId: anchorDoc.messageId, ...normalizeMessage(anchorDoc) };

  // 2) BEFORE: strictly before anchor time, newest-first; then dedup and take up to `before` in chronological order
  const beforeDocs = await col
    .find({ chatId: chatId.trim(), createdAt: { $lt: anchorTs } })
    .sort({ createdAt: -1, messageId: -1 })
    .limit(50)
    .toArray();
  const beforeChrono = beforeDocs.map((d) => ({ messageId: d.messageId, ...normalizeMessage(d) })).reverse();
  const beforeByKey = new Map();
  for (const m of beforeChrono) {
    const key = m.roomMessageId || m.messageId;
    if (!beforeByKey.has(key)) beforeByKey.set(key, m);
  }
  const beforeUnique = Array.from(beforeByKey.values()).slice(-before);

  // 3) AFTER: strictly after anchor time, oldest-first; dedup and take up to `after`
  const afterDocs = await col
    .find({ chatId: chatId.trim(), createdAt: { $gt: anchorTs } })
    .sort({ createdAt: 1, messageId: 1 })
    .limit(50)
    .toArray();
  const afterNorm = afterDocs.map((d) => ({ messageId: d.messageId, ...normalizeMessage(d) }));
  const afterByKey = new Map();
  for (const m of afterNorm) {
    const key = m.roomMessageId || m.messageId;
    if (!afterByKey.has(key)) afterByKey.set(key, m);
  }
  const afterUnique = Array.from(afterByKey.values()).slice(0, after);

  // 4) context = [...before, anchor, ...after] (oldest→newest), max before+1+after
  const context = [...beforeUnique, anchorNorm, ...afterUnique];
  return { anchor: anchorNorm, context };
}

async function getHistoryPaginated(recipientId, options = {}) {
  const limit = Math.min(100, Math.max(1, parseInt(options.limit, 10) || 50));
  const beforeId = options.beforeId && typeof options.beforeId === 'string' ? options.beforeId.trim() : null;
  const messages = await getMessagesForRecipient(recipientId);
  const sorted = [...messages].sort((a, b) => {
    if (b.timestamp !== a.timestamp) return b.timestamp - a.timestamp;
    return (b.messageId || '').localeCompare(a.messageId || '');
  });
  let startIndex = 0;
  if (beforeId) {
    const idx = sorted.findIndex((m) => m.messageId === beforeId);
    startIndex = idx === -1 ? 0 : idx + 1;
  }
  const page = sorted.slice(startIndex, startIndex + limit);
  const hasMore = startIndex + limit < sorted.length;
  const nextCursor = hasMore && page.length > 0 ? page[page.length - 1].messageId : null;
  return { messages: page, nextCursor, hasMore };
}

async function deleteMessage(messageId) {
  const database = await getDb();
  const col = database.collection(COLLECTION);
  const delCol = database.collection(DELIVERY_COLLECTION);
  const r = await col.deleteOne({ messageId });
  await delCol.deleteMany({ messageId });
  return r.deletedCount > 0;
}

async function deleteMessages(messageIds) {
  if (!Array.isArray(messageIds) || messageIds.length === 0) return 0;
  let n = 0;
  for (const id of messageIds) {
    if (await deleteMessage(id)) n++;
  }
  return n;
}

async function clearStore() {
  const database = await getDb();
  await database.collection(COLLECTION).deleteMany({});
  await database.collection(DELIVERY_COLLECTION).deleteMany({});
}

async function getMessageCount() {
  const database = await getDb();
  return database.collection(COLLECTION).countDocuments();
}

/**
 * Normalize a doc to search result shape.
 * @param {Object} d - Raw message doc
 * @returns {Object} { messageId, chatId, chatType, senderId, preview, createdAt }
 */
function toSearchResult(d) {
  const content = (d.content && typeof d.content === 'string') ? d.content : '';
  const preview = content.length > 120 ? content.substring(0, 120) + '…' : content;
  return {
    messageId: d.messageId,
    chatId: d.chatId || null,
    chatType: d.chatId && d.chatId.startsWith('room:') ? 'room' : 'direct',
    senderId: d.senderId || null,
    preview,
    createdAt: d.createdAt ?? d.timestamp ?? null,
  };
}

/**
 * Search messages by content within allowed chatIds (case-insensitive partial match).
 * Read-after-write: uses readPreference primary and a recent-window fallback so just-sent messages appear.
 * @param {string[]} chatIds - Allowed chatIds (e.g. user's direct + room:ids)
 * @param {string} query - Search string (will be regex-escaped for safety)
 * @param {number} limit - Max results (default 20)
 * @param {Object} [options] - { includeClientMsgId?: string } force-include message by clientMessageId
 * @returns {Promise<Array<{ messageId, chatId, chatType, senderId, preview, createdAt }>>}
 */
async function searchMessagesInChats(chatIds, query, limit = 20, options = {}) {
  if (!Array.isArray(chatIds) || chatIds.length === 0) {
    return [];
  }
  const config = require('../config/constants');
  const recentMinutes = (config.SEARCH_RECENT_FALLBACK_MINUTES != null && config.SEARCH_RECENT_FALLBACK_MINUTES > 0)
    ? config.SEARCH_RECENT_FALLBACK_MINUTES
    : 2;
  const recentMax = (config.SEARCH_RECENT_FALLBACK_MAX != null && config.SEARCH_RECENT_FALLBACK_MAX > 0)
    ? config.SEARCH_RECENT_FALLBACK_MAX
    : 200;

  const database = await getDb();
  const col = database.collection(COLLECTION);
  const readOpts = { readPreference: ReadPreference.primary };
  const cap = Math.min(50, Math.max(1, limit || 20));

  const escaped = (query && typeof query === 'string') ? query.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : '';
  const hasQuery = escaped.length > 0;
  const regex = hasQuery ? new RegExp(escaped, 'i') : null;

  const byId = new Map();

  // 1) Optional: force-include by clientMessageId (read-your-write)
  const includeClientMsgId = options && typeof options.includeClientMsgId === 'string' ? options.includeClientMsgId.trim() : null;
  if (includeClientMsgId) {
    const one = await col.findOne(
      { clientMessageId: includeClientMsgId, chatId: { $in: chatIds } },
      { readPreference: ReadPreference.primary }
    );
    if (one) {
      byId.set(one.messageId, toSearchResult(one));
    }
  }

  // 2) Main search: text/regex with primary read (avoids secondary lag)
  if (hasQuery) {
    const cursor = col.find(
      { chatId: { $in: chatIds }, content: { $regex: regex } },
      { ...readOpts, sort: { createdAt: -1 }, limit: cap }
    );
    const docs = await cursor.toArray();
    for (const d of docs) {
      if (!byId.has(d.messageId)) byId.set(d.messageId, toSearchResult(d));
    }
  }

  // 3) Recent fallback: last N minutes in scope with same query (catches index lag / just-inserted)
  if (hasQuery && regex) {
    const recentWindowStart = Date.now() - recentMinutes * 60 * 1000;
    const recentFilter = {
      chatId: { $in: chatIds },
      createdAt: { $gte: recentWindowStart },
      content: { $regex: regex },
    };
    const recentCursor = col.find(recentFilter, {
      ...readOpts,
      sort: { createdAt: -1 },
      limit: recentMax,
    });
    const recentDocs = await recentCursor.toArray();
    for (const d of recentDocs) {
      if (!byId.has(d.messageId)) byId.set(d.messageId, toSearchResult(d));
    }
  }

  const combined = Array.from(byId.values());
  combined.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  return combined.slice(0, cap);
}

async function close() {
  await mongoClient.closeDb();
  indexesEnsured = false;
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
  getHistory,
  getAllHistory,
  getContextWindow,
  getHistoryPaginated,
  searchMessagesInChats,
  deleteMessage,
  deleteMessages,
  clearStore,
  getMessageCount,
  close,
};
