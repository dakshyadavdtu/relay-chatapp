'use strict';

/**
 * Reports storage — MongoDB. Same public API as reports.store.js (async).
 * Collection: reports.
 */

const crypto = require('crypto');
const mongoClient = require('./mongo.client');

const COLLECTION = 'reports';
const MAX_REPORTS_DEFAULT = 200;
const MAX_REASON_LEN = 500;
const MAX_DETAILS_LEN = 2000;
const MAX_ID_LEN = 256;
/** Valid priority values (lowercase); derived from category only. */
const PRIORITY_VALUES = Object.freeze(['low', 'normal', 'high']);
const PRIORITY_DEFAULT = 'normal';

/** Predefined categories; priority is derived from category only (single source of truth). */
const REPORT_CATEGORIES = Object.freeze(['Spam', 'Harassment', 'Hate speech', 'Sexual content', 'Illegal']);
/** Category -> priority (hardcoded). Admin cannot change priority. */
const CATEGORY_TO_PRIORITY = Object.freeze({
  'Spam': 'low',
  'Harassment': 'normal',
  'Hate speech': 'high',
  'Sexual content': 'high',
  'Illegal': 'high',
});

let indexesEnsured = false;

/** Derive priority from category. Unknown/missing category -> normal. */
function categoryToPriority(category) {
  if (category != null && typeof category === 'string' && CATEGORY_TO_PRIORITY[category] != null) {
    return CATEGORY_TO_PRIORITY[category];
  }
  return PRIORITY_DEFAULT;
}

async function getDb() {
  const db = await mongoClient.getDb();
  if (!indexesEnsured) {
    const col = db.collection(COLLECTION);
    await col.createIndex({ id: 1 }, { unique: true });
    await col.createIndex({ createdAt: -1 });
    await col.createIndex({ status: 1 });
    indexesEnsured = true;
  }
  return db;
}

/** Normalize priority from stored value; missing or invalid -> PRIORITY_DEFAULT. */
function normalizePriority(val) {
  if (val != null && typeof val === 'string') {
    const v = val.toLowerCase().trim();
    if (PRIORITY_VALUES.includes(v)) return v;
  }
  return PRIORITY_DEFAULT;
}

/** Derive priority from reason text for legacy reports that have no category. */
function priorityFromReason(reason) {
  if (reason == null || typeof reason !== 'string') return null;
  const r = reason.toLowerCase();
  if (r.includes('spam')) return 'low';
  if (r.includes('harassment')) return 'normal';
  if (r.includes('hate') || r.includes('sexual') || r.includes('illegal')) return 'high';
  return null;
}

function docToRecord(doc) {
  if (!doc) return null;
  const { _id, ...rest } = doc;
  const out = { ...rest };
  if (rest.category != null && REPORT_CATEGORIES.includes(rest.category)) {
    out.priority = categoryToPriority(rest.category);
  } else {
    const fromReason = priorityFromReason(rest.reason);
    out.priority = fromReason != null ? fromReason : normalizePriority(rest.priority);
  }
  return out;
}

function trimId(v) {
  if (v == null) return undefined;
  const s = String(v).trim();
  return s.length > 0 ? s : undefined;
}

function generateId() {
  return 'rpt_' + crypto.randomUUID().replace(/-/g, '').slice(0, 12);
}

function formatDate(ts) {
  if (!ts || typeof ts !== 'number') return new Date().toISOString().slice(0, 16).replace('T', ' ');
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return y + '-' + m + '-' + day + ' ' + h + ':' + min;
}

async function getReportById(reportId) {
  if (!reportId || typeof reportId !== 'string') return null;
  const db = await getDb();
  const doc = await db.collection(COLLECTION).findOne({ id: reportId.trim() });
  return doc ? docToRecord(doc) : null;
}

async function listReports(opts) {
  opts = opts || {};
  const limit = Math.min(Math.max(parseInt(opts.limit, 10) || MAX_REPORTS_DEFAULT, 1), MAX_REPORTS_DEFAULT);
  const statusFilter = opts.status;
  const priorityFilter = opts.priority;
  const sortByPriority = opts.sortByPriority === 'highFirst';
  const db = await getDb();
  const filter = statusFilter === 'open' ? { status: 'open' } : statusFilter === 'resolved' ? { status: 'resolved' } : {};
  const fetchLimit = sortByPriority ? Math.min(limit * 3, MAX_REPORTS_DEFAULT) : limit;
  const docs = await db.collection(COLLECTION).find(filter).sort({ createdAt: -1 }).limit(fetchLimit).toArray();
  let records = docs.map(docToRecord);
  if (priorityFilter && PRIORITY_VALUES.includes(priorityFilter)) {
    records = records.filter((r) => r.priority === priorityFilter);
  }
  if (sortByPriority) {
    const priorityOrder = { high: 0, normal: 1, low: 2 };
    records.sort((a, b) => {
      const pa = priorityOrder[a.priority] ?? 1;
      const pb = priorityOrder[b.priority] ?? 1;
      if (pa !== pb) return pa - pb;
      return (b.createdAt ?? 0) - (a.createdAt ?? 0);
    });
  }
  return records.slice(0, limit);
}

async function createReport(payload) {
  const reporterUserId = (payload.reporterUserId || '').trim();
  if (!reporterUserId) {
    const err = new Error('reporterUserId is required');
    err.code = 'INVALID_PAYLOAD';
    throw err;
  }
  const reason = (payload.reason || '').trim();
  if (!reason) {
    const err = new Error('reason is required');
    err.code = 'INVALID_PAYLOAD';
    throw err;
  }
  if (reason.length > MAX_REASON_LEN) {
    const err = new Error('reason must be at most ' + MAX_REASON_LEN + ' characters');
    err.code = 'PAYLOAD_TOO_LARGE';
    throw err;
  }
  const details = payload.details != null ? String(payload.details).trim() : undefined;
  if (details !== undefined && details.length > MAX_DETAILS_LEN) {
    const err = new Error('details must be at most ' + MAX_DETAILS_LEN + ' characters');
    err.code = 'PAYLOAD_TOO_LARGE';
    throw err;
  }

  const targetUserIdRaw = trimId(payload.targetUserId);
  const messageId = trimId(payload.messageId);
  const conversationId = trimId(payload.conversationId);
  const senderId = trimId(payload.senderId);

  let type;
  let targetUserId;
  let hasMessageContext;

  if (messageId) {
    if (!conversationId || typeof conversationId !== 'string' || conversationId.length > MAX_ID_LEN) {
      const err = new Error('conversationId is required for message reports and must be a non-empty string');
      err.code = 'INVALID_PAYLOAD';
      throw err;
    }
    if (!senderId || typeof senderId !== 'string' || senderId.length > MAX_ID_LEN) {
      const err = new Error('senderId is required for message reports and must be a non-empty string');
      err.code = 'INVALID_PAYLOAD';
      throw err;
    }
    type = 'message';
    targetUserId = senderId;
    hasMessageContext = true;
  } else {
    if (!targetUserIdRaw || typeof targetUserIdRaw !== 'string' || targetUserIdRaw.length > MAX_ID_LEN) {
      const err = new Error('targetUserId is required for user reports');
      err.code = 'INVALID_PAYLOAD';
      throw err;
    }
    type = 'user';
    targetUserId = targetUserIdRaw;
    hasMessageContext = false;
  }

  const category = (payload.category != null && typeof payload.category === 'string')
    ? payload.category.trim()
    : null;
  if (!category || !REPORT_CATEGORIES.includes(category)) {
    const err = new Error('category is required and must be one of: ' + REPORT_CATEGORIES.join(', '));
    err.code = 'INVALID_PAYLOAD';
    throw err;
  }
  const priority = categoryToPriority(category);
  const id = generateId();
  const createdAt = Date.now();
  const record = {
    id,
    createdAt,
    reporterUserId,
    type,
    targetUserId,
    reason,
    details,
    category,
    priority,
    status: 'open',
    hasMessageContext,
  };
  if (payload.reporterIp != null && typeof payload.reporterIp === 'string' && payload.reporterIp.trim()) {
    record.reporterIp = payload.reporterIp.trim();
  }
  if (typeof payload.reporterAccountCreatedAt === 'number' && payload.reporterAccountCreatedAt > 0) {
    record.reporterAccountCreatedAt = payload.reporterAccountCreatedAt;
  }
  if (messageId) {
    record.messageId = messageId;
    record.conversationId = conversationId;
    record.senderId = senderId;
  }
  const db = await getDb();
  await db.collection(COLLECTION).insertOne(record);
  return Object.assign({}, record);
}

async function resolveReport(reportId, adminId) {
  if (!reportId || typeof reportId !== 'string') return false;
  const db = await getDb();
  const existing = await db.collection(COLLECTION).findOne({ id: reportId });
  if (!existing) return false;
  if (existing.status === 'resolved') return true;
  await db.collection(COLLECTION).updateOne(
    { id: reportId },
    { $set: { status: 'resolved', resolvedAt: Date.now(), adminId: adminId || null } }
  );
  return true;
}

/** Set report priority (admin override). Valid values: low, normal, high. Returns true if updated. */
async function updateReportPriority(reportId, priority) {
  if (!reportId || typeof reportId !== 'string') return false;
  const p = normalizePriority(priority);
  if (!PRIORITY_VALUES.includes(p)) return false;
  const db = await getDb();
  const result = await db.collection(COLLECTION).updateOne(
    { id: reportId.trim() },
    { $set: { priority: p } }
  );
  return result.matchedCount > 0;
}

async function countByTargetUser(userId) {
  if (!userId || typeof userId !== 'string') return 0;
  const db = await getDb();
  return db.collection(COLLECTION).countDocuments({ targetUserId: userId.trim() });
}

async function countRecentByTargetUser(userId, sinceTs) {
  if (!userId || typeof userId !== 'string') return 0;
  if (!sinceTs || typeof sinceTs !== 'number') return 0;
  const db = await getDb();
  return db.collection(COLLECTION).countDocuments({
    targetUserId: userId.trim(),
    createdAt: { $gte: sinceTs },
  });
}

/** Count reports on same target within window ending at asOfTs. For suspicious: >=5 in 2 min. */
async function countReportsOnTargetInWindow(targetUserId, asOfTs, windowMs) {
  if (!targetUserId || typeof targetUserId !== 'string') return 0;
  if (typeof asOfTs !== 'number' || typeof windowMs !== 'number' || windowMs <= 0) return 0;
  const db = await getDb();
  const since = asOfTs - windowMs;
  return db.collection(COLLECTION).countDocuments({
    targetUserId: targetUserId.trim(),
    createdAt: { $gte: since, $lte: asOfTs },
  });
}

/** Count reports from same reporter IP within window ending at asOfTs. For suspicious: >=3 in short window. */
async function countReportsByReporterIpInWindow(reporterIp, asOfTs, windowMs) {
  if (!reporterIp || typeof reporterIp !== 'string') return 0;
  if (typeof asOfTs !== 'number' || typeof windowMs !== 'number' || windowMs <= 0) return 0;
  const db = await getDb();
  const since = asOfTs - windowMs;
  return db.collection(COLLECTION).countDocuments({
    reporterIp: reporterIp.trim(),
    createdAt: { $gte: since, $lte: asOfTs },
  });
}

/** List reports in time window for suspicious checks. Returns minimal fields: reporterUserId, reporterAccountCreatedAt, createdAt. */
async function listReportsInWindow(asOfTs, windowMs, limit) {
  if (typeof asOfTs !== 'number' || typeof windowMs !== 'number' || windowMs <= 0) return [];
  const db = await getDb();
  const since = asOfTs - windowMs;
  const cap = Math.min(limit || 500, 1000);
  const docs = await db.collection(COLLECTION)
    .find({ createdAt: { $gte: since, $lte: asOfTs } })
    .project({ reporterUserId: 1, reporterAccountCreatedAt: 1, createdAt: 1 })
    .sort({ createdAt: -1 })
    .limit(cap)
    .toArray();
  return docs;
}

async function clear() {
  const db = await getDb();
  await db.collection(COLLECTION).deleteMany({});
}

module.exports = {
  getReportById,
  listReports,
  createReport,
  resolveReport,
  updateReportPriority,
  countByTargetUser,
  countRecentByTargetUser,
  countReportsOnTargetInWindow,
  countReportsByReporterIpInWindow,
  listReportsInWindow,
  clear,
  formatDate,
  PRIORITY_VALUES,
  PRIORITY_DEFAULT,
  REPORT_CATEGORIES,
  CATEGORY_TO_PRIORITY,
  categoryToPriority,
  normalizePriority,
};
