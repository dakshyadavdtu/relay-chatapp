'use strict';

/**
 * Per-recipient delivery persistence and state machine.
 * Delivery records: messageId, recipientId, state, timestamps.
 * Initial state: PERSISTED. Allowed transitions: PERSISTED → SENT | DELIVERED, SENT → DELIVERED, DELIVERED → READ.
 * PERSISTED → DELIVERED is allowed so replay can mark delivered when recipient was offline at send (record never went to SENT).
 * Atomic creation relative to message persistence (caller creates after persistMessage).
 * Delivery failure tracking: metrics + diagnostic event; ACK timeout for SENT state.
 */

const logger = require('../utils/logger');
const deliveryMetrics = require('../observability/deliveryMetrics.store');
const { emitDeliveryFailureDetected } = require('../diagnostics/eventBus');
const metrics = require('../observability/metrics');
const userDiagnostics = require('../diagnostics/userDiagnosticsAggregator');
const deliveryStore = require('../websocket/state/directDeliveryStore');

/** ACK timeout: mark failure if delivery remains SENT longer than this (ms). Default 30s. */
const DEFAULT_ACK_TIMEOUT_MS = 30000;
const ackTimeoutMs = typeof process.env.DELIVERY_ACK_TIMEOUT_MS === 'string'
  ? Math.max(1000, parseInt(process.env.DELIVERY_ACK_TIMEOUT_MS, 10) || DEFAULT_ACK_TIMEOUT_MS)
  : DEFAULT_ACK_TIMEOUT_MS;

const DeliveryState = Object.freeze({
  PERSISTED: 'PERSISTED',
  SENT: 'SENT',
  DELIVERED: 'DELIVERED',
  READ: 'READ',
});

const ALLOWED_TRANSITIONS = Object.freeze({
  [DeliveryState.PERSISTED]: [DeliveryState.SENT, DeliveryState.DELIVERED],
  [DeliveryState.SENT]: [DeliveryState.DELIVERED],
  [DeliveryState.DELIVERED]: [DeliveryState.READ],
  [DeliveryState.READ]: [],
});

// State storage moved to websocket/state/directDeliveryStore.js

/**
 * Strict transition validator. Pure function.
 * Allowed only: PERSISTED → SENT, SENT → DELIVERED, DELIVERED → READ.
 * Rejects: skipping states, backward transitions, duplicate transitions.
 * @param {string} fromState - Current state
 * @param {string} toState - Next state
 * @throws {Error} Structured error for invalid transition (code: INVALID_DELIVERY_TRANSITION)
 */
function validateTransition(fromState, toState) {
  if (!fromState || !toState) {
    const err = new Error('Invalid delivery transition: fromState and toState are required');
    err.code = 'INVALID_DELIVERY_TRANSITION';
    throw err;
  }
  const allowed = ALLOWED_TRANSITIONS[fromState];
  if (!Array.isArray(allowed) || !allowed.includes(toState)) {
    const err = new Error(
      `Invalid delivery transition: ${fromState} → ${toState} not allowed`
    );
    err.code = 'INVALID_DELIVERY_TRANSITION';
    err.fromState = fromState;
    err.toState = toState;
    throw err;
  }
}

/**
 * Create a delivery record per recipient. Initial state: PERSISTED.
 * Call after message persistence (atomic relative to message persist).
 * @param {string} messageId
 * @param {string} recipientId
 * @returns {{ messageId, recipientId, state, persistedAt }}
 */
function createDelivery(messageId, recipientId) {
  if (!messageId || !recipientId) return null;
  if (deliveryStore.hasDelivery(messageId, recipientId)) {
    return deliveryStore.getDelivery(messageId, recipientId);
  }

  const now = Date.now();
  const record = {
    messageId,
    recipientId,
    state: DeliveryState.PERSISTED,
    persistedAt: now,
    sentAt: null,
    deliveredAt: null,
    readAt: null,
  };
  deliveryStore.setDelivery(messageId, recipientId, record);
  return record;
}

/**
 * Create delivery records for multiple recipients (e.g. room broadcast).
 * @param {string} messageId
 * @param {string[]} recipientIds
 * @returns {Array<{ messageId, recipientId, state, persistedAt }>}
 */
function createDeliveriesForRecipients(messageId, recipientIds) {
  if (!messageId || !Array.isArray(recipientIds)) return [];
  const records = [];
  for (const recipientId of recipientIds) {
    const rec = createDelivery(messageId, recipientId);
    if (rec) records.push(rec);
  }
  return records;
}

/**
 * Transition delivery state. Validates via strict state machine.
 * Logs violation through logger; does not crash server.
 * @param {string} messageId
 * @param {string} recipientId
 * @param {string} newState - One of SENT, DELIVERED, READ
 * @returns {{ ok: boolean, record?: Object, error?: string, code?: string }}
 */
function transitionState(messageId, recipientId, newState) {
  if (!messageId || !recipientId || !newState) {
    return { ok: false, error: 'messageId, recipientId, newState required', code: 'INVALID_PAYLOAD' };
  }

  const record = deliveryStore.getDelivery(messageId, recipientId);
  if (!record) {
    logger.warn('DeliveryService', 'transition_state_no_record', { messageId, recipientId, newState });
    return { ok: false, error: 'Delivery record not found', code: 'DELIVERY_NOT_FOUND' };
  }

  try {
    validateTransition(record.state, newState);
  } catch (err) {
    logger.warn('DeliveryService', 'invalid_delivery_transition', {
      messageId,
      recipientId,
      fromState: record.state,
      toState: newState,
      code: err.code,
    });
    return {
      ok: false,
      error: err.message,
      code: err.code || 'INVALID_DELIVERY_TRANSITION',
      fromState: record.state,
      toState: newState,
    };
  }

  if (record.state === DeliveryState.SENT) {
    deliveryStore.clearDeliveryTimeout(messageId, recipientId);
  }

  const now = Date.now();
  record.state = newState;
  if (newState === DeliveryState.SENT) {
    record.sentAt = now;
    const timeoutId = setTimeout(() => {
      deliveryStore.deleteDeliveryTimeout(messageId, recipientId);
      const current = deliveryStore.getDelivery(messageId, recipientId);
      if (current && current.state === DeliveryState.SENT) {
        recordDeliveryFailure(messageId, recipientId, 'ACK_TIMEOUT');
      }
    }, ackTimeoutMs);
    deliveryStore.setDeliveryTimeout(messageId, recipientId, timeoutId);
  }
  if (newState === DeliveryState.DELIVERED) {
    record.deliveredAt = now;
    try {
      metrics.increment('messages_delivered_total');
    } catch (_) { /* no-op */ }
  }
  if (newState === DeliveryState.READ) record.readAt = now;
  deliveryStore.setDelivery(messageId, recipientId, record);

  return { ok: true, record: { ...record } };
}

/**
 * Record a delivery failure: increment metrics and emit diagnostic event.
 * Does not change delivery state or block message flow.
 * @param {string} messageId
 * @param {string} recipientId
 * @param {string} reason - e.g. ACK_TIMEOUT, SOCKET_CLOSED, SEND_ERROR, RECIPIENT_OFFLINE, BACKPRESSURE
 */
function recordDeliveryFailure(messageId, recipientId, reason) {
  try {
    metrics.increment('delivery_failures_total');
    if (reason === 'ACK_TIMEOUT') metrics.increment('ack_drop_count_total');
    try { userDiagnostics.onDeliveryFail(recipientId); } catch (_) { /* no-op */ }
    deliveryMetrics.incrementDeliveryFailure(reason, messageId, recipientId);
    emitDeliveryFailureDetected({ messageId, recipientId, reason, timestamp: Date.now() });
  } catch (err) {
    logger.warn('DeliveryService', 'record_failure_error', { messageId, recipientId, reason, error: err.message });
  }
}

/**
 * Record failures for all deliveries in SENT state for a user (e.g. socket closed).
 * Additive hook for connection lifecycle.
 * @param {string} userId - Disconnected user (recipient)
 */
function recordFailuresForDisconnectedUser(userId) {
  if (!userId) return;
  try {
    for (const [k, record] of deliveryStore.getAllDeliveries()) {
      if (record.recipientId !== userId || record.state !== DeliveryState.SENT) continue;
      deliveryStore.clearDeliveryTimeout(record.messageId, record.recipientId);
      recordDeliveryFailure(record.messageId, record.recipientId, 'SOCKET_CLOSED');
    }
  } catch (err) {
    logger.warn('DeliveryService', 'record_failures_disconnected_error', { userId, error: err.message });
  }
}

/**
 * Get delivery state for (messageId, recipientId).
 * @param {string} messageId
 * @param {string} recipientId
 * @returns {string|null} State or null if no record
 */
function getDeliveryState(messageId, recipientId) {
  const record = deliveryStore.getDelivery(messageId, recipientId);
  return record ? record.state : null;
}

/**
 * Get delivery record for (messageId, recipientId).
 * @param {string} messageId
 * @param {string} recipientId
 * @returns {Object|null}
 */
function getDelivery(messageId, recipientId) {
  return deliveryStore.getDelivery(messageId, recipientId);
}

/**
 * Get all delivery records for a message.
 * @param {string} messageId
 * @returns {Array<Object>}
 */
function getDeliveriesForMessage(messageId) {
  return deliveryStore.getDeliveriesForMessage(messageId);
}

/**
 * Whether delivery is in a terminal state (DELIVERED or READ) for replay filtering.
 * @param {string} messageId
 * @param {string} recipientId
 * @returns {boolean}
 */
function isDeliveredOrRead(messageId, recipientId) {
  const state = getDeliveryState(messageId, recipientId);
  return state === DeliveryState.DELIVERED || state === DeliveryState.READ;
}

/**
 * Whether delivery state is READ (for unread count).
 * No record or non-READ state => not read.
 * @param {string} messageId
 * @param {string} recipientId
 * @returns {boolean}
 */
function isRead(messageId, recipientId) {
  const state = getDeliveryState(messageId, recipientId);
  return state === DeliveryState.READ;
}

/**
 * Force delivery to READ (bypass state machine). For mark-read path only.
 * Creates record as PERSISTED then sets state=READ, readAt=now if no record exists.
 * @param {string} messageId
 * @param {string} recipientId
 * @returns {{ ok: boolean, record?: Object, error?: string }}
 */
function forceMarkAsRead(messageId, recipientId) {
  if (!messageId || !recipientId) {
    return { ok: false, error: 'messageId and recipientId required' };
  }
  let record = deliveryStore.getDelivery(messageId, recipientId);
  if (!record) {
    createDelivery(messageId, recipientId);
    record = deliveryStore.getDelivery(messageId, recipientId);
  }
  if (!record) return { ok: false, error: 'Could not get or create delivery record' };
  if (record.state === DeliveryState.SENT) {
    deliveryStore.clearDeliveryTimeout(messageId, recipientId);
  }
  const now = Date.now();
  record.state = DeliveryState.READ;
  record.readAt = now;
  if (!record.deliveredAt) record.deliveredAt = now;
  deliveryStore.setDelivery(messageId, recipientId, record);
  return { ok: true, record: { ...record } };
}

/**
 * Whether delivery is pending (PERSISTED or SENT) for replay.
 * No record (legacy messages) is treated as pending so replay still sends.
 * @param {string} messageId
 * @param {string} recipientId
 * @returns {boolean}
 */
function isPendingReplay(messageId, recipientId) {
  const state = getDeliveryState(messageId, recipientId);
  if (state === DeliveryState.DELIVERED || state === DeliveryState.READ) return false;
  return true;
}

module.exports = {
  DeliveryState,
  validateTransition,
  createDelivery,
  createDeliveriesForRecipients,
  transitionState,
  getDeliveryState,
  getDelivery,
  getDeliveriesForMessage,
  isDeliveredOrRead,
  isPendingReplay,
  isRead,
  forceMarkAsRead,
  recordDeliveryFailure,
  recordFailuresForDisconnectedUser,
};
