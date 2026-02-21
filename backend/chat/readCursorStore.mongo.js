'use strict';

/**
 * DB-backed read cursor per user per chat for persistent unread counts.
 * Collection: chat_read_cursors.
 * Document: { userId, chatId, lastReadMessageId, lastReadAt, updatedAt }
 * Unique index: (userId, chatId).
 */

const mongoClient = require('../storage/mongo.client');

const COLLECTION = 'chat_read_cursors';
let indexesEnsured = false;

async function getDb() {
  const db = await mongoClient.getDb();
  if (!indexesEnsured) {
    const col = db.collection(COLLECTION);
    await col.createIndex({ userId: 1, chatId: 1 }, { unique: true });
    indexesEnsured = true;
  }
  return db;
}

/**
 * Get read cursor for (userId, chatId).
 * @param {string} userId
 * @param {string} chatId
 * @returns {Promise<{ lastReadMessageId: string|null, lastReadAt: number|null }|null>}
 */
async function getCursor(userId, chatId) {
  if (!userId || !chatId) return null;
  const db = await getDb();
  const doc = await db.collection(COLLECTION).findOne(
    { userId: userId.trim(), chatId: chatId.trim() },
    { projection: { lastReadMessageId: 1, lastReadAt: 1 } }
  );
  if (!doc) return null;
  return {
    lastReadMessageId: doc.lastReadMessageId ?? null,
    lastReadAt: doc.lastReadAt ?? null,
  };
}

/**
 * Upsert read cursor.
 * @param {string} userId
 * @param {string} chatId
 * @param {string|null} lastReadMessageId
 * @param {number|null} lastReadAt
 * @returns {Promise<{ ok: boolean }>}
 */
async function upsertCursor(userId, chatId, lastReadMessageId, lastReadAt) {
  if (!userId || !chatId) return { ok: false };
  const now = Date.now();
  const db = await getDb();
  await db.collection(COLLECTION).updateOne(
    { userId: userId.trim(), chatId: chatId.trim() },
    {
      $set: {
        lastReadMessageId: lastReadMessageId ?? null,
        lastReadAt: lastReadAt ?? now,
        updatedAt: now,
      },
    },
    { upsert: true }
  );
  return { ok: true };
}

/**
 * Bulk get cursors for a user and multiple chatIds (avoids N+1).
 * @param {string} userId
 * @param {string[]} chatIds
 * @returns {Promise<Map<string, { lastReadMessageId: string|null, lastReadAt: number|null }>>}
 */
async function bulkGetCursors(userId, chatIds) {
  const map = new Map();
  if (!userId || !Array.isArray(chatIds) || chatIds.length === 0) return map;
  const ids = [...new Set(chatIds.map((c) => c && String(c).trim()).filter(Boolean))];
  if (ids.length === 0) return map;
  const db = await getDb();
  const cursor = db.collection(COLLECTION).find(
    { userId: userId.trim(), chatId: { $in: ids } },
    { projection: { chatId: 1, lastReadMessageId: 1, lastReadAt: 1 } }
  );
  for await (const doc of cursor) {
    map.set(doc.chatId, {
      lastReadMessageId: doc.lastReadMessageId ?? null,
      lastReadAt: doc.lastReadAt ?? null,
    });
  }
  return map;
}

module.exports = {
  getCursor,
  upsertCursor,
  bulkGetCursors,
};
