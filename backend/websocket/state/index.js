'use strict';

/**
 * Tier-1.3: Centralized state module exports.
 * MOVED IN PHASE 4 — OWNERSHIP ONLY: canonical store names.
 * All in-memory stores are owned by modules in this directory.
 *
 * ARCHITECTURE LOCK — PHASE 7
 * All runtime Maps/Sets MUST live in websocket/state/*
 * Enforced by CI (scripts/enforce-state-ownership.js)
 * Any violation MUST fail builds.
 */

module.exports = {
  connectionStore: require('./connectionStore'),
  sessionStore: require('./sessionStore'),
  presenceStore: require('./presenceStore'),
  messageStore: require('./messageStore'),
  deliveryStore: require('./deliveryStore'),
  typingStore: require('./typingStore'),
  roomManager: require('./roomManager'),
  groupStore: require('./groupStore'),
  rateLimitStore: require('./rateLimitStore'),
  socketStateStore: require('./socketStateStore'),
  heartbeatStore: require('./heartbeatStore'),
};
