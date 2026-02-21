'use strict';

/**
 * Tier-1.3: Sole owner of per-user rate limiting state.
 * Encapsulates userRateLimitState Map.
 * Only this module may mutate the store.
 */

const userRateLimitState = new Map();

/**
 * Get user rate limit state
 * @param {string} userId - User ID
 * @returns {Object|null} User state or null
 */
function getUserState(userId) {
  return userRateLimitState.get(userId) || null;
}

/**
 * Set user rate limit state
 * @param {string} userId - User ID
 * @param {Object} state - User state object
 */
function setUserState(userId, state) {
  userRateLimitState.set(userId, state);
}

/**
 * Delete user rate limit state
 * @param {string} userId - User ID
 */
function deleteUserState(userId) {
  userRateLimitState.delete(userId);
}

/**
 * Clear all user rate limit state
 */
function clear() {
  userRateLimitState.clear();
}

module.exports = {
  getUserState,
  setUserState,
  deleteUserState,
  clear,
};
