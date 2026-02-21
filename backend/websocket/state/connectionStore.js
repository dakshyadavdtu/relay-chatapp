'use strict';

/**
 * MOVED IN PHASE 4 — OWNERSHIP ONLY
 * Tier-1.3: Sole owner of connection metadata state.
 * Phase 2G: socket -> userId and socket -> sessionId (device session).
 */

const socketToUser = new WeakMap();
const socketToSessionId = new WeakMap();

function setSocketUser(socket, userId) {
  socketToUser.set(socket, userId);
}

function getSocketUser(socket) {
  return socketToUser.get(socket) || null;
}

function setSocketSession(socket, sessionId) {
  socketToSessionId.set(socket, sessionId);
}

function getSocketSession(socket) {
  return socketToSessionId.get(socket) || null;
}

function deleteSocketUser(socket) {
  socketToUser.delete(socket);
  socketToSessionId.delete(socket);
}

module.exports = {
  setSocketUser,
  getSocketUser,
  setSocketSession,
  getSocketSession,
  deleteSocketUser,
};
