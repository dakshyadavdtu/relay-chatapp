'use strict';

/**
 * Per-user diagnostics aggregator. In-memory only, O(1) updates, never throws.
 * Powers system console and admin diagnostics endpoint.
 * avgLatencyMs: rolling average of WS heartbeat RTT (ping→pong) in ms; null until first sample.
 */

const store = Object.create(null);

/** Max samples for rolling average (per user). */
const MAX_LATENCY_SAMPLES = 100;

function ensureUser(userId) {
  if (!userId || typeof userId !== 'string') return;
  try {
    if (!store[userId]) {
      store[userId] = {
        messageCountWindow: 0,
        reconnectCount: 0,
        deliveryFailures: 0,
        lastActivity: null,
        connectionStartTime: null,
        avgLatencyMs: null,
        latencySampleCount: 0,
      };
    }
  } catch (_) { /* no-op */ }
}

function onMessageSent(userId) {
  if (!userId || typeof userId !== 'string') return;
  try {
    ensureUser(userId);
    const u = store[userId];
    if (u) {
      u.messageCountWindow += 1;
      u.lastActivity = Date.now();
    }
  } catch (_) { /* no-op */ }
}

function onReconnect(userId) {
  if (!userId || typeof userId !== 'string') return;
  try {
    ensureUser(userId);
    const u = store[userId];
    if (u) u.reconnectCount += 1;
  } catch (_) { /* no-op */ }
}

function onDeliveryFail(userId) {
  if (!userId || typeof userId !== 'string') return;
  try {
    ensureUser(userId);
    const u = store[userId];
    if (u) u.deliveryFailures += 1;
  } catch (_) { /* no-op */ }
}

function onActivity(userId) {
  if (!userId || typeof userId !== 'string') return;
  try {
    ensureUser(userId);
    const u = store[userId];
    if (u) u.lastActivity = Date.now();
  } catch (_) { /* no-op */ }
}

function getUserDiagnostics(userId) {
  try {
    if (!userId || typeof userId !== 'string') return null;
    const u = store[userId];
    return u ? { ...u } : null;
  } catch (_) {
    return null;
  }
}

function markConnectionStart(userId) {
  if (!userId || typeof userId !== 'string') return;
  try {
    ensureUser(userId);
    const u = store[userId];
    if (u) u.connectionStartTime = Date.now();
  } catch (_) { /* no-op */ }
}

function markConnectionEnd(userId) {
  if (!userId || typeof userId !== 'string') return;
  try {
    const u = store[userId];
    if (u) u.connectionStartTime = null;
  } catch (_) { /* no-op */ }
}

/**
 * Record one RTT sample (e.g. from WS heartbeat pong). Updates rolling average.
 * @param {string} userId
 * @param {number} rttMs - Round-trip time in milliseconds
 */
function recordLatencySample(userId, rttMs) {
  if (!userId || typeof userId !== 'string') return;
  if (typeof rttMs !== 'number' || rttMs < 0 || !Number.isFinite(rttMs)) return;
  try {
    ensureUser(userId);
    const u = store[userId];
    if (!u) return;
    const n = u.latencySampleCount;
    if (n === 0) {
      u.avgLatencyMs = rttMs;
      u.latencySampleCount = 1;
    } else {
      const cap = Math.min(n + 1, MAX_LATENCY_SAMPLES);
      u.avgLatencyMs = (u.avgLatencyMs * (cap - 1) + rttMs) / cap;
      u.latencySampleCount = cap;
    }
  } catch (_) { /* no-op */ }
}

module.exports = {
  ensureUser,
  onMessageSent,
  onReconnect,
  onDeliveryFail,
  onActivity,
  getUserDiagnostics,
  markConnectionStart,
  markConnectionEnd,
  recordLatencySample,
};
