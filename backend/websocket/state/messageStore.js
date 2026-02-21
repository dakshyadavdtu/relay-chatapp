'use strict';

/**
 * MOVED IN PHASE 4 — OWNERSHIP ONLY
 * Tier-1: sole owner of message transport cache state.
 * In-memory message state store
 * In production, this would be backed by a database
 * @type {Map<string, {state: string, senderId: string, recipientId: string, timestamp: number, clientMessageId?: string}>}
 */
const messageStore = new Map();

/**
 * Track messages by clientMessageId for idempotency (senderId + clientMessageId -> messageId)
 * @type {Map<string, string>}
 */
const clientMessageIdMap = new Map();

/**
 * Tier-1: Only mutation API. Call from services only. Handlers MUST NOT mutate.
 * Runtime: only services (message.service, replay.service) may call this.
 */
function syncMessage(messageId, data) {
  if (messageId && data) messageStore.set(messageId, data);
}

function getMessage(messageId) {
  return messageStore.get(messageId) || null;
}

function hasMessage(messageId) {
  return messageStore.has(messageId);
}

function clear() {
  messageStore.clear();
  clientMessageIdMap.clear();
}

module.exports = {
  getMessage,
  syncMessage,
  hasMessage,
  clear,
};
