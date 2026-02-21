'use strict';

/**
 * Tier-2: Typing event rate limiter. Per (userId, roomId) bucket.
 * Sliding window, O(1) checks, timestamp-based cleanup.
 * Silent drop on limit exceeded. No Redis, no timers per bucket.
 */

const WINDOW_MS = 2000;
const MAX_EVENTS = 4;

// MOVED IN PHASE 4 — OWNERSHIP ONLY: use canonical typingStore
const typingStore = require('../state/typingStore');

function key(userId, roomId) {
  const r = roomId || '';
  return `${userId}\x01${r}`;
}

function prune(keyStr) {
  const entries = typingStore.getBucket(keyStr);
  if (!entries || entries.length === 0) return;
  const now = Date.now();
  const cutoff = now - WINDOW_MS;
  const filtered = entries.filter(t => t > cutoff);
  if (filtered.length === 0) {
    typingStore.deleteBucket(keyStr);
  } else {
    typingStore.setBucket(keyStr, filtered);
  }
}

function check(userId, roomId) {
  if (!userId) return false;
  const keyStr = key(userId, roomId);
  prune(keyStr);
  const entries = typingStore.getBucket(keyStr) || [];
  if (entries.length >= MAX_EVENTS) {
    return false;
  }
  const now = Date.now();
  entries.push(now);
  typingStore.setBucket(keyStr, entries);
  return true;
}

module.exports = { check };
