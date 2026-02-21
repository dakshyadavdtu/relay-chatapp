'use strict';

/**
 * WebSocket message service - transport orchestration layer.
 * Delegates lifecycle (persistence, ACKs) to backend/services/message.service.
 * Owns: delivery attempt logic, sendToUserSocket.
 */

const connectionManager = require('../connection/connectionManager');
const sessionStore = require('../state/sessionStore');
const socketSafety = require('../safety/socketSafety');
const logger = require('../../utils/logger');
const { transition, TRANSITION_EVENT } = require('../../utils/logger');
const ErrorCodes = require('../../utils/errorCodes');
// MOVED IN PHASE 4 — OWNERSHIP ONLY: use canonical messageStore
const messageStore = require('../state/messageStore');
const messageService = require('../../services/message.service');
// Lazy require to avoid circular dependency: message.store → replay.service → this file → message.store
function getMessageStoreService() {
  if (!getMessageStoreService._cache) {
    getMessageStoreService._cache = require('../../services/message.store');
  }
  return getMessageStoreService._cache;
}
const deliveryService = require('../../services/delivery.service');

/**
 * Get message from transport cache; if missing, load from DB and sync. Services only.
 */
async function getOrLoadMessage(messageId) {
  let msgData = messageStore.getMessage(messageId);
  if (msgData) return msgData;
  const messageStoreService = getMessageStoreService();
  const dbMessage = await messageStoreService.getById(messageId);
  if (!dbMessage) return null;
  const data = {
    state: dbMessage.state,
    senderId: dbMessage.senderId,
    recipientId: dbMessage.recipientId,
    content: dbMessage.content,
    timestamp: dbMessage.timestamp,
    messageType: dbMessage.messageType,
    roomId: dbMessage.roomId,
    roomMessageId: dbMessage.roomMessageId,
    contentType: dbMessage.contentType,
  };
  messageStore.syncMessage(messageId, data);
  return data;
}

/**
 * Send message to all of user's sockets (all tabs). Used by delivery and broadcast.
 * @param {string} userId - Target user ID
 * @param {Object} message - Message to send
 * @returns {{ sent: boolean, sentCount: number, shouldClose?: boolean }}
 */
function sendToUserSocket(userId, message, context = {}) {
  const sockets = connectionManager.getSockets(userId);
  let sent = false;
  let shouldClose = false;
  for (const ws of sockets) {
    const connectionId = ws._socket ? `${ws._socket.remoteAddress}:${ws._socket.remotePort}` : null;
    const messageContext = {
      ...context,
      userId,
      connectionId,
      messageId: context.messageId || (message && typeof message === 'object' ? message.messageId : null),
    };
    const result = socketSafety.sendMessage(ws, message, messageContext);
    if (result.queued) sent = true;
    if (result.shouldClose) {
      socketSafety.closeAbusiveConnection(ws, 'Slow consumer: queue overflow', 1008);
      shouldClose = true;
    }
  }
  return { sent, sentCount: sockets.length, shouldClose };
}

/**
 * Send to all active sockets for a user (alias for sendToUserSocket; both fan out to all tabs).
 * Use when the intent is explicitly "notify every connection for this user".
 * @param {string} userId - Target user ID
 * @param {Object} message - Message to send
 * @param {Object} [context] - Context (correlationId, messageId, etc.)
 * @returns {{ sent: boolean, sentCount: number, shouldClose?: boolean }}
 */
function sendToAllUserSockets(userId, message, context = {}) {
  return sendToUserSocket(userId, message, context);
}

/**
 * Attempt to deliver message to recipient. Idempotent.
 * @param {string} messageId
 * @param {Object} message - Payload to send (MESSAGE_RECEIVE or ROOM_MESSAGE)
 * @param {Object} context - Context object with correlationId
 * @returns {Promise<boolean>} True if delivered
 */
async function attemptDelivery(messageId, message, context = {}) {
  const correlationId = context?.correlationId || null;
  const msgData = await getOrLoadMessage(messageId);
  if (!msgData) {
    logger.error('MessageService', 'deliver_without_state', { correlationId, messageId });
    deliveryService.recordDeliveryFailure(messageId, undefined, 'DELIVER_WITHOUT_STATE');
    return false;
  }

  let dbMessage;
  try {
    const messageStoreService = getMessageStoreService();
    dbMessage = await messageStoreService.getById(messageId);
  } catch (dbError) {
    deliveryService.recordDeliveryFailure(messageId, msgData.recipientId, 'SEND_ERROR');
    return false;
  }
  if (!dbMessage) {
    deliveryService.recordDeliveryFailure(messageId, msgData.recipientId, 'SEND_ERROR');
    return false;
  }

  let alreadyDelivered = false;
  try {
    const messageStoreService = getMessageStoreService();
    alreadyDelivered = await messageStoreService.isDeliveredTo(messageId, msgData.recipientId);
  } catch {
    alreadyDelivered = false;
  }
  if (alreadyDelivered) {
    logger.debug('MessageService', 'attemptDelivery_early_return', { messageId, recipientId: msgData.recipientId, alreadyDelivered: true });
    return true;
  }

  logger.info('MessageService', 'message_lifecycle', { correlationId, messageId, phase: 'DELIVERY_ATTEMPTED', recipientId: msgData.recipientId });

  const sockets = connectionManager.getSockets(msgData.recipientId);
  if (sockets.length === 0) {
    logger.info('MessageService', 'delivery_attempt_failed_recipient_offline', { correlationId, messageId, recipientId: msgData.recipientId });
    deliveryService.recordDeliveryFailure(messageId, msgData.recipientId, 'RECIPIENT_OFFLINE');
    return false;
  }

  let anyQueued = false;
  let anyQueueFull = false;
  for (const ws of sockets) {
    const connectionId = ws._socket ? `${ws._socket.remoteAddress}:${ws._socket.remotePort}` : null;
    try {
      const result = socketSafety.sendMessage(ws, message, {
        correlationId,
        messageId,
        userId: msgData.recipientId,
        connectionId,
      });
      if (result.queued) anyQueued = true;
      if (result.queueFull) anyQueueFull = true;
      if (result.shouldClose) {
        socketSafety.closeAbusiveConnection(ws, 'Slow consumer: queue overflow', 1008);
      }
    } catch (sendErr) {
      logger.error('MessageService', 'send_error', { correlationId, messageId, recipientId: msgData.recipientId, error: sendErr.message });
    }
  }
  if (anyQueueFull && !anyQueued) {
    deliveryService.recordDeliveryFailure(messageId, msgData.recipientId, 'BACKPRESSURE');
    transition({
      event: TRANSITION_EVENT.MESSAGE_FAILED,
      messageId,
      connectionId: null,
      userId: msgData.senderId,
      correlationId,
      fromState: 'SENT',
      toState: 'FAILED',
      reason: 'backpressure',
    });
    logger.warn('safety', 'failed_backpressure', { correlationId, messageId, userId: msgData.recipientId });
    sendToUserSocket(msgData.senderId, {
      type: 'MESSAGE_ERROR',
      error: 'Delivery failed: recipient buffer full',
      code: ErrorCodes.RECIPIENT_BUFFER_FULL,
      messageId,
    }, { correlationId, messageId });
    return false;
  }
  if (anyQueued) {
    sessionStore.updateLastSent(msgData.recipientId, messageId);
    deliveryService.transitionState(messageId, msgData.recipientId, deliveryService.DeliveryState.SENT);
    logger.info('MessageService', 'delivery_attempt_succeeded', { correlationId, messageId, recipientId: msgData.recipientId, sentCount: sockets.length });
    return true;
  }
  deliveryService.recordDeliveryFailure(messageId, msgData.recipientId, 'SEND_ERROR');
  return false;
}

/**
 * Deliver message to recipient (used by replay path).
 * @param {string} messageId
 * @param {Object} message
 * @param {Object} context - Context object with correlationId
 * @returns {Promise<boolean>}
 */
async function deliverMessage(messageId, message, context = {}) {
  return attemptDelivery(messageId, message, context);
}

/**
 * Get message state from transport cache (for handlers / engine). Services only.
 * @param {string} messageId
 * @returns {Object|null}
 */
function getMessageState(messageId) {
  return messageStore.getMessage(messageId) || null;
}

/**
 * Clear message memory store (for testing). Services only.
 */
function clearMessageMemoryStore() {
  messageStore.clear();
}

module.exports = {
  sendToUserSocket,
  sendToAllUserSockets,
  attemptDelivery,
  deliverMessage,
  getOrLoadMessage,
  getMessageState,
  clearMessageMemoryStore,
  messageService,
};
