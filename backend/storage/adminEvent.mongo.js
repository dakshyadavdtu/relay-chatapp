'use strict';

/**
 * Admin activity events persistence. Collection: admin_events.
 * Used for activity feed that survives restart. Low volume.
 */

const crypto = require('crypto');
const mongoClient = require('./mongo.client');

const COLLECTION = 'admin_events';
const TTL_DAYS = 7;
let indexesEnsured = false;

async function ensureIndexes(db) {
  if (indexesEnsured) return;
  const col = db.collection(COLLECTION);
  await col.createIndex({ createdAt: -1 });
  await col.createIndex({ type: 1 });
  await col.createIndex({ userId: 1 });
  if (TTL_DAYS > 0) {
    await col.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  }
  indexesEnsured = true;
}

async function getDb() {
  const db = await mongoClient.getDb();
  await ensureIndexes(db);
  return db;
}

async function insertEvent(event) {
  try {
    const id = crypto.randomUUID();
    const now = Date.now();
    const expiresAt = TTL_DAYS > 0 ? new Date(now + TTL_DAYS * 86400 * 1000) : null;
    const doc = {
      id,
      type: event.type || 'info',
      title: event.title || event.type || '',
      detail: event.detail || '',
      severity: event.severity || 'info',
      userId: event.userId ?? null,
      sessionId: event.sessionId ?? null,
      createdAt: now,
      expiresAt,
    };
    const db = await getDb();
    await db.collection(COLLECTION).insertOne(doc);
    return true;
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('adminEvent.mongo insertEvent error', err.message);
    }
    return false;
  }
}

async function findEvents(opts) {
  try {
    const limit = Math.min(Math.max(parseInt(opts && opts.limit, 10) || 100, 1), 500);
    const filter = {};
    // Support types (array) for dashboard allowlist; else single type string
    if (opts && Array.isArray(opts.types) && opts.types.length > 0) {
      const allowed = opts.types.filter((t) => typeof t === 'string' && t.trim()).map((t) => t.trim());
      if (allowed.length > 0) filter.type = { $in: allowed };
    } else if (opts && opts.type && typeof opts.type === 'string' && opts.type.trim()) {
      filter.type = opts.type.trim();
    }
    if (opts && opts.since) {
      const sinceMs = typeof opts.since === 'number' ? opts.since : new Date(opts.since).getTime();
      if (Number.isFinite(sinceMs)) filter.createdAt = { $gte: sinceMs };
    }
    const db = await getDb();
    const docs = await db.collection(COLLECTION)
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();
    const events = docs.map((d) => ({
      id: d.id,
      type: d.type,
      title: d.title,
      detail: d.detail,
      severity: d.severity,
      userId: d.userId ?? null,
      sessionId: d.sessionId ?? null,
      createdAt: d.createdAt,
    }));
    return { events, ok: true };
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('adminEvent.mongo findEvents error', err.message);
    }
    return { events: [], ok: false };
  }
}

module.exports = {
  insertEvent,
  findEvents,
};
