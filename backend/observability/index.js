'use strict';

/**
 * Public observability API.
 * Read-only observability layer for DevTools.
 * NEVER exposes raw state.
 * NEVER throws - always returns safe snapshot.
 */

const { assembleSnapshot, SAFE_EMPTY_SNAPSHOT } = require('./snapshot');

/**
 * Get observability snapshot
 * @param {Object} capabilities - Caller capabilities (REQUIRED)
 * @returns {Object} Redacted snapshot (always safe, never throws)
 */
function getSnapshot(capabilities) {
  try {
    // FAIL CLOSED: capabilities REQUIRED
    // Missing or malformed → treat as NON-ADMIN
    // NEVER infer role
    // NEVER throw
    // ALWAYS return an object

    if (!capabilities || typeof capabilities !== 'object') {
      // Missing capabilities → non-admin view
      return assembleSnapshot({ devtools: false });
    }

    return assembleSnapshot(capabilities);
  } catch {
    // If anything fails: return SAFE EMPTY SNAPSHOT
    return SAFE_EMPTY_SNAPSHOT;
  }
}

module.exports = {
  getSnapshot,
};
