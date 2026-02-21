'use strict';

/**
 * Admin activity feed ring buffer.
 * Stores recent events (report, ban, flag, spike, failure, info, connect, disconnect, admin).
 * Also persists to admin_events (Atlas) with 5s dedupe for same (type, userId, sessionId).
 * Used by GET /api/admin/activity and GET /api/admin/dashboard/activity.
 * Bounded: max 50 events in memory.
 */

const VALID_TYPES = ['report', 'ban', 'flag', 'spike', 'failure', 'info', 'connect', 'disconnect', 'admin'];
const DEFAULT_MAX_EVENTS = 50;
const DEFAULT_WINDOW_SECONDS = 3600;
const DEDUPE_MS = 5000;

/** @type {Array<{ type: string, title: string, detail: string, ts: number, severity: string }>} */
const buffer = [];

/** Last persist time by key "type:userId:sessionId" for dedupe. */
const lastPersistByKey = new Map();

function isValidType(type) {
  return typeof type === 'string' && VALID_TYPES.includes(type);
}

function dedupeKey(type, userId, sessionId) {
  const u = userId != null ? String(userId) : '';
  const s = sessionId != null ? String(sessionId) : '';
  return `${type}:${u}:${s}`;
}

function shouldSkipPersist(type, userId, sessionId) {
  const key = dedupeKey(type, userId, sessionId);
  const last = lastPersistByKey.get(key);
  if (last == null) return false;
  return Date.now() - last < DEDUPE_MS;
}

function markPersisted(type, userId, sessionId) {
  lastPersistByKey.set(dedupeKey(type, userId, sessionId), Date.now());
  if (lastPersistByKey.size > 500) {
    const cutoff = Date.now() - DEDUPE_MS * 2;
    for (const [k, t] of lastPersistByKey.entries()) {
      if (t < cutoff) lastPersistByKey.delete(k);
    }
  }
}

/**
 * Record an event. Call only from safe existing places.
 * In-memory ring buffer unchanged; also persists to DB with dedupe (non-blocking).
 * @param {Object} ev - { type, title?, detail?, severity?, userId?, sessionId? }
 */
function recordEvent(ev) {
  try {
    if (!ev || typeof ev !== 'object') return;
    const type = ev.type;
    if (!isValidType(type)) return;

    const ts = Date.now();
    const title = typeof ev.title === 'string' ? ev.title.slice(0, 200) : type;
    const detail = typeof ev.detail === 'string' ? ev.detail.slice(0, 500) : '';
    const severity = typeof ev.severity === 'string' ? ev.severity : 'info';
    const userId = ev.userId != null ? ev.userId : undefined;
    const sessionId = ev.sessionId != null ? ev.sessionId : undefined;

    buffer.push({ type, title, detail, ts, severity });

    const cutoff = ts - DEFAULT_WINDOW_SECONDS * 1000;
    while (buffer.length > 0 && buffer[0].ts < cutoff) {
      buffer.shift();
    }
    while (buffer.length > DEFAULT_MAX_EVENTS) {
      buffer.shift();
    }

    if (!shouldSkipPersist(type, userId, sessionId)) {
      const adminEvent = require('../storage/adminEvent.mongo');
      const payload = { type, title, detail, severity, userId, sessionId };
      adminEvent.insertEvent(payload).then((inserted) => {
        if (inserted) markPersisted(type, userId, sessionId);
      }).catch(() => {});
    }
  } catch (_) {
    /* never throw */
  }
}

/**
 * Get events for activity feed. Never throws; returns safe default on reset/bad state.
 * @param {Object} opts - { windowSeconds?, maxEvents?, typeAllowlist? }
 * @param {string[]} [opts.typeAllowlist] - if set, only events with type in this list are returned (dashboard feed balance)
 * @returns {{ windowSeconds: number, maxEvents: number, events: Array }}
 */
function getEvents(opts) {
  try {
    const rawWs = parseInt(opts && opts.windowSeconds, 10);
    const rawMax = parseInt(opts && opts.maxEvents, 10);
    const windowSeconds = Math.min(Math.max(Number.isFinite(rawWs) ? rawWs : DEFAULT_WINDOW_SECONDS, 60), 86400);
    const maxEvents = Math.min(Math.max(Number.isFinite(rawMax) ? rawMax : DEFAULT_MAX_EVENTS, 1), 100);
    const typeAllowlist = opts && Array.isArray(opts.typeAllowlist) ? opts.typeAllowlist : null;

    if (!Array.isArray(buffer)) {
      return { windowSeconds, maxEvents, events: [] };
    }
    const cutoff = Date.now() - windowSeconds * 1000;
    let filtered = buffer.filter((e) => e && typeof e.ts === 'number' && e.ts >= cutoff);
    if (typeAllowlist && typeAllowlist.length > 0) {
      const set = new Set(typeAllowlist.map((t) => String(t).trim()).filter(Boolean));
      filtered = filtered.filter((e) => set.has(e.type));
    }
    filtered = filtered.slice(-maxEvents);

    return {
      windowSeconds,
      maxEvents,
      events: filtered,
    };
  } catch (_) {
    return {
      windowSeconds: DEFAULT_WINDOW_SECONDS,
      maxEvents: DEFAULT_MAX_EVENTS,
      events: [],
    };
  }
}

module.exports = {
  recordEvent,
  getEvents,
};
