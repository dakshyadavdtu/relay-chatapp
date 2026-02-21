'use strict';

/**
 * Tier-0.3: THIN handler. No DB access. Validate → call messageService.persistAndReturnAck → emit result.
 * Phase 1: Deterministic contract — sender always receives exactly one of MESSAGE_ACK or MESSAGE_NACK.
 * ACK is sent on persist only; DELIVERY_STATUS is sent separately (best-effort).
 */

const connectionManager = require('../connection/connectionManager');
const ErrorCodes = require('../../utils/errorCodes');
const { MAX_CONTENT_LENGTH } = require('../../config/constants');
const messageService = require('../../services/message.service');
const logger = require('../../utils/logger');
const { transition, TRANSITION_EVENT } = require('../../utils/logger');
const wsMessageService = require('../services/message.service');
const redisBus = require('../../services/redisBus');

/** Map internal error codes to Phase 1 NACK contract codes (stable for client). */
const NACK_CODE_MAP = {
  [ErrorCodes.AUTH_REQUIRED]: ErrorCodes.UNAUTHORIZED,
  [ErrorCodes.UNAUTHORIZED]: ErrorCodes.UNAUTHORIZED,
  [ErrorCodes.INVALID_PAYLOAD]: ErrorCodes.VALIDATION_ERROR,
  [ErrorCodes.CONTENT_TOO_LONG]: ErrorCodes.VALIDATION_ERROR,
  [ErrorCodes.NOT_AUTHORIZED]: ErrorCodes.FORBIDDEN,
  [ErrorCodes.RATE_LIMIT_EXCEEDED]: ErrorCodes.RATE_LIMITED,
  [ErrorCodes.PERSISTENCE_ERROR]: ErrorCodes.INTERNAL_ERROR,
};

function toNack(code, errorMessage, clientMessageId) {
  const serverTs = Date.now();
  const codeOut = NACK_CODE_MAP[code] || ErrorCodes.INTERNAL_ERROR;
  return {
    type: 'MESSAGE_NACK',
    clientMsgId: clientMessageId,
    clientMessageId: clientMessageId,
    code: codeOut,
    message: errorMessage || 'Request failed',
    serverTs,
  };
}

/** Handle MESSAGE_SEND: validate payload, delegate to message.service, return ACK or NACK, then DELIVERY_STATUS. */
async function handleMessageSend(ws, payload, context = {}) {
  const correlationId = context.correlationId || null;
  const senderId = connectionManager.getUserId(ws);
  const connectionId = ws._socket ? `${ws._socket.remoteAddress}:${ws._socket.remotePort}` : null;
  const serverTs = Date.now();

  if (!senderId) {
    return toNack(ErrorCodes.AUTH_REQUIRED, 'Not authenticated', payload?.clientMessageId);
  }

  const { recipientId, content, clientMessageId } = payload || {};
  if (!recipientId) {
    return toNack(ErrorCodes.INVALID_PAYLOAD, 'recipientId is required', clientMessageId);
  }
  if (!content || typeof content !== 'string' || content.trim().length === 0) {
    return toNack(ErrorCodes.INVALID_PAYLOAD, 'content is required and must be non-empty string', clientMessageId);
  }
  if (content.length > MAX_CONTENT_LENGTH) {
    return toNack(ErrorCodes.CONTENT_TOO_LONG, `content exceeds maximum length of ${MAX_CONTENT_LENGTH} characters`, clientMessageId);
  }

  const intake = messageService.acceptIncomingMessage({
    senderId,
    receiverId: recipientId,
    clientMessageId,
    content,
  });
  if (!intake.ok) {
    return toNack(intake.code || ErrorCodes.INVALID_PAYLOAD, intake.error || 'Invalid payload', clientMessageId);
  }

  try {
    const ack = await messageService.persistAndReturnAck(intake.message, { correlationId });

    transition({
      event: TRANSITION_EVENT.MESSAGE_CREATED,
      messageId: intake.message.messageId,
      connectionId,
      userId: senderId,
      correlationId,
      fromState: null,
      toState: 'PERSISTED',
    });

    // Real-time: deliver to recipient if online; then send DELIVERY_STATUS to sender (do not block ACK)
    // Frontend must handle MESSAGE_RECEIVE for realtime DM render.
    const receivePayload = {
      type: 'MESSAGE_RECEIVE',
      messageId: ack.messageId,
      senderId: intake.message.senderId,
      recipientId: intake.message.recipientId,
      content: intake.message.content,
      timestamp: ack.timestamp,
      state: ack.state,
    };
    // Phase 2: Echo MESSAGE_RECEIVE to sender sockets for multi-tab sync (like group messages)
    wsMessageService.sendToUserSocket(senderId, receivePayload, { correlationId, messageId: ack.messageId });
    // Cross-instance: publish to Redis so other instances can deliver to recipient (fire-and-forget)
    try {
      redisBus.publishChatMessage({
        type: 'chat.message',
        originInstanceId: redisBus.getInstanceId(),
        messageId: ack.messageId,
        recipientId: intake.message.recipientId,
        senderId: intake.message.senderId,
        ts: ack.timestamp,
        receivePayload,
      }).catch(() => {});
    } catch (_) {}
    // Deliver to recipient
    wsMessageService.attemptDelivery(ack.messageId, receivePayload, { correlationId })
      .then((delivered) => {
        const status = delivered ? 'DELIVERED' : 'RECIPIENT_OFFLINE';
        wsMessageService.sendToUserSocket(senderId, {
          type: 'DELIVERY_STATUS',
          messageId: ack.messageId,
          recipientId: intake.message.recipientId,
          status,
          ts: Date.now(),
        }, { correlationId, messageId: ack.messageId });
      })
      .catch((err) => {
        logger.error('SendMessage', 'delivery_attempt_error', { correlationId, messageId: ack.messageId, recipientId, error: err.message });
        wsMessageService.sendToUserSocket(senderId, {
          type: 'DELIVERY_STATUS',
          messageId: ack.messageId,
          recipientId: intake.message.recipientId,
          status: 'RECIPIENT_OFFLINE',
          ts: Date.now(),
        }, { correlationId, messageId: ack.messageId });
      });

    return {
      type: 'MESSAGE_ACK',
      clientMsgId: ack.clientMessageId,
      clientMessageId: ack.clientMessageId,
      messageId: ack.messageId,
      status: 'PERSISTED',
      serverTs: ack.timestamp,
      timestamp: ack.timestamp,
      state: ack.state,
      recipientId: intake.message.recipientId,
      message: {
        id: ack.messageId,
        senderId: intake.message.senderId,
        recipientId: intake.message.recipientId,
        content: intake.message.content,
        createdAt: ack.timestamp,
        state: ack.state,
      },
    };
  } catch (dbError) {
    logger.error('SendMessage', 'persist_error', {
      correlationId,
      userId: senderId,
      connectionId,
      clientMessageId,
      error: dbError.message,
    });
    return toNack(ErrorCodes.PERSISTENCE_ERROR, 'Failed to persist message to database', clientMessageId);
  }
}

module.exports = {
  handleMessageSend,
};
