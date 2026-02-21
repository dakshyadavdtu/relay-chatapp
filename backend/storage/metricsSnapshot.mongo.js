'use strict';

/**
 * Coarse metrics snapshots for history. Collection: metrics_snapshots.
 * One doc per interval (e.g. 60s). Used by GET /api/admin/dashboard/history.
 */

const mongoClient = require('./mongo.client');

const COLLECTION = 'metrics_snapshots';
const TTL_DAYS = 30;
let indexesEnsured = false;

async function getDb() {
  const db = await mongoClient.getDb();
  if (!indexesEnsured) {
    const col = db.collection(COLLECTION);
    await col.createIndex({ createdAt: -1 });
    if (TTL_DAYS > 0) {
      await col.createIndex(
        { expiresAt: 1 },
        { expireAfterSeconds: 0 }
      );
    }
    indexesEnsured = true;
  }
  return db;
}

/**
 * Insert one snapshot. Non-throwing.
 * @param {Object} snap - { createdAt, onlineUsers, latencyAvgMs, latencyP95Ms, latencyMaxMs, messagesPerSecond, suspiciousFlags, persistedTotal, deliveredTotal }
 */
async function insertSnapshot(snap) {
  try {
    const now = snap.createdAt != null ? Number(snap.createdAt) : Date.now();
    const expiresAt = TTL_DAYS > 0 ? new Date(now + TTL_DAYS * 86400 * 1000) : null;
    const doc = {
      createdAt: now,
      onlineUsers: typeof snap.onlineUsers === 'number' ? snap.onlineUsers : 0,
      latencyAvgMs: typeof snap.latencyAvgMs === 'number' ? snap.latencyAvgMs : 0,
      latencyP95Ms: typeof snap.latencyP95Ms === 'number' ? snap.latencyP95Ms : 0,
      latencyMaxMs: typeof snap.latencyMaxMs === 'number' ? snap.latencyMaxMs : 0,
      messagesPerSecond: typeof snap.messagesPerSecond === 'number' ? snap.messagesPerSecond : 0,
      suspiciousFlags: typeof snap.suspiciousFlags === 'number' ? snap.suspiciousFlags : 0,
      persistedTotal: typeof snap.persistedTotal === 'number' ? snap.persistedTotal : 0,
      deliveredTotal: typeof snap.deliveredTotal === 'number' ? snap.deliveredTotal : 0,
      expiresAt,
    };
    const db = await getDb();
    await db.collection(COLLECTION).insertOne(doc);
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('metricsSnapshot.mongo insertSnapshot error', err.message);
    }
  }
}

/**
 * Find snapshots in time range for history charts.
 * @param {Object} opts - { minutes? (default 60) }
 * @returns {Promise<Array<{ createdAt, onlineUsers, latencyAvgMs, ... }>>} ascending by createdAt
 */
async function findSnapshotsSince(opts) {
  try {
    const minutes = Math.min(Math.max(parseInt(opts && opts.minutes, 10) || 60, 1), 10080); // max 7 days
    const sinceMs = Date.now() - minutes * 60 * 1000;
    const db = await getDb();
    const docs = await db.collection(COLLECTION)
      .find({ createdAt: { $gte: sinceMs } })
      .sort({ createdAt: 1 })
      .toArray();
    return docs.map((d) => ({
      createdAt: d.createdAt,
      onlineUsers: d.onlineUsers,
      latencyAvgMs: d.latencyAvgMs,
      latencyP95Ms: d.latencyP95Ms,
      latencyMaxMs: d.latencyMaxMs,
      messagesPerSecond: d.messagesPerSecond,
      suspiciousFlags: d.suspiciousFlags,
      persistedTotal: d.persistedTotal,
      deliveredTotal: d.deliveredTotal,
    }));
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('metricsSnapshot.mongo findSnapshotsSince error', err.message);
    }
    return [];
  }
}

module.exports = {
  insertSnapshot,
  findSnapshotsSince,
};
