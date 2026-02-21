'use strict';

/**
 * Suspicious behavior detection. Lightweight, in-memory, never throws.
 * Flags abnormal activity but does not enforce penalties.
 */

let adminActivityBuffer;
try {
  adminActivityBuffer = require('../observability/adminActivityBuffer');
} catch (_) {
  adminActivityBuffer = null;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Detection Rules (configurable constants)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const MESSAGE_BURST_THRESHOLD = 25;
const MESSAGE_BURST_WINDOW_MS = 10000;

const RECONNECT_BURST_THRESHOLD = 8;
const RECONNECT_BURST_WINDOW_MS = 120000;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Flag Storage Model
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * @typedef {Object} SuspiciousFlag
 * @property {string} userId
 * @property {string} reason - e.g. "MESSAGE_BURST", "RECONNECT_BURST"
 * @property {number} count - Number of times this flag was detected
 * @property {number} lastDetectedAt - Timestamp of last detection
 */

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// In-Memory Storage
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** userId → timestamp[] (messages within window) */
const messageTimestamps = Object.create(null);

/** userId → timestamp[] (reconnects within window) */
const reconnectTimestamps = Object.create(null);

/** userId → SuspiciousFlag[] */
const flagsStore = Object.create(null);

/** Cooldown per "userId:reason" (ms) — avoid spamming flags when limiter fires every message */
const FLAG_COOLDOWN_MS = 8000;
const lastRecordedByKey = Object.create(null);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Flag retention (in-memory pruning so old flags don’t stick forever)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const DEFAULT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
let FLAG_RETENTION_MS = DEFAULT_RETENTION_MS;
try {
  const envMs = process.env.SUSPICIOUS_FLAG_RETENTION_MS;
  if (envMs != null && envMs !== '') {
    const n = Number(envMs);
    if (Number.isFinite(n) && n > 0) FLAG_RETENTION_MS = n;
  } else {
    const envHours = process.env.SUSPICIOUS_FLAG_RETENTION_HOURS;
    if (envHours != null && envHours !== '') {
      const h = Number(envHours);
      if (Number.isFinite(h) && h > 0) FLAG_RETENTION_MS = h * 60 * 60 * 1000;
    }
  }
} catch (_) {
  FLAG_RETENTION_MS = DEFAULT_RETENTION_MS;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Helper Functions
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function trimTimestamps(arr, windowMs) {
  if (!Array.isArray(arr)) return [];
  const now = Date.now();
  const cutoff = now - windowMs;
  return arr.filter((ts) => ts > cutoff);
}

function ensureArray(obj, key) {
  if (!obj[key] || !Array.isArray(obj[key])) {
    obj[key] = [];
  }
}

function ensureFlagsArray(userId) {
  if (!flagsStore[userId] || !Array.isArray(flagsStore[userId])) {
    flagsStore[userId] = [];
  }
}

/**
 * Prune flags for one user: drop flags older than retention so memory and counts stay bounded.
 * If no flags remain, delete the user’s entry to avoid unbounded keys.
 * @param {string} userId
 * @param {number} now - current timestamp (e.g. Date.now())
 */
function pruneUserFlags(userId, now) {
  try {
    const arr = flagsStore[userId];
    if (!Array.isArray(arr)) return;
    const cutoff = now - FLAG_RETENTION_MS;
    const kept = arr.filter(
      (f) => typeof f.lastDetectedAt === 'number' && f.lastDetectedAt >= cutoff
    );
    if (kept.length === 0) {
      delete flagsStore[userId];
      // Optional: drop timestamp buckets for this user when empty/old to avoid long-lived memory for dead users.
      try {
        const msgArr = messageTimestamps[userId];
        if (Array.isArray(msgArr)) {
          const cutoffMsg = now - MESSAGE_BURST_WINDOW_MS;
          if (msgArr.filter((ts) => ts > cutoffMsg).length === 0) delete messageTimestamps[userId];
        }
        const recArr = reconnectTimestamps[userId];
        if (Array.isArray(recArr)) {
          const cutoffRec = now - RECONNECT_BURST_WINDOW_MS;
          if (recArr.filter((ts) => ts > cutoffRec).length === 0) delete reconnectTimestamps[userId];
        }
      } catch (_) { /* no-op */ }
    } else {
      flagsStore[userId] = kept;
    }
  } catch (_) { /* no-op */ }
}

/**
 * Prune flags for all users. Call before counting so dashboard metrics reflect retained flags only.
 * @param {number} now - current timestamp (e.g. Date.now())
 */
function pruneAllFlags(now) {
  try {
    for (const userId of Object.keys(flagsStore)) {
      pruneUserFlags(userId, now);
    }
  } catch (_) { /* no-op */ }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Public API
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Record a message event. Must not throw.
 * @param {string} userId
 */
function recordMessage(userId) {
  try {
    if (!userId || typeof userId !== 'string') return;
    const now = Date.now();
    pruneUserFlags(userId, now);
    ensureArray(messageTimestamps, userId);
    messageTimestamps[userId].push(Date.now());
    messageTimestamps[userId] = trimTimestamps(messageTimestamps[userId], MESSAGE_BURST_WINDOW_MS);
    evaluateUser(userId);
  } catch (_) { /* no-op */ }
}

/**
 * Record a reconnect event. Must not throw.
 * @param {string} userId
 */
function recordReconnect(userId) {
  try {
    if (!userId || typeof userId !== 'string') return;
    const now = Date.now();
    pruneUserFlags(userId, now);
    ensureArray(reconnectTimestamps, userId);
    reconnectTimestamps[userId].push(Date.now());
    reconnectTimestamps[userId] = trimTimestamps(reconnectTimestamps[userId], RECONNECT_BURST_WINDOW_MS);
    evaluateUser(userId);
  } catch (_) { /* no-op */ }
}

/**
 * Evaluate user for suspicious patterns. Must not throw.
 * @param {string} userId
 */
function evaluateUser(userId) {
  try {
    if (!userId || typeof userId !== 'string') return;
    const now = Date.now();
    pruneUserFlags(userId, now);
    ensureFlagsArray(userId);
    const flags = flagsStore[userId];

    // Check message burst
    const msgTimestamps = messageTimestamps[userId] || [];
    if (msgTimestamps.length > MESSAGE_BURST_THRESHOLD) {
      let flag = flags.find((f) => f.reason === 'MESSAGE_BURST');
      if (flag) {
        flag.count += 1;
        flag.lastDetectedAt = now;
      } else {
        flags.push({
          userId,
          reason: 'MESSAGE_BURST',
          count: 1,
          lastDetectedAt: now,
        });
        try {
          if (adminActivityBuffer && adminActivityBuffer.recordEvent) {
            adminActivityBuffer.recordEvent({
              type: 'flag',
              title: 'User flagged',
              detail: `userId: ${userId} (MESSAGE_BURST)`,
              severity: 'warning',
            });
          }
        } catch (_) { /* no-op */ }
      }
    }

    // Check reconnect burst
    const reconnectTs = reconnectTimestamps[userId] || [];
    if (reconnectTs.length > RECONNECT_BURST_THRESHOLD) {
      let flag = flags.find((f) => f.reason === 'RECONNECT_BURST');
      if (flag) {
        flag.count += 1;
        flag.lastDetectedAt = now;
      } else {
        flags.push({
          userId,
          reason: 'RECONNECT_BURST',
          count: 1,
          lastDetectedAt: now,
        });
        try {
          if (adminActivityBuffer && adminActivityBuffer.recordEvent) {
            adminActivityBuffer.recordEvent({
              type: 'flag',
              title: 'User flagged',
              detail: `userId: ${userId} (RECONNECT_BURST)`,
              severity: 'warning',
            });
          }
        } catch (_) { /* no-op */ }
      }
    }
  } catch (_) { /* no-op */ }
}

/**
 * Record a generic flag (e.g. WS_RATE_LIMIT, WS_CLOSED_ABUSIVE). Must not throw.
 * Dedupes by reason (increment count); cooldown per user+reason to avoid spamming.
 * @param {string} userId
 * @param {string} reason - e.g. 'WS_RATE_LIMIT', 'WS_RATE_LIMIT_CLOSE', 'WS_CLOSED_ABUSIVE', 'WS_INVALID_PAYLOAD'
 * @param {Object} [meta] - optional { lastDetail?, violations?, windowMs?, limit?, closeCode?, ... }
 */
function recordFlag(userId, reason, meta) {
  try {
    if (!userId || typeof userId !== 'string') return;
    if (!reason || typeof reason !== 'string') return;

    const now = Date.now();
    pruneUserFlags(userId, now);
    const cooldownKey = `${userId}:${reason}`;
    const lastRecorded = lastRecordedByKey[cooldownKey];
    if (typeof lastRecorded === 'number' && now - lastRecorded < FLAG_COOLDOWN_MS) {
      return; // within cooldown — do not record again
    }

    ensureFlagsArray(userId);
    const flags = flagsStore[userId];
    const existing = flags.find((f) => f.reason === reason);

    const metaDetail = meta && typeof meta.lastDetail === 'string' ? meta.lastDetail : '';
    const detailStr = metaDetail ? ` ${metaDetail}` : '';

    if (existing) {
      existing.count += 1;
      existing.lastDetectedAt = now;
      if (metaDetail && existing.lastDetail !== metaDetail) {
        existing.lastDetail = metaDetail;
      }
    } else {
      flags.push({
        userId,
        reason,
        count: 1,
        lastDetectedAt: now,
        lastDetail: metaDetail || undefined,
      });
    }

    lastRecordedByKey[cooldownKey] = now;

    try {
      if (adminActivityBuffer && adminActivityBuffer.recordEvent) {
        adminActivityBuffer.recordEvent({
          type: 'flag',
          title: 'User flagged',
          detail: `userId: ${userId} reason: ${reason}${detailStr}`,
          severity: 'warning',
        });
      }
    } catch (_) { /* no-op */ }
  } catch (_) { /* no-op */ }
}

/**
 * Get flags for a user. Must not throw.
 * @param {string} userId
 * @returns {SuspiciousFlag[]}
 */
function getUserFlags(userId) {
  try {
    if (!userId || typeof userId !== 'string') return [];
    pruneUserFlags(userId, Date.now());
    return [...(flagsStore[userId] || [])];
  } catch (_) {
    return [];
  }
}

/**
 * Get total count of suspicious flags across all users. Must not throw.
 * Used by admin dashboard.
 * @returns {number}
 */
function getTotalFlagsCount() {
  try {
    pruneAllFlags(Date.now());
    let count = 0;
    for (const userId of Object.keys(flagsStore)) {
      const arr = flagsStore[userId];
      if (Array.isArray(arr)) count += arr.length;
    }
    return count;
  } catch (_) {
    return 0;
  }
}

module.exports = {
  recordMessage,
  recordReconnect,
  recordFlag,
  evaluateUser,
  getUserFlags,
  getTotalFlagsCount,
};
