'use strict';

/**
 * Tier-0: Authoritative Message Lifecycle Service
 *
 * Single source of truth for:
 * - DB-first persistence (dbAdapter.persistMessage)
 * - Message state transitions (RECEIVED/SENDING → SENT → DELIVERED)
 * - MESSAGE_ACK payload production
 *
 * Transport-agnostic. Reusable by handlers and replay logic.
 * Does NOT import: WebSocket, ws, socket, handlers.
 */

const dbAdapter = require('../config/db');
const { MAX_CONTENT_LENGTH } = require('../config/constants');
const { toRoomChatId, toDirectChatId } = require('../utils/chatId');
const readCursorStore = require('../chat/readCursorStore.mongo');
const { MessageState, isValidTransition } = require('../models/message.state');
const { logStateTransition, transition, TRANSITION_EVENT, logger } = require('../utils/logger');

// Room delivery state: service owns all delivery state updates so handlers never mutate (Tier-0.3)
const roomDeliveryService = require('../websocket/services/roomDelivery.service');

// Per-recipient delivery persistence (PERSISTED → SENT → DELIVERED → READ)
const deliveryService = require('./delivery.service');
const metrics = require('../observability/metrics');
const userDiagnostics = require('../diagnostics/userDiagnosticsAggregator');
const suspiciousDetector = require('../suspicious/suspicious.detector');

// -----------------------------------------------------------------------------
// In-memory maps for deduplication (clientMessageId idempotency)
// -----------------------------------------------------------------------------

/** senderId:clientMessageId -> messageId */
const clientMessageIdMap = new Map();

/** messageId -> message domain object */
const messageStore = new Map();

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function generateMessageId() {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `msg_${timestamp}_${random}`;
}

/**
 * @param {unknown} message
 * @returns {boolean}
 */
function hasValidMessageShape(message) {
  if (!message || typeof message !== 'object') return false;
  if (!isNonEmptyString(message.messageId)) return false;
  if (!isNonEmptyString(message.senderId)) return false;
  if (!isNonEmptyString(message.recipientId)) return false;
  if (message.senderId === message.recipientId) return false;
  return true;
}

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

/**
 * Accept an incoming message: validate, deduplicate, assign messageId, set initial state.
 * Returns a message domain object. Does NOT persist or emit ACK.
 *
 * @param {Object} params
 * @param {string} params.senderId
 * @param {string} params.receiverId
 * @param {string} [params.clientMessageId]
 * @param {string} params.content
 * @returns {{ ok: boolean, duplicate?: boolean, message?: Object, error?: string, code?: string }}
 */
function acceptIncomingMessage({ senderId, receiverId, clientMessageId, content }) {
  if (!isNonEmptyString(senderId)) {
    return { ok: false, error: 'senderId is required', code: 'INVALID_PAYLOAD' };
  }
  if (!isNonEmptyString(receiverId)) {
    return { ok: false, error: 'receiverId is required', code: 'INVALID_PAYLOAD' };
  }
  if (senderId === receiverId) {
    return { ok: false, error: 'senderId and receiverId must differ', code: 'INVALID_PAYLOAD' };
  }
  if (!content || typeof content !== 'string' || content.trim().length === 0) {
    return { ok: false, error: 'content is required and must be non-empty string', code: 'INVALID_PAYLOAD' };
  }
  if (content.length > MAX_CONTENT_LENGTH) {
    return { ok: false, error: `content exceeds maximum length of ${MAX_CONTENT_LENGTH} characters`, code: 'CONTENT_TOO_LONG' };
  }

  // Deduplication: if clientMessageId was already seen, return existing message
  if (clientMessageId && isNonEmptyString(clientMessageId)) {
    const idempotencyKey = `${senderId}:${clientMessageId}`;
    const existingMessageId = clientMessageIdMap.get(idempotencyKey);
    if (existingMessageId) {
      const existingMessage = messageStore.get(existingMessageId);
      if (existingMessage) {
        return { ok: true, duplicate: true, message: { ...existingMessage } };
      }
    }
  }

  const messageId = generateMessageId();
  const timestamp = Date.now();
  const message = {
    messageId,
    senderId,
    recipientId: receiverId,
    content,
    timestamp,
    state: MessageState.SENDING,
    clientMessageId: clientMessageId || undefined,
    messageType: 'direct',
  };

  messageStore.set(messageId, { ...message });
  if (clientMessageId && isNonEmptyString(clientMessageId)) {
    clientMessageIdMap.set(`${senderId}:${clientMessageId}`, messageId);
  }

  return { ok: true, message: { ...message } };
}

/**
 * Persist message to DB, transition state to SENT, return SENT ACK payload.
 * Idempotent: if message already SENT/DELIVERED/READ, skip persist, return ACK.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * DB-FIRST INVARIANT (NON-NEGOTIABLE):
 * This is the ONLY function that performs message DB write for the SENT ACK path.
 * Order MUST be: (1) persist → (2) updateMessageState → (3) markMessageDelivered
 * (if applicable) → (4) construct and return SENT ACK. ACK emission before DB
 * persistence is forbidden. Any future change must preserve this order.
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * @param {Object} message - Message domain object from acceptIncomingMessage
 * @param {Object} context - Context object with correlationId
 * @returns {Promise<{ type: string, messageId: string, clientMessageId?: string, state: string, timestamp: number, duplicate?: boolean }>}
 */
async function persistAndReturnAck(message, context = {}) {
  const correlationId = context.correlationId || null;
  if (!hasValidMessageShape(message)) {
    throw new Error('Invalid message shape for persistence');
  }

  const { messageId, senderId, recipientId, content, timestamp, clientMessageId } = message;
  const stored = messageStore.get(messageId);

  // Idempotent: already persisted (state SENT or beyond) — return SENT ACK without re-persisting
  if (stored && (stored.state === MessageState.SENT || stored.state === MessageState.DELIVERED || stored.state === MessageState.READ)) {
    return {
      type: 'MESSAGE_ACK',
      messageId,
      clientMessageId,
      state: MessageState.SENT,
      timestamp: stored.timestamp || timestamp,
      duplicate: true,
    };
  }

  // (1) Persist to DB — ONLY place for direct-message write on SENT path
  await dbAdapter.persistMessage({
    messageId,
    senderId,
    recipientId,
    content,
    timestamp,
    state: MessageState.SENT,
    messageType: 'direct',
    clientMessageId,
    chatId: toDirectChatId(senderId, recipientId),
  });

  // Per-recipient delivery record (atomic with message persistence). Initial state PERSISTED.
  deliveryService.createDelivery(messageId, recipientId);

  // (2) Update message state in DB
  await dbAdapter.updateMessageState(messageId, MessageState.SENT);

  if (stored) {
    stored.state = MessageState.SENT;
  } else {
    messageStore.set(messageId, { ...message, state: MessageState.SENT });
  }

  // (3) Mark delivery in DB if applicable (e.g. self-message)
  if (recipientId === senderId) {
    await dbAdapter.markMessageDelivered(messageId, senderId);
  }

  logStateTransition({ messageId, userId: senderId, fromState: 'RECEIVED', toState: 'SENT', reason: 'persisted' });
  transition({
    event: TRANSITION_EVENT.MESSAGE_CREATED,
    messageId,
    connectionId: null,
    userId: senderId,
    correlationId,
    fromState: null,
    toState: 'CREATED',
  });
  transition({
    event: TRANSITION_EVENT.MESSAGE_SENT,
    messageId,
    connectionId: null,
    userId: senderId,
    correlationId,
    fromState: 'CREATED',
    toState: 'SENT',
  });

  try {
    metrics.increment('messages_persisted_total');
  } catch (_) { /* no-op */ }
  try { require('../observability/aggregators/messages').trackPersistedMessageTimestamp('persistDmMessage'); } catch (_) { /* no-op */ }
  try { userDiagnostics.onMessageSent(senderId); userDiagnostics.onActivity(senderId); } catch (_) { /* no-op */ }
  try { suspiciousDetector.recordMessage(senderId); } catch (_) { /* no-op */ }
  // (4) Construct and return canonical SENT ACK — only after DB is confirmed
  return {
    type: 'MESSAGE_ACK',
    messageId,
    clientMessageId,
    state: MessageState.SENT,
    timestamp,
  };
}

/**
 * Persist a room message for a single recipient. Used by room handler.
 * message.service is the ONLY place that calls dbAdapter.persistMessage.
 *
 * @param {Object} params - { messageId, senderId, recipientId, content, timestamp, roomId, roomMessageId, messageType }
 * @returns {Promise<void>}
 */
async function persistRoomMessageForRecipient(params) {
  const { messageId, senderId, recipientId, content, timestamp, roomId, roomMessageId, messageType, clientMessageId } = params;
  if (!messageId || !senderId || !recipientId || !content || timestamp == null) {
    throw new Error('persistRoomMessageForRecipient: missing required fields');
  }
  // Unique index (chatId, senderId, clientMessageId): use messageId when clientMessageId is missing so each recipient row is unique
  const effectiveClientMessageId = clientMessageId && String(clientMessageId).trim() ? clientMessageId : messageId;
  await dbAdapter.persistMessage({
    messageId,
    senderId,
    recipientId,
    content,
    timestamp,
    state: MessageState.SENT,
    messageType: messageType || 'room',
    roomId,
    roomMessageId,
    chatId: toRoomChatId(roomId),
    clientMessageId: effectiveClientMessageId,
  });
  // Per-recipient delivery record (atomic with message persistence). Initial state PERSISTED.
  deliveryService.createDelivery(messageId, recipientId);
  try {
    metrics.increment('messages_persisted_total');
    if (process.env.DEBUG_ADMIN_MPS === '1') {
      logger.info('MessageService', 'messages_persisted_total_increment', { messageId, senderId, recipientId, roomId });
    }
  } catch (_) { /* no-op */ }
  // Do NOT track here: one room message is counted once in persistRoomMessageCanonical.
  try { userDiagnostics.onMessageSent(senderId); userDiagnostics.onActivity(senderId); } catch (_) { /* no-op */ }
  try { suspiciousDetector.recordMessage(senderId); } catch (_) { /* no-op */ }
}

/**
 * Persist a single canonical room message row for history (chatId=room:roomId).
 * One row per room message so GET /api/chat?chatId=room:<id> returns messages.
 *
 * @param {Object} params - { roomId, roomMessageId, senderId, content, timestamp, clientMessageId? }
 * @returns {Promise<void>}
 */
async function persistRoomMessageCanonical(params) {
  const { roomId, roomMessageId, senderId, content, timestamp, clientMessageId } = params;
  if (!roomId || !roomMessageId || !senderId || content == null || timestamp == null) {
    throw new Error('persistRoomMessageCanonical: missing required fields');
  }
  const chatId = toRoomChatId(roomId);
  // Unique index (chatId, senderId, clientMessageId): use roomMessageId when clientMessageId is missing to avoid duplicate key
  const effectiveClientMessageId = clientMessageId && String(clientMessageId).trim() ? clientMessageId : roomMessageId;
  await dbAdapter.persistMessage({
    messageId: roomMessageId,
    senderId,
    recipientId: roomId,
    content,
    timestamp,
    state: MessageState.SENT,
    messageType: 'room',
    roomId,
    roomMessageId,
    chatId,
    clientMessageId: effectiveClientMessageId,
  });
  try {
    metrics.increment('messages_persisted_total');
    if (process.env.DEBUG_ADMIN_MPS === '1') {
      logger.info('MessageService', 'messages_persisted_total_increment', { roomMessageId, senderId, roomId });
    }
  } catch (_) { /* no-op */ }
  try { require('../observability/aggregators/messages').trackPersistedMessageTimestamp('persistRoomMessageCanonical'); } catch (_) { /* no-op */ }
  try { userDiagnostics.onMessageSent(senderId); userDiagnostics.onActivity(senderId); } catch (_) { /* no-op */ }
  try { suspiciousDetector.recordMessage(senderId); } catch (_) { /* no-op */ }
}

/**
 * Construct ROOM_MESSAGE_ACK payload. ONLY place that constructs ACK payloads.
 * @param {Object} p - { success, roomMessageId, clientMessageId, roomId, recipientCount, deliveredCount, timestamp, duplicate?, messageCount? }
 * @returns {Object} ROOM_MESSAGE_ACK payload
 */
function constructRoomMessageAck(p) {
  const payload = {
    type: 'ROOM_MESSAGE_ACK',
    success: p.success,
    roomMessageId: p.roomMessageId,
    roomId: p.roomId,
    recipientCount: p.recipientCount,
    deliveredCount: p.deliveredCount,
    timestamp: p.timestamp,
  };
  if (p.clientMessageId != null) payload.clientMessageId = p.clientMessageId;
  if (p.duplicate) payload.duplicate = true;
  if (p.messageCount != null) payload.messageCount = p.messageCount;
  return payload;
}

/**
 * Internal: mark message as delivered (state only, no ACK). Used by replay path.
 * @param {string} messageId
 * @param {string} userId
 * @returns {Promise<void>}
 */
async function _markDeliveredStateOnly(messageId, userId) {
  if (!messageId || !userId) return;

  const alreadyDelivered = await dbAdapter.isMessageDelivered(messageId, userId);
  if (alreadyDelivered) return;

  await dbAdapter.updateMessageState(messageId, MessageState.DELIVERED);
  await dbAdapter.markMessageDelivered(messageId, userId);

  const stored = messageStore.get(messageId);
  if (stored && isValidTransition(stored.state, MessageState.DELIVERED)) {
    stored.state = MessageState.DELIVERED;
  }
}

/**
 * Confirm delivery and return DELIVERED ACK payloads.
 * DB-first: message must exist in DB before any ACK. Performs state transition.
 *
 * @param {string} messageId
 * @param {string} userId - Recipient userId (must match message.recipientId)
 * @param {Object} context - Context object with correlationId
 * @returns {Promise<{ ok: boolean, recipientResponse?: Object, senderNotification?: Object, error?: string, code?: string }>}
 */
async function confirmDeliveredAndReturnAck(messageId, userId, context = {}) {
  const correlationId = context.correlationId || null;
  if (!messageId || !userId) {
    return { ok: false, error: 'messageId and userId required', code: 'INVALID_PAYLOAD' };
  }

  const dbMessage = await dbAdapter.getMessage(messageId);
  if (!dbMessage) {
    return { ok: false, error: 'Message not found', code: 'MESSAGE_NOT_FOUND', messageId };
  }

  if (dbMessage.recipientId !== userId) {
    return { ok: false, error: 'Not authorized to confirm delivery of this message', code: 'NOT_AUTHORIZED', messageId };
  }

  const currentState = dbMessage.state;
  if (currentState === MessageState.DELIVERED || currentState === MessageState.READ) {
    const ts = Date.now();
    const recipientResponse = { type: 'MESSAGE_ACK', messageId, state: currentState, alreadyInState: true };
    const senderNotification = {
      type: 'MESSAGE_ACK',
      messageId,
      state: MessageState.DELIVERED,
      timestamp: ts,
      roomId: dbMessage.roomId,
      roomMessageId: dbMessage.roomMessageId,
      duplicate: true,
    };
    const senderStateUpdate = { type: 'MESSAGE_STATE_UPDATE', messageId, state: MessageState.DELIVERED, timestamp: ts, roomId: dbMessage.roomId, roomMessageId: dbMessage.roomMessageId };
    const clientAckResponse = { type: 'ACK_RESPONSE', messageId, state: currentState, success: true, alreadyInState: true };
    return { ok: true, recipientResponse, senderNotification, senderStateUpdate, clientAckResponse };
  }

  if (!isValidTransition(currentState, MessageState.DELIVERED)) {
    return {
      ok: false,
      error: `Invalid state transition from ${currentState} to ${MessageState.DELIVERED}`,
      code: 'INVALID_TRANSITION',
      messageId,
      currentState,
    };
  }

  await dbAdapter.updateMessageState(messageId, MessageState.DELIVERED);
  await dbAdapter.markMessageDelivered(messageId, userId);
  deliveryService.transitionState(messageId, userId, deliveryService.DeliveryState.DELIVERED);
  logStateTransition({ messageId, userId, fromState: currentState, toState: 'DELIVERED', reason: 'confirmDelivered' });
  transition({
    event: TRANSITION_EVENT.MESSAGE_DELIVERED,
    messageId,
    connectionId: null,
    userId,
    correlationId,
    fromState: currentState,
    toState: 'DELIVERED',
  });

  const stored = messageStore.get(messageId);
  if (stored && isValidTransition(stored.state, MessageState.DELIVERED)) {
    stored.state = MessageState.DELIVERED;
  }

  if (dbMessage.roomId || dbMessage.messageType === 'room') {
    roomDeliveryService.recordDelivered(messageId);
  }

  const ts = Date.now();
  const recipientResponse = { type: 'MESSAGE_ACK', messageId, state: MessageState.DELIVERED, success: true };
  const senderNotification = {
    type: 'MESSAGE_ACK',
    messageId,
    state: MessageState.DELIVERED,
    timestamp: ts,
    roomId: dbMessage.roomId,
    roomMessageId: dbMessage.roomMessageId,
  };
  const senderStateUpdate = { type: 'MESSAGE_STATE_UPDATE', messageId, state: MessageState.DELIVERED, timestamp: ts, roomId: dbMessage.roomId, roomMessageId: dbMessage.roomMessageId };
  const clientAckResponse = { type: 'ACK_RESPONSE', messageId, state: MessageState.DELIVERED, success: true, alreadyInState: false };
  return { ok: true, recipientResponse, senderNotification, senderStateUpdate, clientAckResponse };
}

/**
 * Confirm read and return READ ACK payloads.
 * DB-first: message must exist in DB before any ACK. Performs state transition.
 *
 * @param {string} messageId
 * @param {string} userId - Recipient userId (must match message.recipientId)
 * @param {Object} context - Context object with correlationId
 * @returns {Promise<{ ok: boolean, recipientResponse?: Object, senderNotification?: Object, error?: string, code?: string }>}
 */
async function persistReadCursorForDm(readerUserId, dbMessage, messageId) {
  if (!dbMessage || !dbMessage.senderId || !dbMessage.recipientId || dbMessage.roomId || dbMessage.messageType === 'room') {
    return;
  }
  const directChatId = toDirectChatId(dbMessage.senderId, dbMessage.recipientId);
  if (!directChatId) return;
  const messageTs = dbMessage.timestamp ?? dbMessage.createdAt ?? Date.now();
  try {
    const cursor = await readCursorStore.getCursor(readerUserId, directChatId);
    if (cursor && cursor.lastReadAt != null && cursor.lastReadAt >= messageTs) return;
    if (cursor && cursor.lastReadMessageId === messageId) return;
    await readCursorStore.upsertCursor(readerUserId, directChatId, messageId, messageTs);
    if (typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production' && process.env?.NODE_ENV !== 'test') {
      console.debug('[readCursor] upserted', { userId: readerUserId, chatId: directChatId, messageId, ts: messageTs });
    }
  } catch (err) {
    if (typeof process !== 'undefined' && process.env?.NODE_ENV !== 'test') {
      console.warn('[message.service] persistReadCursorForDm failed (best-effort):', err?.message || err);
    }
  }
}

async function confirmReadAndReturnAck(messageId, userId, context = {}) {
  const correlationId = context.correlationId || null;
  if (!messageId || !userId) {
    return { ok: false, error: 'messageId and userId required', code: 'INVALID_PAYLOAD' };
  }

  const dbMessage = await dbAdapter.getMessage(messageId);
  if (!dbMessage) {
    return { ok: false, error: 'Message not found', code: 'MESSAGE_NOT_FOUND', messageId };
  }

  if (dbMessage.roomId || dbMessage.messageType === 'room') {
    return { ok: false, error: 'Read receipts for room messages are not supported', code: 'ROOM_READ_NOT_SUPPORTED', messageId };
  }

  if (dbMessage.recipientId !== userId) {
    return { ok: false, error: 'Not authorized to mark this message as read', code: 'NOT_AUTHORIZED', messageId };
  }

  const currentState = dbMessage.state;
  if (currentState === MessageState.READ) {
    await persistReadCursorForDm(userId, dbMessage, messageId);
    const ts = Date.now();
    const recipientResponse = { type: 'MESSAGE_ACK', messageId, state: MessageState.READ, alreadyInState: true };
    const senderNotification = {
      type: 'MESSAGE_READ',
      messageId,
      state: MessageState.READ,
      timestamp: ts,
      roomId: dbMessage.roomId,
      roomMessageId: dbMessage.roomMessageId,
      duplicate: true,
    };
    const senderStateUpdate = { type: 'MESSAGE_STATE_UPDATE', messageId, state: MessageState.READ, timestamp: ts, roomId: dbMessage.roomId, roomMessageId: dbMessage.roomMessageId };
    const clientAckResponse = { type: 'ACK_RESPONSE', messageId, state: MessageState.READ, success: true, alreadyInState: true };
    return { ok: true, recipientResponse, senderNotification, senderStateUpdate, clientAckResponse };
  }

  if (!isValidTransition(currentState, MessageState.READ)) {
    return {
      ok: false,
      error: `Invalid state transition from ${currentState} to ${MessageState.READ}`,
      code: 'INVALID_TRANSITION',
      messageId,
      currentState,
    };
  }

  await dbAdapter.updateMessageState(messageId, MessageState.READ);
  await dbAdapter.markMessageDelivered(messageId, userId);
  const transitionResult = deliveryService.transitionState(messageId, userId, deliveryService.DeliveryState.READ);
  if (!transitionResult.ok) {
    deliveryService.forceMarkAsRead(messageId, userId);
  }
  logStateTransition({ messageId, userId, fromState: currentState, toState: 'READ', reason: 'confirmRead' });
  transition({
    event: TRANSITION_EVENT.MESSAGE_DELIVERED,
    messageId,
    connectionId: null,
    userId,
    correlationId,
    fromState: currentState,
    toState: 'READ',
  });

  const stored = messageStore.get(messageId);
  if (stored && isValidTransition(stored.state, MessageState.READ)) {
    stored.state = MessageState.READ;
  }

  if (dbMessage.roomId || dbMessage.messageType === 'room') {
    roomDeliveryService.recordRead(messageId);
  }

  await persistReadCursorForDm(userId, dbMessage, messageId);

  const ts = Date.now();
  const recipientResponse = { type: 'MESSAGE_ACK', messageId, state: MessageState.READ, success: true };
  const senderNotification = {
    type: 'MESSAGE_READ',
    messageId,
    state: MessageState.READ,
    timestamp: ts,
    roomId: dbMessage.roomId,
    roomMessageId: dbMessage.roomMessageId,
  };
  const senderStateUpdate = { type: 'MESSAGE_STATE_UPDATE', messageId, state: MessageState.READ, timestamp: ts, roomId: dbMessage.roomId, roomMessageId: dbMessage.roomMessageId };
  const clientAckResponse = { type: 'ACK_RESPONSE', messageId, state: MessageState.READ, success: true, alreadyInState: false };
  return { ok: true, recipientResponse, senderNotification, senderStateUpdate, clientAckResponse };
}

// -----------------------------------------------------------------------------
// Exports (for handlers and replay logic)
// -----------------------------------------------------------------------------
// Handlers MUST call markDelivered / markRead (not DB directly). These are the canonical APIs.

/**
 * Rollback persisted messages on partial failure (e.g. room broadcast).
 * Only message.service may perform message DB writes including rollback.
 * @param {string[]} messageIds
 * @returns {Promise<void>}
 */
async function rollbackPersistedMessages(messageIds) {
  if (!messageIds || !Array.isArray(messageIds) || messageIds.length === 0) return;
  if (dbAdapter.deleteMessages) await dbAdapter.deleteMessages(messageIds);
}

module.exports = {
  acceptIncomingMessage,
  persistAndReturnAck,
  persistRoomMessageForRecipient,
  persistRoomMessageCanonical,
  constructRoomMessageAck,
  rollbackPersistedMessages,
  markDelivered: confirmDeliveredAndReturnAck,
  markRead: confirmReadAndReturnAck,
  confirmDeliveredAndReturnAck,
  confirmReadAndReturnAck,
  messageStore,
  clientMessageIdMap,
};
