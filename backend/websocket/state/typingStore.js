'use strict';

/**
 * MOVED IN PHASE 4 — OWNERSHIP ONLY
 * Tier-1.3: Sole owner of typing rate limit buckets.
 * Encapsulates buckets Map.
 * Only this module may mutate the store.
 */

const buckets = new Map();

/**
 * Get bucket entries for a key
 * @param {string} keyStr - Bucket key
 * @returns {Array<number>|null} Entries or null
 */
function getBucket(keyStr) {
  return buckets.get(keyStr) || null;
}

/**
 * Set bucket entries for a key
 * @param {string} keyStr - Bucket key
 * @param {Array<number>} entries - Entries array
 */
function setBucket(keyStr, entries) {
  buckets.set(keyStr, entries);
}

/**
 * Delete bucket for a key
 * @param {string} keyStr - Bucket key
 */
function deleteBucket(keyStr) {
  buckets.delete(keyStr);
}

/**
 * Check if bucket exists
 * @param {string} keyStr - Bucket key
 * @returns {boolean} True if exists
 */
function hasBucket(keyStr) {
  return buckets.has(keyStr);
}

/**
 * Clear all buckets
 */
function clear() {
  buckets.clear();
}

module.exports = {
  getBucket,
  setBucket,
  deleteBucket,
  hasBucket,
  clear,
};
