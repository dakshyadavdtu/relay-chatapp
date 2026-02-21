'use strict';

/**
 * Session service - sole interface for session state.
 * Handlers must use this instead of sessionStore directly.
 */

const sessionStore = require('../state/sessionStore');

function getSession(userId) {
  return sessionStore.getSession(userId);
}

function updateLastSeen(userId, lastSeenMessageId) {
  sessionStore.updateLastSeen(userId, lastSeenMessageId);
}

module.exports = {
  getSession,
  updateLastSeen,
};
