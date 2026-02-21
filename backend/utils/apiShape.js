'use strict';

/**
 * API shape normalization for frontend contract.
 * Converts internal message/user shapes to stable API format.
 */

/**
 * Convert internal message to API message shape.
 * Aligns with frontend normalizeMessage: id, messageId, roomMessageId, roomId, senderId, content, createdAt, state, messageType.
 * @param {Object} msg - Internal message (messageId, timestamp, roomMessageId, etc.)
 * @returns {Object|null} API message shape
 */
function toApiMessage(msg) {
  if (!msg) return null;
  const id = msg.roomMessageId || msg.messageId || msg.id;
  return {
    id,
    messageId: msg.messageId,
    roomMessageId: msg.roomMessageId,
    roomId: msg.roomId,
    senderId: msg.senderId,
    recipientId: msg.recipientId,
    content: msg.content,
    createdAt: msg.timestamp || msg.createdAt,
    timestamp: msg.timestamp ?? msg.createdAt,
    state: msg.state,
    messageType: msg.messageType || (msg.roomId ? 'text' : 'direct'),
    editedAt: msg.editedAt ?? null,
    deleted: msg.deleted === true,
    deletedAt: msg.deletedAt ?? null,
  };
}

/**
 * Canonical API user shape for /api/me and /api/users.
 * Single source of truth: id, username, email, displayName, avatarUrl, role.
 * displayName fallback = username; avatarUrl fallback = null; email present ("" if not set).
 *
 * @param {Object} user - Internal user (userId, id, username, email?, displayName?, avatarUrl?, role?)
 * @returns {Object|null} API user shape
 */
function toApiUser(user) {
  if (!user) return null;
  const id = user.userId || user.id;
  if (!id) return null;
  const username = user.username != null ? String(user.username) : '';
  const role = user.role || 'USER';
  const displayName =
    user.displayName != null && String(user.displayName).trim() !== ''
      ? String(user.displayName).trim()
      : username;
  const email = user.email != null ? String(user.email).trim() : '';
  const avatarUrl = user.avatarUrl != null && String(user.avatarUrl).trim() !== '' ? String(user.avatarUrl).trim() : null;
  return {
    id,
    username,
    email,
    displayName,
    avatarUrl,
    role,
  };
}

module.exports = {
  toApiMessage,
  toApiUser,
};
