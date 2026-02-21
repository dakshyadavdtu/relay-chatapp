'use strict';

/**
 * Tier-2: Typing handler. Best-effort UX signals.
 * Rate limiting enforced at router level before this handler runs.
 */

const connectionManager = require('../connection/connectionManager');
const roomManager = require('../state/roomManager');
const socketSafety = require('../safety/socketSafety');

function handleTypingStart(ws, payload, context = {}) {
  const userId = connectionManager.getUserId(ws);
  if (!userId) return null;

  const { roomId, targetUserId } = payload || {};
  if (roomId) {
    const members = roomManager.getRoomMembers(roomId);
    for (const memberId of members) {
      if (memberId === userId) continue;
      const sockets = connectionManager.getSockets(memberId);
      const msg = { type: 'TYPING_START', roomId, userId, timestamp: Date.now() };
      for (const targetWs of sockets) {
        socketSafety.sendMessage(targetWs, msg);
      }
    }
  } else if (targetUserId) {
    const sockets = connectionManager.getSockets(targetUserId);
    const msg = { type: 'TYPING_START', targetUserId, userId, timestamp: Date.now() };
    for (const targetWs of sockets) {
      socketSafety.sendMessage(targetWs, msg);
    }
  }

  return null;
}

function handleTypingStop(ws, payload, context = {}) {
  const userId = connectionManager.getUserId(ws);
  if (!userId) return null;

  const { roomId, targetUserId } = payload || {};
  if (roomId) {
    const members = roomManager.getRoomMembers(roomId);
    for (const memberId of members) {
      if (memberId === userId) continue;
      const sockets = connectionManager.getSockets(memberId);
      const msg = { type: 'TYPING_STOP', roomId, userId, timestamp: Date.now() };
      for (const targetWs of sockets) {
        socketSafety.sendMessage(targetWs, msg);
      }
    }
  } else if (targetUserId) {
    const sockets = connectionManager.getSockets(targetUserId);
    const msg = { type: 'TYPING_STOP', targetUserId, userId, timestamp: Date.now() };
    for (const targetWs of sockets) {
      socketSafety.sendMessage(targetWs, msg);
    }
  }

  return null;
}

module.exports = {
  handleTypingStart,
  handleTypingStop,
};
