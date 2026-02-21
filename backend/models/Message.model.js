'use strict';

/**
 * Tier-3: Canonical message schema and validation.
 * Single source of truth for message shape used by persistence, offline queue, and history.
 */

const MessageState = require('./message.state').MessageState;

/**
 * Required fields for a persisted message (DB + delivery)
 */
const REQUIRED_FIELDS = ['messageId', 'senderId', 'recipientId', 'content', 'timestamp', 'state'];

/**
 * Valid message states (must match message.state.js)
 */
const VALID_STATES = Object.values(MessageState);

/**
 * Validate message object for persistence and delivery
 * @param {Object} msg - Message object
 * @returns {{ valid: boolean, error?: string }}
 */
function validateMessage(msg) {
  if (!msg || typeof msg !== 'object') {
    return { valid: false, error: 'Message must be a non-null object' };
  }
  for (const field of REQUIRED_FIELDS) {
    if (msg[field] === undefined || msg[field] === null) {
      return { valid: false, error: `Missing required field: ${field}` };
    }
  }
  if (typeof msg.messageId !== 'string' || msg.messageId.trim() === '') {
    return { valid: false, error: 'messageId must be a non-empty string' };
  }
  if (typeof msg.senderId !== 'string' || msg.senderId.trim() === '') {
    return { valid: false, error: 'senderId must be a non-empty string' };
  }
  if (typeof msg.recipientId !== 'string' || msg.recipientId.trim() === '') {
    return { valid: false, error: 'recipientId must be a non-empty string' };
  }
  if (typeof msg.content !== 'string') {
    return { valid: false, error: 'content must be a string' };
  }
  if (typeof msg.timestamp !== 'number' || Number.isNaN(msg.timestamp) || msg.timestamp < 0) {
    return { valid: false, error: 'timestamp must be a non-negative number' };
  }
  if (typeof msg.state !== 'string' || !VALID_STATES.includes(msg.state)) {
    return { valid: false, error: `state must be one of: ${VALID_STATES.join(', ')}` };
  }
  return { valid: true };
}

/**
 * Normalize message for storage (only include known fields)
 * @param {Object} msg - Raw message
 * @returns {Object} Normalized message for DB/store
 */
function normalizeForStorage(msg) {
  return {
    messageId: String(msg.messageId),
    senderId: String(msg.senderId),
    recipientId: String(msg.recipientId),
    content: String(msg.content),
    timestamp: Number(msg.timestamp),
    state: String(msg.state),
    messageType: msg.messageType != null ? String(msg.messageType) : 'direct',
    roomId: msg.roomId != null ? String(msg.roomId) : undefined,
    roomMessageId: msg.roomMessageId != null ? String(msg.roomMessageId) : undefined,
    contentType: msg.contentType != null ? String(msg.contentType) : 'text',
    clientMessageId: msg.clientMessageId != null ? String(msg.clientMessageId) : undefined,
  };
}

/**
 * Schema for API/history response (safe to send to client)
 * @param {Object} msg - Stored message
 * @returns {Object} Sanitized message for API
 */
function toApiShape(msg) {
  if (!msg) return null;
  return {
    messageId: msg.messageId,
    senderId: msg.senderId,
    recipientId: msg.recipientId,
    content: msg.content,
    timestamp: msg.timestamp,
    state: msg.state,
    messageType: msg.messageType || 'direct',
    roomId: msg.roomId,
    roomMessageId: msg.roomMessageId,
    contentType: msg.contentType || 'text',
    editedAt: msg.editedAt ?? null,
    deleted: msg.deleted === true,
    deletedAt: msg.deletedAt ?? null,
  };
}

module.exports = {
  validateMessage,
  normalizeForStorage,
  toApiShape,
  REQUIRED_FIELDS,
  VALID_STATES,
};
