'use strict';

/**
 * Backpressure module — MOVED IN PHASE 5 — NO LOGIC CHANGE
 * Owns: queue full checks, send queue overflow behaviour, slow consumer detection
 * (bufferedAmount / pending sends), sendMessage safety wrappers, canSend/sendOrFail.
 */

const config = require('../../config/constants');
const logger = require('../../utils/logger');
const { transition, TRANSITION_EVENT } = require('../../utils/logger');
const socketStateStore = require('../state/socketStateStore');
const messageStoreService = require('../../services/message.store');
const dbAdapter = require('../../config/db');

/** Tier-1: Single constant for backpressure threshold. No silent buffering. */
const MAX_OUTBOUND_QUEUE_SIZE = config.BACKPRESSURE?.maxQueueSize || 100;

/**
 * Initialize backpressure state for a socket (MOVED IN PHASE 5 — NO LOGIC CHANGE)
 * @param {WebSocket} ws - WebSocket connection
 */
function initBackpressureState(ws) {
  socketStateStore.setBackpressureState(ws, {
    pendingSends: 0,
    queue: [],
    maxQueueSize: MAX_OUTBOUND_QUEUE_SIZE,
    queueOverflows: 0,
    lastBufferedCheck: 0,
    processing: false, // Flag to prevent concurrent queue processing
  });
}

/**
 * Clean up backpressure state for a socket (MOVED IN PHASE 5 — NO LOGIC CHANGE)
 * @param {WebSocket} ws - WebSocket connection
 */
function cleanupBackpressure(ws) {
  socketStateStore.deleteBackpressureState(ws);
}

/**
 * Check backpressure before sending
 * Detects slow consumers via bufferedAmount and pending sends
 * @param {WebSocket} ws - WebSocket connection
 * @returns {{canSend: boolean, pendingCount?: number, queueSize?: number, shouldClose?: boolean}}
 */
function checkBackpressure(ws) {
  const state = socketStateStore.getBackpressureState(ws);
  if (!state) {
    initBackpressureState(ws);
    return checkBackpressure(ws);
  }

  // Check WebSocket bufferedAmount (indicates slow consumer)
  const now = Date.now();
  // Check bufferedAmount at most once per 100ms to avoid overhead
  if (now - state.lastBufferedCheck > 100) {
    state.lastBufferedCheck = now;
    socketStateStore.setBackpressureState(ws, state);
    if (ws.bufferedAmount !== undefined && ws.bufferedAmount > config.BACKPRESSURE.bufferedAmountThreshold) {
      // Socket buffer is growing - slow consumer detected
      return {
        canSend: false,
        pendingCount: state.pendingSends,
        queueSize: state.queue.length,
        reason: 'buffered_amount_exceeded',
      };
    }
  }

  // Check pending sends threshold
  if (state.pendingSends >= config.BACKPRESSURE.threshold) {
    return {
      canSend: false,
      pendingCount: state.pendingSends,
      queueSize: state.queue.length,
      reason: 'pending_sends_exceeded',
    };
  }

  // Check queue size
  // Note: queueOverflows is only incremented in queueMessage() when actually dropping messages
  // This check just prevents sending when queue is full
  if (state.queue.length >= state.maxQueueSize) {
    // Check if socket should be closed due to persistent overflow
    if (state.queueOverflows >= config.BACKPRESSURE.maxQueueOverflows) {
      return {
        canSend: false,
        pendingCount: state.pendingSends,
        queueSize: state.queue.length,
        shouldClose: true,
        reason: 'queue_overflow_persistent',
      };
    }
    return {
      canSend: false,
      pendingCount: state.pendingSends,
      queueSize: state.queue.length,
      reason: 'queue_full',
    };
  }

  // Reset overflow counter on successful check
  if (state.queueOverflows > 0 && state.queue.length < state.maxQueueSize * 0.5) {
    state.queueOverflows = 0;
    socketStateStore.setBackpressureState(ws, state);
  }

  return {
    canSend: true,
    pendingCount: state.pendingSends,
    queueSize: state.queue.length,
  };
}

/**
 * Queue message for sending when backpressure clears.
 * Bounded behavior: when queue is full, do NOT enqueue; fail fast and return queueFull.
 * @param {WebSocket} ws - WebSocket connection
 * @param {Object} message - Message to queue (must have 'payload' property)
 * @returns {{queued: boolean, dropped: number, queueFull?: boolean, shouldClose?: boolean}}
 */
function queueMessage(ws, message) {
  const state = socketStateStore.getBackpressureState(ws);
  if (!state) {
    initBackpressureState(ws);
    return queueMessage(ws, message);
  }

  // Ensure message has payload
  if (!message.payload) {
    return { queued: false, dropped: 0 };
  }

  // Bounded outbound queue: do not enqueue when full; fail fast. Never throw.
  if (state.queue.length >= state.maxQueueSize) {
    state.queueOverflows = (state.queueOverflows || 0) + 1;
    socketStateStore.setBackpressureState(ws, state);
    const overflow = state.queueOverflows >= (config.BACKPRESSURE?.maxQueueOverflows || 5);
    return {
      queued: false,
      dropped: 0,
      queueFull: true,
      ok: false,
      reason: 'BACKPRESSURE',
      bufferedAmount: state.pendingSends,
      threshold: state.maxQueueSize,
      shouldClose: overflow,
    };
  }

  // Add message to queue (preserves ordering - FIFO)
  state.queue.push(message);
  socketStateStore.setBackpressureState(ws, state);

  // Trigger queue processing if not already processing
  processQueue(ws);

  return { queued: true, dropped: 0, ok: true };
}

/**
 * Process the outgoing message queue for a socket
 * Sends queued messages when backpressure allows
 * Maintains strict message ordering (FIFO)
 * @param {WebSocket} ws - WebSocket connection
 */
function processQueue(ws) {
  const state = socketStateStore.getBackpressureState(ws);
  if (!state || state.processing || ws.readyState !== 1) {
    return;
  }

  // Check if we can send
  const backpressureCheck = checkBackpressure(ws);
  if (!backpressureCheck.canSend || state.queue.length === 0) {
    return;
  }

  // Mark as processing to prevent concurrent execution
  state.processing = true;

  // Process queue synchronously to maintain ordering
  const sendNext = () => {
    // Check socket is still open
    if (ws.readyState !== 1) {
      state.processing = false;
      return;
    }

    // Check backpressure again
    const bpCheck = checkBackpressure(ws);
    if (!bpCheck.canSend) {
      state.processing = false;
      return;
    }

    // Get next message from queue (FIFO - preserves ordering)
    if (state.queue.length === 0) {
      state.processing = false;
      socketStateStore.setBackpressureState(ws, state);
      return;
    }

    const message = state.queue.shift();
    socketStateStore.setBackpressureState(ws, state);
    if (!message || !message.payload) {
      // Skip invalid messages, continue processing
      setImmediate(sendNext);
      return;
    }

    // Send message using Tier-1.2 enforcement point
    incrementPendingSend(ws);
    const sendContext = message.context || {};

    // Use sendOrFail for backpressure enforcement
    sendOrFail(ws, message.payload, sendContext).then((result) => {
      decrementPendingSend(ws);

      const currentState = socketStateStore.getBackpressureState(ws);
      if (currentState) {
        if (!result.ok) {
          // On failure, stop processing (backpressure will be detected on next check)
          currentState.processing = false;
          socketStateStore.setBackpressureState(ws, currentState);
        } else {
          // On success, continue processing queue
          setImmediate(sendNext);
        }
      }
    }).catch((err) => {
      decrementPendingSend(ws);
      const correlationId = sendContext?.correlationId || null;
      logger.error('SocketSafety', 'processQueue_sendOrFail_error', { correlationId, error: err.message });
      // On exception, stop processing
      const currentState = socketStateStore.getBackpressureState(ws);
      if (currentState) {
        currentState.processing = false;
        socketStateStore.setBackpressureState(ws, currentState);
      }
    });
  };

  // Start processing
  sendNext();
}

/**
 * Send a message through the queue system.
 * Tier-1: NEVER throws. Returns deterministic { ok: true } or { ok: false, reason: 'BACKPRESSURE', ... }.
 * @param {WebSocket} ws - WebSocket connection
 * @param {string|Object} message - Message payload
 * @param {Object} [context] - Context object with correlationId, messageId, etc.
 * @returns {{ok: boolean, queued?: boolean, dropped?: number, queueFull?: boolean, shouldClose?: boolean, reason?: string, bufferedAmount?: number, threshold?: number}}
 */
function sendMessage(ws, message, context = {}) {
  if (ws.readyState !== 1) {
    return { ok: false, queued: false, dropped: 0, reason: 'BACKPRESSURE', bufferedAmount: 0, threshold: MAX_OUTBOUND_QUEUE_SIZE };
  }

  let payload;
  if (typeof message === 'string') {
    payload = message;
  } else if (message && typeof message === 'object') {
    if (!message.version) message.version = config.PROTOCOL_VERSION;
    payload = JSON.stringify(message);
  } else {
    return { ok: false, queued: false, dropped: 0, reason: 'BACKPRESSURE', bufferedAmount: 0, threshold: MAX_OUTBOUND_QUEUE_SIZE };
  }

  const messageContext = {
    ...context,
    messageId: context.messageId || (message && typeof message === 'object' ? message.messageId : null),
    userId: context.userId || null,
    connectionId: context.connectionId || null,
  };

  const result = queueMessage(ws, { payload, context: messageContext });
  return {
    ok: result.queued,
    queued: result.queued,
    dropped: result.dropped || 0,
    queueFull: result.queueFull,
    shouldClose: result.shouldClose,
    reason: result.queued ? undefined : (result.reason || 'BACKPRESSURE'),
    bufferedAmount: result.bufferedAmount,
    threshold: result.threshold,
  };
}

/**
 * Get current queue size
 * @param {WebSocket} ws - WebSocket connection
 * @returns {number} Queue size
 */
function getQueueSize(ws) {
  const state = socketStateStore.getBackpressureState(ws);
  return state ? state.queue.length : 0;
}

/**
 * Increment pending send counter
 * @param {WebSocket} ws - WebSocket connection
 */
function incrementPendingSend(ws) {
  const state = socketStateStore.getBackpressureState(ws);
  if (state) {
    state.pendingSends++;
    socketStateStore.setBackpressureState(ws, state);
  }
}

/**
 * Decrement pending send counter
 * @param {WebSocket} ws - WebSocket connection
 */
function decrementPendingSend(ws) {
  const state = socketStateStore.getBackpressureState(ws);
  if (state) {
    state.pendingSends = Math.max(0, state.pendingSends - 1);
    socketStateStore.setBackpressureState(ws, state);
  }
}

/**
 * Tier-1.2: Check if socket can send (backpressure check)
 * Pure function - NO side effects, NO logging.
 *
 * Checks ONLY:
 * - ws.readyState === OPEN (1)
 * - ws.bufferedAmount < MAX_BUFFER_THRESHOLD
 * - ws not closing/closed
 *
 * @param {WebSocket} ws - WebSocket connection
 * @returns {boolean} True if send is allowed
 */
function canSend(ws) {
  // Check socket exists
  if (!ws) {
    return false;
  }

  // Check readyState - must be OPEN
  if (ws.readyState !== 1) { // WebSocket.OPEN
    return false;
  }

  // Check bufferedAmount threshold
  const MAX_BUFFER_THRESHOLD = config.BACKPRESSURE.bufferedAmountThreshold;
  if (ws.bufferedAmount !== undefined && ws.bufferedAmount >= MAX_BUFFER_THRESHOLD) {
    return false;
  }

  return true;
}

/**
 * Tier-1.2: Send message with backpressure enforcement and FAILED state marking
 *
 * This is the SINGLE enforcement point for all outbound WebSocket sends.
 *
 * Behavior:
 * - If canSend === false:
 *   - Mark message as FAILED in DB (if context.messageId exists)
 *   - Log transition: SENT → FAILED_BACKPRESSURE
 *   - Return { ok: false, reason }
 * - If canSend === true:
 *   - Call ws.send(payload) directly
 *   - Return { ok: true }
 *
 * @param {WebSocket} ws - WebSocket connection
 * @param {string|Object} payload - Message payload (string or object to JSON.stringify)
 * @param {Object} [context] - Context object
 * @param {string} [context.messageId] - Message ID (if message is persisted)
 * @param {string} [context.clientMessageId] - Client message ID
 * @param {string} [context.userId] - User ID
 * @param {string} [context.connectionId] - Connection ID
 * @returns {{ ok: boolean, reason?: string }}
 */
async function sendOrFail(ws, payload, context = {}) {
  const { messageId, clientMessageId, userId, connectionId } = context;

  // Check if we can send
  if (!canSend(ws)) {
    // If message has already been persisted, mark as FAILED
    if (messageId) {
      try {
        const dbMessage = await messageStoreService.getById(messageId);
        if (dbMessage) {
          await dbAdapter.updateMessageState(messageId, 'FAILED');
          transition({
            event: TRANSITION_EVENT.MESSAGE_FAILED,
            messageId,
            connectionId: connectionId || null,
            userId: userId || null,
            correlationId: context.correlationId || null,
            fromState: dbMessage.state || 'SENT',
            toState: 'FAILED_BACKPRESSURE',
            reason: 'BACKPRESSURE',
          });
        }
      } catch (err) {
        logger.error('SocketSafety', 'sendOrFail_mark_failed_error', { messageId, correlationId: context.correlationId || null, error: err.message });
      }
    } else {
      // Transient message (typing/presence) - log as DROPPED_BACKPRESSURE
      logger.info('SocketSafety', 'transient_message_dropped', {
        userId: userId || null,
        connectionId: connectionId || null,
        correlationId: context.correlationId || null,
        outcome: 'DROPPED_BACKPRESSURE',
        reason: 'BACKPRESSURE',
      });
    }

    return { ok: false, reason: 'BACKPRESSURE' };
  }

  // Can send: prepare payload
  let payloadStr;
  if (typeof payload === 'string') {
    payloadStr = payload;
  } else if (payload && typeof payload === 'object') {
    const payloadObj = { ...payload };
    if (!payloadObj.version) payloadObj.version = config.PROTOCOL_VERSION;
    payloadStr = JSON.stringify(payloadObj);
  } else {
    logger.error('SocketSafety', 'sendOrFail_invalid_payload', { messageId, userId, correlationId: context.correlationId || null });
    return { ok: false, reason: 'invalid_payload' };
  }

  // Send directly (no queue - this is the enforcement point)
  try {
    ws.send(payloadStr);

    // Log transition: QUEUED → SENT (only for persisted messages)
    if (messageId) {
      transition({
        event: TRANSITION_EVENT.MESSAGE_SENT,
        messageId,
        connectionId: connectionId || null,
        userId: userId || null,
        correlationId: context.correlationId || null,
        fromState: 'QUEUED',
        toState: 'SENT',
      });
    } else {
      // Transient message - simple log
      logger.info('SocketSafety', 'transient_message_sent', {
        userId: userId || null,
        connectionId: connectionId || null,
        correlationId: context.correlationId || null,
      });
    }

    return { ok: true };
  } catch (err) {
    logger.error('SocketSafety', 'sendOrFail_send_error', { messageId, userId, correlationId: context.correlationId || null, error: err.message });

    // If send throws, mark as FAILED if messageId exists
    if (messageId) {
      try {
        const dbMessage = await messageStoreService.getById(messageId);
        if (dbMessage) {
          await dbAdapter.updateMessageState(messageId, 'FAILED');
          transition({
            event: TRANSITION_EVENT.MESSAGE_FAILED,
            messageId,
            connectionId: connectionId || null,
            userId: userId || null,
            correlationId: context.correlationId || null,
            fromState: dbMessage.state || 'SENT',
            toState: 'FAILED_BACKPRESSURE',
            reason: 'send_exception',
          });
        }
      } catch (markErr) {
        logger.error('SocketSafety', 'sendOrFail_mark_failed_on_exception', { messageId, correlationId: context.correlationId || null, error: markErr.message });
      }
    }

    return { ok: false, reason: 'send_exception' };
  }
}

module.exports = {
  MAX_OUTBOUND_QUEUE_SIZE,
  initBackpressureState,
  cleanupBackpressure,
  checkBackpressure,
  queueMessage,
  processQueue,
  sendMessage,
  getQueueSize,
  incrementPendingSend,
  decrementPendingSend,
  canSend,
  sendOrFail,
};
