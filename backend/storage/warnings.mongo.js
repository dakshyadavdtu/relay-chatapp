'use strict';

/**
 * Warnings storage layer — MongoDB. Same public API as warnings.store.js (async).
 * Collection: warnings. Record: id, userId, adminId, reason?, createdAt, reportId?.
 * When reportId is set, at most one warning per (userId, reportId) is allowed.
 */

const crypto = require('crypto');
const mongoClient = require('./mongo.client');

const COLLECTION = 'warnings';
const MAX_REASON_LEN = 500;
const MAX_REPORT_ID_LEN = 256;
let indexesEnsured = false;

async function getDb() {
  const db = await mongoClient.getDb();
  if (!indexesEnsured) {
    const col = db.collection(COLLECTION);
    await col.createIndex({ id: 1 }, { unique: true });
    await col.createIndex({ userId: 1 });
    await col.createIndex({ userId: 1, createdAt: -1 });
    await col.createIndex({ userId: 1, reportId: 1 }, { unique: true, sparse: true });
    indexesEnsured = true;
  }
  return db;
}

function docToRecord(doc) {
  if (!doc) return null;
  const { _id, ...rest } = doc;
  return { ...rest };
}

function generateId() {
  return `wrn_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

/**
 * Returns true if a warning already exists for this user and report (one warning per report per user).
 */
async function existsByUserAndReport(userId, reportId) {
  if (!userId || typeof userId !== 'string' || !reportId || typeof reportId !== 'string') return false;
  const db = await getDb();
  const n = await db.collection(COLLECTION).countDocuments({
    userId: userId.trim(),
    reportId: reportId.trim(),
  });
  return n > 0;
}

async function createWarning(payload) {
  const userId = (payload.userId || '').trim();
  const adminId = (payload.adminId || '').trim();
  if (!userId || !adminId) {
    const err = new Error('userId and adminId are required');
    err.code = 'INVALID_PAYLOAD';
    throw err;
  }
  const reason = payload.reason != null ? String(payload.reason).trim() : undefined;
  if (reason !== undefined && reason.length > MAX_REASON_LEN) {
    const err = new Error(`reason must be at most ${MAX_REASON_LEN} characters`);
    err.code = 'PAYLOAD_TOO_LARGE';
    throw err;
  }
  const reportId = payload.reportId != null ? String(payload.reportId).trim() : undefined;
  if (reportId !== undefined && reportId !== '') {
    if (reportId.length > MAX_REPORT_ID_LEN) {
      const err = new Error(`reportId must be at most ${MAX_REPORT_ID_LEN} characters`);
      err.code = 'PAYLOAD_TOO_LARGE';
      throw err;
    }
    const exists = await existsByUserAndReport(userId, reportId);
    if (exists) {
      const err = new Error('A warning was already created for this user from this report');
      err.code = 'WARNING_ALREADY_CREATED_FOR_REPORT';
      throw err;
    }
  }
  const id = generateId();
  const createdAt = Date.now();
  const record = { id, userId, adminId, reason, createdAt };
  if (reportId !== undefined && reportId !== '') {
    record.reportId = reportId;
  }
  const db = await getDb();
  await db.collection(COLLECTION).insertOne(record);
  return { ...record };
}

async function listByUser(userId, limit = 50) {
  if (!userId || typeof userId !== 'string') return [];
  const capped = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 100);
  const db = await getDb();
  const docs = await db.collection(COLLECTION).find({ userId: userId.trim() }).sort({ createdAt: -1 }).limit(capped).toArray();
  return docs.map(docToRecord);
}

async function countByUser(userId) {
  if (!userId || typeof userId !== 'string') return 0;
  const db = await getDb();
  return db.collection(COLLECTION).countDocuments({ userId: userId.trim() });
}

async function clear() {
  const db = await getDb();
  await db.collection(COLLECTION).deleteMany({});
}

module.exports = {
  createWarning,
  listByUser,
  countByUser,
  existsByUserAndReport,
  clear,
};
