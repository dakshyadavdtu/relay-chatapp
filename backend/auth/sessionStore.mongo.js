'use strict';

/**
 * Auth session store backed by MongoDB Atlas.
 * Collection: sessions. No file persistence.
 * Contract: same API as previous in-memory store (createSession, getSession, revokeSession, refresh hash, etc.).
 */

const crypto = require('crypto');
const mongoClient = require('../storage/mongo.client');
const { normalizeIp } = require('../utils/ip');

const COLLECTION = 'sessions';
const TOUCH_THROTTLE_MS = parseInt(process.env.SESSION_TOUCH_THROTTLE_MS || '60000', 10);
let indexesEnsured = false;

async function getDb() {
  const db = await mongoClient.getDb();
  if (!indexesEnsured) {
    const col = db.collection(COLLECTION);
    await col.createIndex({ sessionId: 1 }, { unique: true });
    await col.createIndex({ userId: 1 });
    await col.createIndex({ refreshExpiresAt: 1 });
    await col.createIndex({ refreshHash: 1 }, { sparse: true });
    indexesEnsured = true;
  }
  return db;
}

function toRecord(doc) {
  if (!doc) return null;
  const { _id, ...rest } = doc;
  return rest;
}

/**
 * Create a new device session.
 * @param {Object} opts - { userId, role, userAgent?, ip? }
 * @returns {Promise<{ sessionId: string }>}
 */
async function createSession(opts) {
  const sessionId = crypto.randomUUID();
  const now = Date.now();
  const doc = {
    sessionId,
    userId: opts.userId,
    role: opts.role || 'USER',
    createdAt: now,
    lastSeenAt: now,
    revokedAt: null,
    refreshHash: null,
    refreshExpiresAt: null,
    userAgent: opts.userAgent ?? null,
    ip: normalizeIp(opts.ip) ?? null,
  };
  const db = await getDb();
  await db.collection(COLLECTION).insertOne(doc);
  return { sessionId };
}

/**
 * Get a session by id.
 * @param {string} sessionId
 * @returns {Promise<Object|null>} Session record (sessionId, userId, role, createdAt, lastSeenAt, revokedAt, userAgent, ip, refreshHash?, refreshExpiresAt?)
 */
async function getSession(sessionId) {
  if (!sessionId || typeof sessionId !== 'string') return null;
  const db = await getDb();
  const doc = await db.collection(COLLECTION).findOne({ sessionId: sessionId.trim() });
  return toRecord(doc);
}

/**
 * List sessions for a user.
 * @param {string} userId
 * @param {{ activeOnly?: boolean }} [opts] - If true (default), only sessions with revokedAt === null
 * @returns {Promise<Object[]>}
 */
async function listSessions(userId, opts = {}) {
  if (!userId) return [];
  const activeOnly = opts.activeOnly !== false;
  const db = await getDb();
  const filter = { userId };
  if (activeOnly) filter.revokedAt = null;
  const cursor = db.collection(COLLECTION).find(filter).sort({ lastSeenAt: -1 });
  const docs = await cursor.toArray();
  return docs.map(toRecord);
}

/**
 * Update lastSeenAt for a session (throttled).
 * @param {string} sessionId
 * @returns {Promise<void>}
 */
async function touchSession(sessionId) {
  const session = await getSession(sessionId);
  if (!session) return;
  const now = Date.now();
  const last = session.lastSeenAt;
  if (typeof last === 'number' && now - last < TOUCH_THROTTLE_MS) return;
  const db = await getDb();
  await db.collection(COLLECTION).updateOne(
    { sessionId },
    { $set: { lastSeenAt: now } }
  );
}

/**
 * Store refresh token hash and expiry for a session.
 * @param {string} sessionId
 * @param {string} refreshHash
 * @param {Date|string|number} expiresAt
 * @returns {Promise<void>}
 */
async function storeRefreshHash(sessionId, refreshHash, expiresAt) {
  const ms = typeof expiresAt === 'number' ? expiresAt : new Date(expiresAt).getTime();
  const db = await getDb();
  await db.collection(COLLECTION).updateOne(
    { sessionId },
    { $set: { refreshHash, refreshExpiresAt: ms } }
  );
}

/**
 * Verify that the given hash matches the stored hash for the session and is not expired.
 * @param {string} sessionId
 * @param {string} refreshHash
 * @returns {Promise<boolean>}
 */
async function verifyRefreshHash(sessionId, refreshHash) {
  const session = await getSession(sessionId);
  if (!session || session.revokedAt != null) return false;
  if (!session.refreshHash || session.refreshExpiresAt == null) return false;
  if (Date.now() > session.refreshExpiresAt) return false;
  if (session.refreshHash.length !== refreshHash.length) return false;
  try {
    return crypto.timingSafeEqual(
      Buffer.from(session.refreshHash, 'hex'),
      Buffer.from(refreshHash, 'hex')
    );
  } catch {
    return false;
  }
}

/**
 * Rotate refresh: replace old hash with new. Atomic.
 * @param {string} sessionId
 * @param {string} oldHash
 * @param {string} newHash
 * @param {Date|string|number} newExpiresAt
 * @returns {Promise<boolean>}
 */
async function rotateRefreshHash(sessionId, oldHash, newHash, newExpiresAt) {
  const session = await getSession(sessionId);
  if (!session || session.revokedAt != null) return false;
  if (!session.refreshHash || session.refreshHash.length !== oldHash.length) return false;
  try {
    if (!crypto.timingSafeEqual(Buffer.from(session.refreshHash, 'hex'), Buffer.from(oldHash, 'hex'))) {
      return false;
    }
  } catch {
    return false;
  }
  const ms = typeof newExpiresAt === 'number' ? newExpiresAt : new Date(newExpiresAt).getTime();
  const db = await getDb();
  const result = await db.collection(COLLECTION).updateOne(
    { sessionId, refreshHash: session.refreshHash },
    { $set: { refreshHash: newHash, refreshExpiresAt: ms, lastSeenAt: Date.now() } }
  );
  return result.matchedCount === 1 && result.modifiedCount === 1;
}

/**
 * Revoke one session (set revokedAt = now).
 * @param {string} sessionId
 * @returns {Promise<boolean>}
 */
async function revokeSession(sessionId) {
  const db = await getDb();
  const result = await db.collection(COLLECTION).updateOne(
    { sessionId },
    { $set: { revokedAt: Date.now(), refreshHash: null, refreshExpiresAt: null } }
  );
  return result.matchedCount === 1;
}

/**
 * Revoke all sessions for a user.
 * @param {string} userId
 * @returns {Promise<number>}
 */
async function revokeAllSessions(userId) {
  if (!userId) return 0;
  const db = await getDb();
  const result = await db.collection(COLLECTION).updateMany(
    { userId, revokedAt: null },
    { $set: { revokedAt: Date.now(), refreshHash: null, refreshExpiresAt: null } }
  );
  return result.modifiedCount;
}

/**
 * Get sessionId for a refresh token hash.
 * @param {string} refreshHash
 * @returns {Promise<string|null>}
 */
async function getSessionIdByRefreshHash(refreshHash) {
  if (!refreshHash) return null;
  const db = await getDb();
  const now = Date.now();
  const doc = await db.collection(COLLECTION).findOne(
    {
      refreshHash,
      revokedAt: null,
      $or: [
        { refreshExpiresAt: null },
        { refreshExpiresAt: { $gt: now } },
      ],
    },
    { projection: { sessionId: 1 } }
  );
  return doc ? doc.sessionId : null;
}

/**
 * Get last known IP address for a user (from newest session).
 * @param {string} userId
 * @returns {Promise<string|null>} IP address or null if no sessions found
 */
async function getLastKnownIpForUser(userId) {
  if (!userId || typeof userId !== 'string') return null;
  const db = await getDb();
  const doc = await db.collection(COLLECTION)
    .findOne(
      { userId: userId.trim() },
      { sort: { lastSeenAt: -1 }, projection: { ip: 1 } }
    );
  return normalizeIp(doc?.ip) ?? null;
}

module.exports = {
  createSession,
  getSession,
  listSessions,
  touchSession,
  storeRefreshHash,
  verifyRefreshHash,
  rotateRefreshHash,
  revokeSession,
  revokeAllSessions,
  getSessionIdByRefreshHash,
  getLastKnownIpForUser,
};
