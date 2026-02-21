'use strict';

/**
 * Tier-1: Router is the SINGLE choke point.
 * EVERY incoming message passes through socketSafety BEFORE any handler.
 */

const socketSafety = require('./safety/socketSafety');
const { validatePayload } = require('./protocol/wsSchemas');
const config = require('../config/constants');
const logger = require('../utils/logger');
const suspiciousDetector = require('../suspicious/suspicious.detector');
const metrics = require('../observability/metrics');
const { TRANSITION_EVENT } = require('../utils/logger');
const ErrorCodes = require('../utils/errorCodes');
const helloHandler = require('./protocol/helloHandler');
const sendMessage = require('./handlers/sendMessage');
const deliveredAck = require('./handlers/deliveredAck');
const readAck = require('./handlers/readAck');
const messageMutation = require('./handlers/messageMutation');
const reconnect = require('./handlers/reconnect');
const presence = require('./handlers/presence');
const room = require('./handlers/room');
const ping = require('./handlers/ping');
const typing = require('./handlers/typing');
const unknownType = require('./handlers/unknownType');
const typingRateLimit = require('./safety/typingRateLimit');
const { CloseCodes } = require('./protocol/closeCodes');

// MOVED IN PHASE 2 — NO LOGIC CHANGE: Message types from protocol/types.js
const MessageType = require('./protocol/types');

/**
 * Tier-1: Single safety gate. NO handler runs without passing this.
 * @param {WebSocket} ws
 * @param {string|Buffer} data - Raw message data
 * @param {Function} sendResponse - sendResponse(ws, response)
 * @param {Object} context - Context object with correlationId
 * @returns {Promise<{ policy: string, response?: Object }>}
 */
function getConnectionId(ws) {
  if (!ws || !ws._socket) return null;
  const addr = ws._socket.remoteAddress;
  const port = ws._socket.remotePort;
  return addr && port ? `${addr}:${port}` : null;
}

async function handleIncoming(ws, data, sendResponse, context = {}) {
  const connectionManager = require('./connection/connectionManager');
  const userId = connectionManager.getUserId(ws) ?? null;
  const connectionId = getConnectionId(ws);
  const correlationId = context.correlationId || null;

  const result = socketSafety.checkMessage(ws, data, context);

  if (result.policy === socketSafety.SAFETY_POLICY.DROP) {
    logger.transition({
      event: TRANSITION_EVENT.MESSAGE_DROPPED,
      messageId: null,
      connectionId,
      userId,
      correlationId,
      fromState: null,
      toState: 'DROPPED',
      reason: result.reason,
    });
    return { policy: 'DROP' };
  }

  if (result.policy === socketSafety.SAFETY_POLICY.FAIL) {
    logger.transition({
      event: TRANSITION_EVENT.SAFETY_CHECKED,
      messageId: null,
      connectionId,
      userId,
      correlationId,
      fromState: null,
      toState: 'FAIL',
      reason: result.reason,
    });
    const isRateLimitFail = result.meta?.code === ErrorCodes.RATE_LIMIT_EXCEEDED;
    const resetAt = result.meta?.resetAt;
    const retryAfterMs = resetAt != null ? Math.max(0, Math.round(resetAt - Date.now())) : config.RATE_LIMIT.windowMs;
    const errorResponse = {
      type: 'ERROR',
      error: result.reason,
      code: result.meta?.code || ErrorCodes.RATE_LIMIT_EXCEEDED,
      ...(isRateLimitFail && { message: 'Slow down', retryAfterMs }),
      resetAt: result.meta?.resetAt,
      remaining: result.meta?.remaining,
      version: config.PROTOCOL_VERSION,
    };

    if (result.meta?.shouldClose) {
      const isRateLimit = result.meta?.code === ErrorCodes.RATE_LIMIT_EXCEEDED;
      const closeCode = isRateLimit ? CloseCodes.RATE_LIMIT : CloseCodes.POLICY_VIOLATION;
      const closeReason = isRateLimit ? 'RATE_LIMIT' : result.reason;
      logger.warn('Router', 'rate_limit_close', {
        userId,
        connectionId,
        reason: result.reason,
        code: result.meta?.code || ErrorCodes.RATE_LIMIT_EXCEEDED,
        closeCode,
      });
      if (isRateLimit) {
        // PHASE 4: Send ERROR first so client can show "slow down"; then close after flush.
        sendResponse(ws, errorResponse);
        setTimeout(() => {
          socketSafety.closeAbusiveConnection(ws, closeReason, closeCode);
        }, 100);
        return { policy: 'FAIL' };
      }
      socketSafety.closeAbusiveConnection(ws, closeReason, closeCode);
    }
    return {
      policy: 'FAIL',
      response: errorResponse,
    };
  }

  const message = result.parsedMessage;
  const { type, ...payload } = message;

  // Schema validation: reject malformed payloads with MESSAGE_ERROR (no crash)
  const payloadValidation = validatePayload(message);
  if (!payloadValidation.ok) {
    if (userId) {
      try {
        suspiciousDetector.recordFlag(userId, 'WS_INVALID_PAYLOAD', {
          messageType: type || 'unknown',
          error: payloadValidation.error || 'Invalid payload',
          lastDetail: (payloadValidation.details || payloadValidation.error || '').slice(0, 200),
        });
      } catch (_) { /* no-op */ }
    }
    logger.transition({
      event: TRANSITION_EVENT.SAFETY_CHECKED,
      messageId: null,
      connectionId,
      userId,
      correlationId,
      fromState: null,
      toState: 'FAIL',
      reason: 'invalid_payload',
      messageType: type,
    });
    return {
      policy: 'FAIL',
      response: {
        type: 'MESSAGE_ERROR',
        error: payloadValidation.error || 'Invalid payload',
        code: ErrorCodes.INVALID_PAYLOAD,
        details: payloadValidation.details,
      },
    };
  }

  if (result.warning) {
    sendResponse(ws, {
      type: 'RATE_LIMIT_WARNING',
      warning: 'Approaching rate limit',
      remaining: result.remaining,
      resetAt: result.resetAt,
      version: config.PROTOCOL_VERSION,
    });
  }

  logger.transition({
    event: TRANSITION_EVENT.MESSAGE_RECEIVED,
    messageId: null,
    connectionId,
    userId,
    correlationId,
    fromState: null,
    toState: 'RECEIVED',
    messageType: type,
  });
  logger.transition({
    event: TRANSITION_EVENT.SAFETY_CHECKED,
    messageId: null,
    connectionId,
    userId,
    correlationId,
    fromState: null,
    toState: 'ALLOW',
    messageType: type,
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Tier-1.1: Router-level rate limiting middleware
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // This middleware runs BEFORE any handler is called.
  // It enforces:
  //   1) Generic per-user rate limiting (all message types)
  //   2) Typing event rate limiting (more strict for TYPING_START/STOP)
  // If ANY limiter denies, handler is NOT called and error response is sent.
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  
  // Skip rate limiting for HELLO (must be first message, no userId yet)
  if (type !== MessageType.HELLO && userId) {
    // 1) Generic per-user rate limiting
    const genericLimit = socketSafety.rateLimit.allow(userId, type);
    if (!genericLimit.allowed) {
      try { metrics.increment('rate_limit_hits_total'); } catch (_) { /* no-op */ }
      logger.transition({
        event: TRANSITION_EVENT.MESSAGE_DROPPED,
        messageId: null,
        connectionId,
        userId,
        correlationId,
        fromState: 'RECEIVED',
        toState: 'RATE_LIMITED',
        messageType: type,
        reason: 'generic_rate_limit_exceeded',
      });
      return {
        policy: 'FAIL',
        response: {
          type: 'error',
          code: 'RATE_LIMITED',
          message: 'Too many requests',
          resetAt: genericLimit.resetAt,
          remaining: genericLimit.remaining || 0,
          version: config.PROTOCOL_VERSION,
        },
      };
    }

    // 2) Typing event rate limiting (more strict)
    if (type === MessageType.TYPING_START || type === MessageType.TYPING_STOP) {
      const roomId = payload.roomId || null;
      if (!typingRateLimit.check(userId, roomId)) {
        try { metrics.increment('rate_limit_hits_total'); } catch (_) { /* no-op */ }
        logger.transition({
          event: TRANSITION_EVENT.MESSAGE_DROPPED,
          messageId: null,
          connectionId,
          userId,
          correlationId,
          fromState: 'RECEIVED',
          toState: 'RATE_LIMITED',
          messageType: type,
          reason: 'typing_rate_limit_exceeded',
        });
        return {
          policy: 'FAIL',
          response: {
            type: 'error',
            code: 'RATE_LIMITED',
            message: 'Too many requests',
            version: config.PROTOCOL_VERSION,
          },
        };
      }
    }
  }

  if (!helloHandler.handlePreSwitch(ws, type, sendResponse)) {
    return { policy: 'ALLOW', response: null };
  }

  logger.info('router', 'dispatch', {
    correlationId,
    userId,
    connectionId,
    messageType: type,
  });

  try {
    let response = route(ws, type, payload, sendResponse, { correlationId });
    if (response instanceof Promise) {
      response = await response;
    }
    return { policy: 'ALLOW', response };
  } catch (err) {
    logger.error('Router', 'handler_error', { correlationId, type, error: err.message, userId, connectionId });
    logger.transition({
      event: TRANSITION_EVENT.MESSAGE_FAILED,
      messageId: null,
      connectionId,
      userId,
      correlationId,
      fromState: 'RECEIVED',
      toState: 'FAILED',
      reason: 'handler_error',
    });
    return {
      policy: 'FAIL',
      response: { type: 'ERROR', error: 'Internal server error', code: 'INTERNAL_ERROR', version: config.PROTOCOL_VERSION },
    };
  }
}

/**
 * Route incoming message to appropriate handler
 * Supports both sync and async handlers
 * @param {WebSocket} ws - Client WebSocket
 * @param {string} type - Message type
 * @param {Object} payload - Parsed message payload
 * @param {Function} sendResponse - sendResponse(ws, response)
 * @param {Object} context - Context object with correlationId
 * @returns {Promise<Object|null>|Object|null} Response to send back, or null if no response needed
 */
function route(ws, type, payload, sendResponse, context = {}) {
  switch (type) {
    case MessageType.HELLO:
      return helloHandler.handleHello(ws, payload, sendResponse, context);

    case MessageType.MESSAGE_SEND:
      return sendMessage.handleMessageSend(ws, payload, context);

    case MessageType.MESSAGE_READ:
      return readAck.handleMessageRead(ws, payload, context);

    case MessageType.MESSAGE_READ_CONFIRM:
      return readAck.handleMessageReadConfirm(ws, payload, context);

    case MessageType.MESSAGE_DELIVERED_CONFIRM:
      return deliveredAck.handleMessageDeliveredConfirm(ws, payload, context);

    case MessageType.MESSAGE_EDIT:
      return messageMutation.handleMessageEdit(ws, payload, context);

    case MessageType.MESSAGE_DELETE:
      return messageMutation.handleMessageDelete(ws, payload, context);

    case MessageType.MESSAGE_REPLAY:
      return reconnect.handleMessageReplay(ws, payload, context);

    case MessageType.STATE_SYNC:
      return reconnect.handleStateSync(ws, payload, context);

    case MessageType.RESUME:
      return reconnect.handleResume(ws, payload, sendResponse, context);

    case MessageType.PRESENCE_PING:
      return presence.handlePresencePing(ws, payload, context);

    case MessageType.CLIENT_ACK:
      return readAck.handleClientAck(ws, payload, context);

    case MessageType.PING:
      return ping.handlePing(context);

    case MessageType.TYPING_START:
      return typing.handleTypingStart(ws, payload, context);

    case MessageType.TYPING_STOP:
      return typing.handleTypingStop(ws, payload, context);

    // Room messaging
    case MessageType.ROOM_CREATE:
      return room.handleRoomCreate(ws, payload, context);

    case MessageType.ROOM_JOIN:
      return room.handleRoomJoin(ws, payload, context);

    case MessageType.ROOM_LEAVE:
      return room.handleRoomLeave(ws, payload, context);

    case MessageType.ROOM_MESSAGE:
      return room.handleRoomMessage(ws, payload, context);

    case MessageType.ROOM_INFO:
      return room.handleRoomInfo(ws, payload, context);

    case MessageType.ROOM_LIST:
      return room.handleRoomList(ws, payload, context);

    case MessageType.ROOM_MEMBERS:
      return room.handleRoomMembers(ws, payload, context);

    case MessageType.ROOM_UPDATE_META:
      return room.handleRoomUpdateMeta(ws, payload, context);

    case MessageType.ROOM_ADD_MEMBERS:
      return room.handleRoomAddMembers(ws, payload, context);

    case MessageType.ROOM_REMOVE_MEMBER:
      return room.handleRoomRemoveMember(ws, payload, context);

    case MessageType.ROOM_SET_ROLE:
      return room.handleRoomSetRole(ws, payload, context);

    case MessageType.ROOM_DELETE:
      return room.handleRoomDelete(ws, payload, context);

    default:
      return unknownType.handleUnknownType(type, context);
  }
}

// MOVED IN PHASE 2 — NO LOGIC CHANGE: MessageType re-exported from protocol/types.js
module.exports = {
  handleIncoming,
  route,
  MessageType, // Re-exported from protocol/types.js
};
