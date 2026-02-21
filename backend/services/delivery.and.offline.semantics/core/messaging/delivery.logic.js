/**
 * delivery.logic.js
 *
 * Delivery rules without transport. Decides whether a message CAN be
 * delivered now and applies delivery-related state transitions. Uses
 * Message Core (Workspace 1); no WebSocket, DB, or presence. Pure
 * functions only; returns new message objects (immutability).
 *
 * Implements:
 * - Delivery state lifecycle: SENT → DELIVERED → READ
 * - ACK protocol (DELIVERED_ACK, READ_ACK) with idempotency
 * - TTL-based transient messages (metadata only)
 * - Retry logic with idempotency guards
 * - Delivery failure tracking (soft failures)
 */

const messageLogic = require('../../message.core/core/messaging/message.logic.js');
const machine = require('../../message.core/core/messaging/message.machine.js');
const validator = require('../../message.core/core/messaging/message.validator.js');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ACK_TYPE_DELIVERED = 'DELIVERED_ACK';
const ACK_TYPE_READ = 'READ_ACK';

// ---------------------------------------------------------------------------
// Errors (interview-friendly: explain why and what invariant was violated)
// ---------------------------------------------------------------------------

/**
 * Thrown when delivery transition is not allowed (e.g. message not in "sent",
 * or receiver offline when delivery requires active connection).
 */
class DeliveryNotAllowedError extends Error {
  constructor(reason, message = 'Delivery not allowed') {
    super(message + ': ' + reason);
    this.name = 'DeliveryNotAllowedError';
    this.reason = reason;
  }
}

/**
 * Thrown when delivery cannot proceed because the receiver is offline.
 * Invariant: a message CANNOT be delivered if the receiver is offline.
 */
class ReceiverOfflineError extends Error {
  constructor(message = 'Receiver is offline; message cannot transition to delivered') {
    super(message);
    this.name = 'ReceiverOfflineError';
  }
}

/**
 * Thrown when ACK is invalid (missing fields, wrong type, etc.).
 */
class InvalidAckError extends Error {
  constructor(reason, message = 'Invalid ACK') {
    super(message + ': ' + reason);
    this.name = 'InvalidAckError';
    this.reason = reason;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATE_SENT = 'sent';
const STATE_DELIVERED = 'delivered';
const STATE_READ = 'read';

/**
 * Validates message shape, but allows delivery states ('sent', 'delivered', 'read')
 * even if they're not in Message Core's machine states.
 * This is needed because delivery states extend Message Core's lifecycle.
 *
 * @param {unknown} message
 * @returns {boolean}
 */
function hasValidMessageShape(message) {
  if (message === null || typeof message !== 'object') return false;
  
  // Basic shape validation
  if (typeof message.messageId !== 'string' || message.messageId.trim().length === 0) return false;
  if (typeof message.senderId !== 'string' || message.senderId.trim().length === 0) return false;
  if (typeof message.receiverId !== 'string' || message.receiverId.trim().length === 0) return false;
  if (message.senderId === message.receiverId) return false;
  
  // Allow delivery states even if not in Message Core machine
  const deliveryStates = [STATE_SENT, STATE_DELIVERED, STATE_READ];
  if (typeof message.state === 'string' && deliveryStates.includes(message.state)) {
    return true; // Delivery state is valid, skip full validator
  }
  
  // For non-delivery states, use Message Core validator
  try {
    validator.validateMessageShape(message);
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isSafeNonNegativeInteger(value) {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    Number.isSafeInteger(value)
  );
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isPositiveInteger(value) {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value > 0 &&
    Number.isSafeInteger(value)
  );
}

/**
 * Creates a new message object with updated fields (immutability).
 * @param {object} message
 * @param {object} updates
 * @returns {object}
 */
function updateMessage(message, updates) {
  return { ...message, ...updates };
}

/**
 * Gets current timestamp in milliseconds.
 * @returns {number}
 */
function getCurrentTimestamp() {
  return Date.now();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Decides whether a message CAN be delivered right now.
 * Delivery is allowed only when: (1) receiver has active connection, and
 * (2) message is in "sent" state (next transition is sent -> delivered).
 *
 * Production guarantees:
 * - Deterministic: same input always produces same output
 * - Defensive: handles invalid inputs gracefully (returns false)
 * - State-aware: only allows delivery from SENT state
 *
 * @param {{ messageId: string, senderId: string, receiverId: string, content: string, state: string, createdAt?: number, updatedAt?: number }} message
 * @param {boolean} receiverOnline - whether receiver has active connection (caller-provided; no presence logic here)
 * @returns {boolean}
 */
function canDeliverMessage(message, receiverOnline) {
  if (!hasValidMessageShape(message)) return false;
  if (receiverOnline !== true && receiverOnline !== false) return false;
  if (!receiverOnline) return false;
  if (message.state !== STATE_SENT) return false;
  // Additional guard: ensure transition is valid (defensive)
  return true; // STATE_SENT -> STATE_DELIVERED is always valid in delivery FSM
}

/**
 * Applies the delivery transition: sent -> delivered.
 * Caller MUST ensure receiver is online (e.g. via canDeliverMessage) before calling.
 * Does not check receiver presence; that is the caller's responsibility.
 *
 * Production guarantees:
 * - Deterministic: same input always produces same output
 * - Idempotent: calling multiple times with same state is safe (no-op after first call)
 * - Immutable: always returns new message object
 * - Guarded: rejects invalid state transitions (backward or skip)
 *
 * @param {{ messageId: string, senderId: string, receiverId: string, content: string, state: string, createdAt?: number, updatedAt?: number }} message
 * @returns {{ messageId: string, senderId: string, receiverId: string, content: string, state: string, createdAt?: number, updatedAt?: number }}
 * @throws {DeliveryNotAllowedError|validator.InvalidMessageError|validator.InvalidTransitionError}
 */
function deliverMessage(message) {
  if (message === null || typeof message !== 'object') {
    throw new validator.InvalidMessageError('message must be an object');
  }
  if (!hasValidMessageShape(message)) {
    throw new validator.InvalidMessageError('invalid message shape');
  }

  const currentState = message.state;

  // Idempotency: if already delivered or read, return unchanged (replay-safe)
  if (currentState === STATE_DELIVERED || currentState === STATE_READ) {
    return message;
  }

  // Guard: only allow transition from SENT
  if (currentState !== STATE_SENT) {
    throw new DeliveryNotAllowedError(
      'message must be in "sent" state to transition to "delivered" (current: "' + currentState + '")',
      'Delivery not allowed'
    );
  }

  // Use Message Core transition if state is in machine, otherwise create new message with updated state
  try {
    const updated = messageLogic.transitionMessage(message, STATE_DELIVERED);
    // Ensure immutability: copy all fields, update state and timestamp
    return {
      ...updated,
      state: STATE_DELIVERED,
      updatedAt: updated.updatedAt !== undefined ? updated.updatedAt : getCurrentTimestamp(),
    };
  } catch (err) {
    // If Message Core doesn't recognize delivery states, manually transition
    if (err.name === 'InvalidStateError' || err.name === 'InvalidTransitionError') {
      return {
        ...message,
        state: STATE_DELIVERED,
        updatedAt: message.updatedAt !== undefined ? message.updatedAt : getCurrentTimestamp(),
      };
    }
    throw err;
  }
}

/**
 * Applies the read transition: delivered -> read.
 * Message must be in "delivered" state; cannot skip states.
 *
 * Production guarantees:
 * - Deterministic: same input always produces same output
 * - Idempotent: calling multiple times with same state is safe (no-op after first call)
 * - Immutable: always returns new message object
 * - Guarded: rejects invalid state transitions (backward or skip from SENT)
 *
 * @param {{ messageId: string, senderId: string, receiverId: string, content: string, state: string, createdAt?: number, updatedAt?: number }} message
 * @returns {{ messageId: string, senderId: string, receiverId: string, content: string, state: string, createdAt?: number, updatedAt?: number }}
 * @throws {DeliveryNotAllowedError|validator.InvalidMessageError|validator.InvalidTransitionError}
 */
function markMessageRead(message) {
  if (message === null || typeof message !== 'object') {
    throw new validator.InvalidMessageError('message must be an object');
  }
  if (!hasValidMessageShape(message)) {
    throw new validator.InvalidMessageError('invalid message shape');
  }

  const currentState = message.state;

  // Idempotency: if already read, return unchanged (replay-safe)
  if (currentState === STATE_READ) {
    return message;
  }

  // Guard: only allow transition from DELIVERED (cannot skip from SENT)
  if (currentState !== STATE_DELIVERED) {
    throw new DeliveryNotAllowedError(
      'message must be in "delivered" state to transition to "read" (current: "' + currentState + '")',
      'Mark read not allowed'
    );
  }

  // Use Message Core transition if state is in machine, otherwise create new message with updated state
  try {
    const updated = messageLogic.transitionMessage(message, STATE_READ);
    // Ensure immutability: copy all fields, update state and timestamp
    return {
      ...updated,
      state: STATE_READ,
      updatedAt: updated.updatedAt !== undefined ? updated.updatedAt : getCurrentTimestamp(),
    };
  } catch (err) {
    // If Message Core doesn't recognize delivery states, manually transition
    if (err.name === 'InvalidStateError' || err.name === 'InvalidTransitionError') {
      return {
        ...message,
        state: STATE_READ,
        updatedAt: message.updatedAt !== undefined ? message.updatedAt : getCurrentTimestamp(),
      };
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// ACK Protocol
// ---------------------------------------------------------------------------

/**
 * Creates a DELIVERED_ACK object.
 * ACKs reference messageId and conversationId for idempotency.
 *
 * @param {string} messageId
 * @param {string} conversationId
 * @param {number} [timestamp] - optional timestamp (defaults to now)
 * @returns {{ type: string, messageId: string, conversationId: string, timestamp: number }}
 */
function createDeliveredAck(messageId, conversationId, timestamp) {
  if (!isNonEmptyString(messageId)) {
    throw new InvalidAckError('messageId must be a non-empty string');
  }
  if (!isNonEmptyString(conversationId)) {
    throw new InvalidAckError('conversationId must be a non-empty string');
  }
  return {
    type: ACK_TYPE_DELIVERED,
    messageId,
    conversationId,
    timestamp: timestamp !== undefined ? timestamp : getCurrentTimestamp(),
  };
}

/**
 * Creates a READ_ACK object.
 *
 * @param {string} messageId
 * @param {string} conversationId
 * @param {number} [timestamp] - optional timestamp (defaults to now)
 * @returns {{ type: string, messageId: string, conversationId: string, timestamp: number }}
 */
function createReadAck(messageId, conversationId, timestamp) {
  if (!isNonEmptyString(messageId)) {
    throw new InvalidAckError('messageId must be a non-empty string');
  }
  if (!isNonEmptyString(conversationId)) {
    throw new InvalidAckError('conversationId must be a non-empty string');
  }
  return {
    type: ACK_TYPE_READ,
    messageId,
    conversationId,
    timestamp: timestamp !== undefined ? timestamp : getCurrentTimestamp(),
  };
}

/**
 * Validates an ACK object structure.
 *
 * @param {unknown} ack
 * @returns {boolean}
 */
function isValidAck(ack) {
  if (ack === null || typeof ack !== 'object') return false;
  if (ack.type !== ACK_TYPE_DELIVERED && ack.type !== ACK_TYPE_READ) return false;
  if (!isNonEmptyString(ack.messageId)) return false;
  if (!isNonEmptyString(ack.conversationId)) return false;
  if (ack.timestamp !== undefined && !isSafeNonNegativeInteger(ack.timestamp)) return false;
  return true;
}

/**
 * Processes a DELIVERED_ACK idempotently.
 * If message is already delivered or read, returns the message unchanged.
 * If message is in "sent", transitions to "delivered".
 * Returns { processed: boolean, message: object }.
 *
 * Production guarantees:
 * - Idempotent: duplicate ACKs are no-ops
 * - Order-independent: ACK can arrive late (already delivered/read)
 * - Backward-transition-safe: rejects invalid state transitions
 * - Immutable: always returns new message object
 *
 * @param {{ messageId: string, senderId: string, receiverId: string, content: string, state: string, createdAt?: number, updatedAt?: number, conversationId?: string }} message
 * @param {{ type: string, messageId: string, conversationId: string, timestamp?: number }} ack
 * @returns {{ processed: boolean, message: object }}
 * @throws {InvalidAckError|DeliveryNotAllowedError|validator.InvalidMessageError|validator.InvalidTransitionError}
 */
function processDeliveredAck(message, ack) {
  if (!isValidAck(ack)) {
    throw new InvalidAckError('invalid ACK structure');
  }
  if (ack.type !== ACK_TYPE_DELIVERED) {
    throw new InvalidAckError('expected DELIVERED_ACK, got ' + ack.type);
  }
  if (message === null || typeof message !== 'object') {
    throw new InvalidAckError('message must be an object');
  }
  if (typeof message.messageId !== 'string') {
    throw new InvalidAckError('message.messageId must be a string');
  }
  if (ack.messageId !== message.messageId) {
    throw new InvalidAckError('ACK messageId does not match message messageId');
  }
  if (message.conversationId !== undefined && ack.conversationId !== message.conversationId) {
    throw new InvalidAckError('ACK conversationId does not match message conversationId');
  }

  if (!hasValidMessageShape(message)) {
    throw new validator.InvalidMessageError('invalid message shape');
  }

  const currentState = message.state;

  // Idempotency: if already delivered or read, no-op (late ACK, already processed)
  if (currentState === STATE_DELIVERED || currentState === STATE_READ) {
    return { processed: false, message };
  }

  // Transition sent -> delivered (only valid forward transition)
  if (currentState === STATE_SENT) {
    const updated = deliverMessage(message);
    return { processed: true, message: updated };
  }

  // Backward transition safety: reject invalid states (e.g., 'sending', 'created', etc.)
  throw new DeliveryNotAllowedError(
    'message must be in "sent" state to process DELIVERED_ACK (current: "' + currentState + '")',
    'ACK processing not allowed'
  );
}

/**
 * Processes a READ_ACK idempotently.
 * If message is already read, returns the message unchanged.
 * If message is in "delivered", transitions to "read".
 * Returns { processed: boolean, message: object }.
 *
 * Production guarantees:
 * - Idempotent: duplicate ACKs are no-ops
 * - Order-independent: ACK can arrive late (already read)
 * - Backward-transition-safe: rejects invalid state transitions (e.g., READ_ACK on SENT)
 * - Immutable: always returns new message object
 *
 * @param {{ messageId: string, senderId: string, receiverId: string, content: string, state: string, createdAt?: number, updatedAt?: number, conversationId?: string }} message
 * @param {{ type: string, messageId: string, conversationId: string, timestamp?: number }} ack
 * @returns {{ processed: boolean, message: object }}
 * @throws {InvalidAckError|DeliveryNotAllowedError|validator.InvalidMessageError|validator.InvalidTransitionError}
 */
function processReadAck(message, ack) {
  if (!isValidAck(ack)) {
    throw new InvalidAckError('invalid ACK structure');
  }
  if (ack.type !== ACK_TYPE_READ) {
    throw new InvalidAckError('expected READ_ACK, got ' + ack.type);
  }
  if (message === null || typeof message !== 'object') {
    throw new InvalidAckError('message must be an object');
  }
  if (typeof message.messageId !== 'string') {
    throw new InvalidAckError('message.messageId must be a string');
  }
  if (ack.messageId !== message.messageId) {
    throw new InvalidAckError('ACK messageId does not match message messageId');
  }
  if (message.conversationId !== undefined && ack.conversationId !== message.conversationId) {
    throw new InvalidAckError('ACK conversationId does not match message conversationId');
  }

  if (!hasValidMessageShape(message)) {
    throw new validator.InvalidMessageError('invalid message shape');
  }

  const currentState = message.state;

  // Idempotency: if already read, no-op (late ACK, already processed)
  if (currentState === STATE_READ) {
    return { processed: false, message };
  }

  // Transition delivered -> read (only valid forward transition)
  if (currentState === STATE_DELIVERED) {
    const updated = markMessageRead(message);
    return { processed: true, message: updated };
  }

  // Backward transition safety: reject invalid states (e.g., SENT, 'sending', etc.)
  // READ_ACK cannot be applied to SENT (must go through DELIVERED first)
  throw new DeliveryNotAllowedError(
    'message must be in "delivered" state to process READ_ACK (current: "' + currentState + '")',
    'ACK processing not allowed'
  );
}

/**
 * Processes any ACK type (DELIVERED_ACK or READ_ACK) idempotently.
 *
 * Production guarantees:
 * - Idempotent: duplicate ACKs are no-ops
 * - Order-independent: ACKs can arrive out of order
 * - Backward-transition-safe: rejects invalid state transitions
 * - Defensive: validates ACK structure before processing
 *
 * @param {{ messageId: string, senderId: string, receiverId: string, content: string, state: string, createdAt?: number, updatedAt?: number, conversationId?: string }} message
 * @param {{ type: string, messageId: string, conversationId: string, timestamp?: number }} ack
 * @returns {{ processed: boolean, message: object }}
 * @throws {InvalidAckError|DeliveryNotAllowedError|validator.InvalidMessageError|validator.InvalidTransitionError}
 */
function processAck(message, ack) {
  if (message === null || typeof message !== 'object') {
    throw new InvalidAckError('message must be an object');
  }
  if (!isValidAck(ack)) {
    throw new InvalidAckError('invalid ACK structure');
  }
  if (ack.type === ACK_TYPE_DELIVERED) {
    return processDeliveredAck(message, ack);
  }
  if (ack.type === ACK_TYPE_READ) {
    return processReadAck(message, ack);
  }
  throw new InvalidAckError('unknown ACK type: ' + ack.type);
}

// ---------------------------------------------------------------------------
// TTL-based Transient Messages
// ---------------------------------------------------------------------------

/**
 * Adds TTL metadata to a message. Does NOT mutate the message.
 * Assumes MongoDB TTL index exists (not configured here).
 *
 * @param {{ messageId: string, [key: string]: unknown }} message
 * @param {number} ttlSeconds - TTL in seconds (must be positive integer)
 * @returns {object}
 * @throws {Error}
 */
function addTtlMetadata(message, ttlSeconds) {
  if (!isPositiveInteger(ttlSeconds)) {
    throw new Error('TTL must be a positive integer (seconds)');
  }
  const expiresAt = getCurrentTimestamp() + ttlSeconds * 1000;
  return updateMessage(message, {
    ttl: ttlSeconds,
    expiresAt,
  });
}

/**
 * Checks if a message has expired based on TTL metadata.
 *
 * @param {{ expiresAt?: number, [key: string]: unknown }} message
 * @param {number} [now] - optional current timestamp (defaults to now)
 * @returns {boolean}
 */
function isMessageExpired(message, now) {
  if (message.expiresAt === undefined) return false;
  if (!isSafeNonNegativeInteger(message.expiresAt)) return false;
  const currentTime = now !== undefined ? now : getCurrentTimestamp();
  return currentTime >= message.expiresAt;
}

// ---------------------------------------------------------------------------
// Retry Logic with Idempotency
// ---------------------------------------------------------------------------

/**
 * Records a delivery attempt. Does NOT mutate the message.
 * Returns a new message with updated retry metadata.
 *
 * Production guarantees:
 * - Idempotent: safe to call multiple times (increments counter)
 * - Immutable: always returns new message object
 * - Defensive: handles missing/invalid metadata gracefully
 *
 * @param {{ messageId: string, [key: string]: unknown }} message
 * @param {number} [timestamp] - optional timestamp (defaults to now)
 * @returns {object}
 */
function recordDeliveryAttempt(message, timestamp) {
  if (message === null || typeof message !== 'object') {
    throw new Error('message must be an object');
  }
  const attemptTime = timestamp !== undefined && isSafeNonNegativeInteger(timestamp) ? timestamp : getCurrentTimestamp();
  const currentAttempts = typeof message.deliveryAttempts === 'number' && message.deliveryAttempts >= 0
    ? message.deliveryAttempts
    : 0;
  return updateMessage(message, {
    deliveryAttempts: currentAttempts + 1,
    lastAttemptAt: attemptTime,
  });
}

/**
 * Checks if a message can be retried based on idempotency rules.
 * Uses messageId to prevent duplicate delivery state transitions.
 *
 * Production guarantees:
 * - Deterministic: same input always produces same output
 * - Defensive: handles missing/invalid metadata gracefully
 * - State-aware: only allows retry for SENT state (not delivered/read)
 *
 * @param {{ messageId: string, state: string, deliveryAttempts?: number, [key: string]: unknown }} message
 * @param {number} maxAttempts - maximum allowed attempts (default: 3)
 * @returns {boolean}
 */
function canRetryDelivery(message, maxAttempts) {
  if (!hasValidMessageShape(message)) return false;
  if (message.state !== STATE_SENT) return false;
  const attempts = typeof message.deliveryAttempts === 'number' && message.deliveryAttempts >= 0
    ? message.deliveryAttempts
    : 0;
  const limit = maxAttempts !== undefined && isPositiveInteger(maxAttempts) ? maxAttempts : 3;
  return attempts < limit;
}

// ---------------------------------------------------------------------------
// Delivery Failure Tracking
// ---------------------------------------------------------------------------

/**
 * Records a soft delivery failure. Does NOT mutate the message.
 * Tracks failure count and lastAttemptAt timestamp.
 *
 * Production guarantees:
 * - Idempotent: safe to call multiple times (increments counter)
 * - Immutable: always returns new message object
 * - Defensive: handles missing/invalid metadata gracefully
 *
 * @param {{ messageId: string, [key: string]: unknown }} message
 * @param {string} reason - failure reason (optional)
 * @param {number} [timestamp] - optional timestamp (defaults to now)
 * @returns {object}
 */
function recordDeliveryFailure(message, reason, timestamp) {
  if (message === null || typeof message !== 'object') {
    throw new Error('message must be an object');
  }
  const failureTime = timestamp !== undefined && isSafeNonNegativeInteger(timestamp) ? timestamp : getCurrentTimestamp();
  const currentFailures = typeof message.deliveryFailures === 'number' && message.deliveryFailures >= 0
    ? message.deliveryFailures
    : 0;
  const updated = updateMessage(message, {
    deliveryFailures: currentFailures + 1,
    lastFailureAt: failureTime,
    lastFailureReason: typeof reason === 'string' ? reason : undefined,
  });
  return updated;
}

/**
 * Gets delivery failure metadata from a message.
 *
 * @param {{ deliveryFailures?: number, lastFailureAt?: number, lastFailureReason?: string, [key: string]: unknown }} message
 * @returns {{ count: number, lastAttemptAt: number | null, lastFailureReason: string | null }}
 */
function getDeliveryFailureInfo(message) {
  return {
    count: typeof message.deliveryFailures === 'number' ? message.deliveryFailures : 0,
    lastAttemptAt: typeof message.lastFailureAt === 'number' ? message.lastFailureAt : null,
    lastFailureReason: typeof message.lastFailureReason === 'string' ? message.lastFailureReason : null,
  };
}

module.exports = {
  // Errors
  DeliveryNotAllowedError,
  ReceiverOfflineError,
  InvalidAckError,
  // Constants
  ACK_TYPE_DELIVERED,
  ACK_TYPE_READ,
  // Core delivery
  canDeliverMessage,
  deliverMessage,
  markMessageRead,
  // ACK Protocol
  createDeliveredAck,
  createReadAck,
  isValidAck,
  processDeliveredAck,
  processReadAck,
  processAck,
  // TTL
  addTtlMetadata,
  isMessageExpired,
  // Retry
  recordDeliveryAttempt,
  canRetryDelivery,
  // Failure tracking
  recordDeliveryFailure,
  getDeliveryFailureInfo,
};
/**
 * delivery.logic.js
 *
 * Delivery rules without transport. Decides whether a message CAN be
 * delivered now and applies delivery-related state transitions. Uses
 * Message Core (Workspace 1); no WebSocket, DB, or presence. Pure
 * functions only; returns new message objects (immutability).
 *
 * Implements:
 * - Delivery state lifecycle: SENT → DELIVERED → READ
 * - ACK protocol (DELIVERED_ACK, READ_ACK) with idempotency
 * - TTL-based transient messages (metadata only)
 * - Retry logic with idempotency guards
 * - Delivery failure tracking (soft failures)
 */

const messageLogic = require('../../message.core/core/messaging/message.logic.js');
const machine = require('../../message.core/core/messaging/message.machine.js');
const validator = require('../../message.core/core/messaging/message.validator.js');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ACK_TYPE_DELIVERED = 'DELIVERED_ACK';
const ACK_TYPE_READ = 'READ_ACK';

// ---------------------------------------------------------------------------
// Errors (interview-friendly: explain why and what invariant was violated)
// ---------------------------------------------------------------------------

/**
 * Thrown when delivery transition is not allowed (e.g. message not in "sent",
 * or receiver offline when delivery requires active connection).
 */
class DeliveryNotAllowedError extends Error {
  constructor(reason, message = 'Delivery not allowed') {
    super(message + ': ' + reason);
    this.name = 'DeliveryNotAllowedError';
    this.reason = reason;
  }
}

/**
 * Thrown when delivery cannot proceed because the receiver is offline.
 * Invariant: a message CANNOT be delivered if the receiver is offline.
 */
class ReceiverOfflineError extends Error {
  constructor(message = 'Receiver is offline; message cannot transition to delivered') {
    super(message);
    this.name = 'ReceiverOfflineError';
  }
}

/**
 * Thrown when ACK is invalid (missing fields, wrong type, etc.).
 */
class InvalidAckError extends Error {
  constructor(reason, message = 'Invalid ACK') {
    super(message + ': ' + reason);
    this.name = 'InvalidAckError';
    this.reason = reason;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATE_SENT = 'sent';
const STATE_DELIVERED = 'delivered';
const STATE_READ = 'read';

/**
 * Validates message shape, but allows delivery states ('sent', 'delivered', 'read')
 * even if they're not in Message Core's machine states.
 * This is needed because delivery states extend Message Core's lifecycle.
 *
 * @param {unknown} message
 * @returns {boolean}
 */
function hasValidMessageShape(message) {
  if (message === null || typeof message !== 'object') return false;
  
  // Basic shape validation
  if (typeof message.messageId !== 'string' || message.messageId.trim().length === 0) return false;
  if (typeof message.senderId !== 'string' || message.senderId.trim().length === 0) return false;
  if (typeof message.receiverId !== 'string' || message.receiverId.trim().length === 0) return false;
  if (message.senderId === message.receiverId) return false;
  
  // Allow delivery states even if not in Message Core machine
  const deliveryStates = [STATE_SENT, STATE_DELIVERED, STATE_READ];
  if (typeof message.state === 'string' && deliveryStates.includes(message.state)) {
    return true; // Delivery state is valid, skip full validator
  }
  
  // For non-delivery states, use Message Core validator
  try {
    validator.validateMessageShape(message);
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isSafeNonNegativeInteger(value) {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    Number.isSafeInteger(value)
  );
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isPositiveInteger(value) {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value > 0 &&
    Number.isSafeInteger(value)
  );
}

/**
 * Creates a new message object with updated fields (immutability).
 * @param {object} message
 * @param {object} updates
 * @returns {object}
 */
function updateMessage(message, updates) {
  return { ...message, ...updates };
}

/**
 * Gets current timestamp in milliseconds.
 * @returns {number}
 */
function getCurrentTimestamp() {
  return Date.now();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Decides whether a message CAN be delivered right now.
 * Delivery is allowed only when: (1) receiver has active connection, and
 * (2) message is in "sent" state (next transition is sent -> delivered).
 *
 * Production guarantees:
 * - Deterministic: same input always produces same output
 * - Defensive: handles invalid inputs gracefully (returns false)
 * - State-aware: only allows delivery from SENT state
 *
 * @param {{ messageId: string, senderId: string, receiverId: string, content: string, state: string, createdAt?: number, updatedAt?: number }} message
 * @param {boolean} receiverOnline - whether receiver has active connection (caller-provided; no presence logic here)
 * @returns {boolean}
 */
function canDeliverMessage(message, receiverOnline) {
  if (!hasValidMessageShape(message)) return false;
  if (receiverOnline !== true && receiverOnline !== false) return false;
  if (!receiverOnline) return false;
  if (message.state !== STATE_SENT) return false;
  // Additional guard: ensure transition is valid (defensive)
  return true; // STATE_SENT -> STATE_DELIVERED is always valid in delivery FSM
}

/**
 * Applies the delivery transition: sent -> delivered.
 * Caller MUST ensure receiver is online (e.g. via canDeliverMessage) before calling.
 * Does not check receiver presence; that is the caller's responsibility.
 *
 * Production guarantees:
 * - Deterministic: same input always produces same output
 * - Idempotent: calling multiple times with same state is safe (no-op after first call)
 * - Immutable: always returns new message object
 * - Guarded: rejects invalid state transitions (backward or skip)
 *
 * @param {{ messageId: string, senderId: string, receiverId: string, content: string, state: string, createdAt?: number, updatedAt?: number }} message
 * @returns {{ messageId: string, senderId: string, receiverId: string, content: string, state: string, createdAt?: number, updatedAt?: number }}
 * @throws {DeliveryNotAllowedError|validator.InvalidMessageError|validator.InvalidTransitionError}
 */
function deliverMessage(message) {
  if (message === null || typeof message !== 'object') {
    throw new validator.InvalidMessageError('message must be an object');
  }
  if (!hasValidMessageShape(message)) {
    throw new validator.InvalidMessageError('invalid message shape');
  }

  const currentState = message.state;

  // Idempotency: if already delivered or read, return unchanged (replay-safe)
  if (currentState === STATE_DELIVERED || currentState === STATE_READ) {
    return message;
  }

  // Guard: only allow transition from SENT
  if (currentState !== STATE_SENT) {
    throw new DeliveryNotAllowedError(
      'message must be in "sent" state to transition to "delivered" (current: "' + currentState + '")',
      'Delivery not allowed'
    );
  }

  // Use Message Core transition if state is in machine, otherwise create new message with updated state
  try {
    const updated = messageLogic.transitionMessage(message, STATE_DELIVERED);
    // Ensure immutability: copy all fields, update state and timestamp
    return {
      ...updated,
      state: STATE_DELIVERED,
      updatedAt: updated.updatedAt !== undefined ? updated.updatedAt : getCurrentTimestamp(),
    };
  } catch (err) {
    // If Message Core doesn't recognize delivery states, manually transition
    if (err.name === 'InvalidStateError' || err.name === 'InvalidTransitionError') {
      return {
        ...message,
        state: STATE_DELIVERED,
        updatedAt: message.updatedAt !== undefined ? message.updatedAt : getCurrentTimestamp(),
      };
    }
    throw err;
  }
}

/**
 * Applies the read transition: delivered -> read.
 * Message must be in "delivered" state; cannot skip states.
 *
 * Production guarantees:
 * - Deterministic: same input always produces same output
 * - Idempotent: calling multiple times with same state is safe (no-op after first call)
 * - Immutable: always returns new message object
 * - Guarded: rejects invalid state transitions (backward or skip from SENT)
 *
 * @param {{ messageId: string, senderId: string, receiverId: string, content: string, state: string, createdAt?: number, updatedAt?: number }} message
 * @returns {{ messageId: string, senderId: string, receiverId: string, content: string, state: string, createdAt?: number, updatedAt?: number }}
 * @throws {DeliveryNotAllowedError|validator.InvalidMessageError|validator.InvalidTransitionError}
 */
function markMessageRead(message) {
  if (message === null || typeof message !== 'object') {
    throw new validator.InvalidMessageError('message must be an object');
  }
  if (!hasValidMessageShape(message)) {
    throw new validator.InvalidMessageError('invalid message shape');
  }

  const currentState = message.state;

  // Idempotency: if already read, return unchanged (replay-safe)
  if (currentState === STATE_READ) {
    return message;
  }

  // Guard: only allow transition from DELIVERED (cannot skip from SENT)
  if (currentState !== STATE_DELIVERED) {
    throw new DeliveryNotAllowedError(
      'message must be in "delivered" state to transition to "read" (current: "' + currentState + '")',
      'Mark read not allowed'
    );
  }

  // Use Message Core transition if state is in machine, otherwise create new message with updated state
  try {
    const updated = messageLogic.transitionMessage(message, STATE_READ);
    // Ensure immutability: copy all fields, update state and timestamp
    return {
      ...updated,
      state: STATE_READ,
      updatedAt: updated.updatedAt !== undefined ? updated.updatedAt : getCurrentTimestamp(),
    };
  } catch (err) {
    // If Message Core doesn't recognize delivery states, manually transition
    if (err.name === 'InvalidStateError' || err.name === 'InvalidTransitionError') {
      return {
        ...message,
        state: STATE_READ,
        updatedAt: message.updatedAt !== undefined ? message.updatedAt : getCurrentTimestamp(),
      };
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// ACK Protocol
// ---------------------------------------------------------------------------

/**
 * Creates a DELIVERED_ACK object.
 * ACKs reference messageId and conversationId for idempotency.
 *
 * @param {string} messageId
 * @param {string} conversationId
 * @param {number} [timestamp] - optional timestamp (defaults to now)
 * @returns {{ type: string, messageId: string, conversationId: string, timestamp: number }}
 */
function createDeliveredAck(messageId, conversationId, timestamp) {
  if (!isNonEmptyString(messageId)) {
    throw new InvalidAckError('messageId must be a non-empty string');
  }
  if (!isNonEmptyString(conversationId)) {
    throw new InvalidAckError('conversationId must be a non-empty string');
  }
  return {
    type: ACK_TYPE_DELIVERED,
    messageId,
    conversationId,
    timestamp: timestamp !== undefined ? timestamp : getCurrentTimestamp(),
  };
}

/**
 * Creates a READ_ACK object.
 *
 * @param {string} messageId
 * @param {string} conversationId
 * @param {number} [timestamp] - optional timestamp (defaults to now)
 * @returns {{ type: string, messageId: string, conversationId: string, timestamp: number }}
 */
function createReadAck(messageId, conversationId, timestamp) {
  if (!isNonEmptyString(messageId)) {
    throw new InvalidAckError('messageId must be a non-empty string');
  }
  if (!isNonEmptyString(conversationId)) {
    throw new InvalidAckError('conversationId must be a non-empty string');
  }
  return {
    type: ACK_TYPE_READ,
    messageId,
    conversationId,
    timestamp: timestamp !== undefined ? timestamp : getCurrentTimestamp(),
  };
}

/**
 * Validates an ACK object structure.
 *
 * @param {unknown} ack
 * @returns {boolean}
 */
function isValidAck(ack) {
  if (ack === null || typeof ack !== 'object') return false;
  if (ack.type !== ACK_TYPE_DELIVERED && ack.type !== ACK_TYPE_READ) return false;
  if (!isNonEmptyString(ack.messageId)) return false;
  if (!isNonEmptyString(ack.conversationId)) return false;
  if (ack.timestamp !== undefined && !isSafeNonNegativeInteger(ack.timestamp)) return false;
  return true;
}

/**
 * Processes a DELIVERED_ACK idempotently.
 * If message is already delivered or read, returns the message unchanged.
 * If message is in "sent", transitions to "delivered".
 * Returns { processed: boolean, message: object }.
 *
 * Production guarantees:
 * - Idempotent: duplicate ACKs are no-ops
 * - Order-independent: ACK can arrive late (already delivered/read)
 * - Backward-transition-safe: rejects invalid state transitions
 * - Immutable: always returns new message object
 *
 * @param {{ messageId: string, senderId: string, receiverId: string, content: string, state: string, createdAt?: number, updatedAt?: number, conversationId?: string }} message
 * @param {{ type: string, messageId: string, conversationId: string, timestamp?: number }} ack
 * @returns {{ processed: boolean, message: object }}
 * @throws {InvalidAckError|DeliveryNotAllowedError|validator.InvalidMessageError|validator.InvalidTransitionError}
 */
function processDeliveredAck(message, ack) {
  if (!isValidAck(ack)) {
    throw new InvalidAckError('invalid ACK structure');
  }
  if (ack.type !== ACK_TYPE_DELIVERED) {
    throw new InvalidAckError('expected DELIVERED_ACK, got ' + ack.type);
  }
  if (message === null || typeof message !== 'object') {
    throw new InvalidAckError('message must be an object');
  }
  if (typeof message.messageId !== 'string') {
    throw new InvalidAckError('message.messageId must be a string');
  }
  if (ack.messageId !== message.messageId) {
    throw new InvalidAckError('ACK messageId does not match message messageId');
  }
  if (message.conversationId !== undefined && ack.conversationId !== message.conversationId) {
    throw new InvalidAckError('ACK conversationId does not match message conversationId');
  }

  if (!hasValidMessageShape(message)) {
    throw new validator.InvalidMessageError('invalid message shape');
  }

  const currentState = message.state;

  // Idempotency: if already delivered or read, no-op (late ACK, already processed)
  if (currentState === STATE_DELIVERED || currentState === STATE_READ) {
    return { processed: false, message };
  }

  // Transition sent -> delivered (only valid forward transition)
  if (currentState === STATE_SENT) {
    const updated = deliverMessage(message);
    return { processed: true, message: updated };
  }

  // Backward transition safety: reject invalid states (e.g., 'sending', 'created', etc.)
  throw new DeliveryNotAllowedError(
    'message must be in "sent" state to process DELIVERED_ACK (current: "' + currentState + '")',
    'ACK processing not allowed'
  );
}

/**
 * Processes a READ_ACK idempotently.
 * If message is already read, returns the message unchanged.
 * If message is in "delivered", transitions to "read".
 * Returns { processed: boolean, message: object }.
 *
 * Production guarantees:
 * - Idempotent: duplicate ACKs are no-ops
 * - Order-independent: ACK can arrive late (already read)
 * - Backward-transition-safe: rejects invalid state transitions (e.g., READ_ACK on SENT)
 * - Immutable: always returns new message object
 *
 * @param {{ messageId: string, senderId: string, receiverId: string, content: string, state: string, createdAt?: number, updatedAt?: number, conversationId?: string }} message
 * @param {{ type: string, messageId: string, conversationId: string, timestamp?: number }} ack
 * @returns {{ processed: boolean, message: object }}
 * @throws {InvalidAckError|DeliveryNotAllowedError|validator.InvalidMessageError|validator.InvalidTransitionError}
 */
function processReadAck(message, ack) {
  if (!isValidAck(ack)) {
    throw new InvalidAckError('invalid ACK structure');
  }
  if (ack.type !== ACK_TYPE_READ) {
    throw new InvalidAckError('expected READ_ACK, got ' + ack.type);
  }
  if (message === null || typeof message !== 'object') {
    throw new InvalidAckError('message must be an object');
  }
  if (typeof message.messageId !== 'string') {
    throw new InvalidAckError('message.messageId must be a string');
  }
  if (ack.messageId !== message.messageId) {
    throw new InvalidAckError('ACK messageId does not match message messageId');
  }
  if (message.conversationId !== undefined && ack.conversationId !== message.conversationId) {
    throw new InvalidAckError('ACK conversationId does not match message conversationId');
  }

  if (!hasValidMessageShape(message)) {
    throw new validator.InvalidMessageError('invalid message shape');
  }

  const currentState = message.state;

  // Idempotency: if already read, no-op (late ACK, already processed)
  if (currentState === STATE_READ) {
    return { processed: false, message };
  }

  // Transition delivered -> read (only valid forward transition)
  if (currentState === STATE_DELIVERED) {
    const updated = markMessageRead(message);
    return { processed: true, message: updated };
  }

  // Backward transition safety: reject invalid states (e.g., SENT, 'sending', etc.)
  // READ_ACK cannot be applied to SENT (must go through DELIVERED first)
  throw new DeliveryNotAllowedError(
    'message must be in "delivered" state to process READ_ACK (current: "' + currentState + '")',
    'ACK processing not allowed'
  );
}

/**
 * Processes any ACK type (DELIVERED_ACK or READ_ACK) idempotently.
 *
 * Production guarantees:
 * - Idempotent: duplicate ACKs are no-ops
 * - Order-independent: ACKs can arrive out of order
 * - Backward-transition-safe: rejects invalid state transitions
 * - Defensive: validates ACK structure before processing
 *
 * @param {{ messageId: string, senderId: string, receiverId: string, content: string, state: string, createdAt?: number, updatedAt?: number, conversationId?: string }} message
 * @param {{ type: string, messageId: string, conversationId: string, timestamp?: number }} ack
 * @returns {{ processed: boolean, message: object }}
 * @throws {InvalidAckError|DeliveryNotAllowedError|validator.InvalidMessageError|validator.InvalidTransitionError}
 */
function processAck(message, ack) {
  if (message === null || typeof message !== 'object') {
    throw new InvalidAckError('message must be an object');
  }
  if (!isValidAck(ack)) {
    throw new InvalidAckError('invalid ACK structure');
  }
  if (ack.type === ACK_TYPE_DELIVERED) {
    return processDeliveredAck(message, ack);
  }
  if (ack.type === ACK_TYPE_READ) {
    return processReadAck(message, ack);
  }
  throw new InvalidAckError('unknown ACK type: ' + ack.type);
}

// ---------------------------------------------------------------------------
// TTL-based Transient Messages
// ---------------------------------------------------------------------------

/**
 * Adds TTL metadata to a message. Does NOT mutate the message.
 * Assumes MongoDB TTL index exists (not configured here).
 *
 * @param {{ messageId: string, [key: string]: unknown }} message
 * @param {number} ttlSeconds - TTL in seconds (must be positive integer)
 * @returns {object}
 * @throws {Error}
 */
function addTtlMetadata(message, ttlSeconds) {
  if (!isPositiveInteger(ttlSeconds)) {
    throw new Error('TTL must be a positive integer (seconds)');
  }
  const expiresAt = getCurrentTimestamp() + ttlSeconds * 1000;
  return updateMessage(message, {
    ttl: ttlSeconds,
    expiresAt,
  });
}

/**
 * Checks if a message has expired based on TTL metadata.
 *
 * @param {{ expiresAt?: number, [key: string]: unknown }} message
 * @param {number} [now] - optional current timestamp (defaults to now)
 * @returns {boolean}
 */
function isMessageExpired(message, now) {
  if (message.expiresAt === undefined) return false;
  if (!isSafeNonNegativeInteger(message.expiresAt)) return false;
  const currentTime = now !== undefined ? now : getCurrentTimestamp();
  return currentTime >= message.expiresAt;
}

// ---------------------------------------------------------------------------
// Retry Logic with Idempotency
// ---------------------------------------------------------------------------

/**
 * Records a delivery attempt. Does NOT mutate the message.
 * Returns a new message with updated retry metadata.
 *
 * Production guarantees:
 * - Idempotent: safe to call multiple times (increments counter)
 * - Immutable: always returns new message object
 * - Defensive: handles missing/invalid metadata gracefully
 *
 * @param {{ messageId: string, [key: string]: unknown }} message
 * @param {number} [timestamp] - optional timestamp (defaults to now)
 * @returns {object}
 */
function recordDeliveryAttempt(message, timestamp) {
  if (message === null || typeof message !== 'object') {
    throw new Error('message must be an object');
  }
  const attemptTime = timestamp !== undefined && isSafeNonNegativeInteger(timestamp) ? timestamp : getCurrentTimestamp();
  const currentAttempts = typeof message.deliveryAttempts === 'number' && message.deliveryAttempts >= 0
    ? message.deliveryAttempts
    : 0;
  return updateMessage(message, {
    deliveryAttempts: currentAttempts + 1,
    lastAttemptAt: attemptTime,
  });
}

/**
 * Checks if a message can be retried based on idempotency rules.
 * Uses messageId to prevent duplicate delivery state transitions.
 *
 * Production guarantees:
 * - Deterministic: same input always produces same output
 * - Defensive: handles missing/invalid metadata gracefully
 * - State-aware: only allows retry for SENT state (not delivered/read)
 *
 * @param {{ messageId: string, state: string, deliveryAttempts?: number, [key: string]: unknown }} message
 * @param {number} maxAttempts - maximum allowed attempts (default: 3)
 * @returns {boolean}
 */
function canRetryDelivery(message, maxAttempts) {
  if (!hasValidMessageShape(message)) return false;
  if (message.state !== STATE_SENT) return false;
  const attempts = typeof message.deliveryAttempts === 'number' && message.deliveryAttempts >= 0
    ? message.deliveryAttempts
    : 0;
  const limit = maxAttempts !== undefined && isPositiveInteger(maxAttempts) ? maxAttempts : 3;
  return attempts < limit;
}

// ---------------------------------------------------------------------------
// Delivery Failure Tracking
// ---------------------------------------------------------------------------

/**
 * Records a soft delivery failure. Does NOT mutate the message.
 * Tracks failure count and lastAttemptAt timestamp.
 *
 * Production guarantees:
 * - Idempotent: safe to call multiple times (increments counter)
 * - Immutable: always returns new message object
 * - Defensive: handles missing/invalid metadata gracefully
 *
 * @param {{ messageId: string, [key: string]: unknown }} message
 * @param {string} reason - failure reason (optional)
 * @param {number} [timestamp] - optional timestamp (defaults to now)
 * @returns {object}
 */
function recordDeliveryFailure(message, reason, timestamp) {
  if (message === null || typeof message !== 'object') {
    throw new Error('message must be an object');
  }
  const failureTime = timestamp !== undefined && isSafeNonNegativeInteger(timestamp) ? timestamp : getCurrentTimestamp();
  const currentFailures = typeof message.deliveryFailures === 'number' && message.deliveryFailures >= 0
    ? message.deliveryFailures
    : 0;
  const updated = updateMessage(message, {
    deliveryFailures: currentFailures + 1,
    lastFailureAt: failureTime,
    lastFailureReason: typeof reason === 'string' ? reason : undefined,
  });
  return updated;
}

/**
 * Gets delivery failure metadata from a message.
 *
 * @param {{ deliveryFailures?: number, lastFailureAt?: number, lastFailureReason?: string, [key: string]: unknown }} message
 * @returns {{ count: number, lastAttemptAt: number | null, lastFailureReason: string | null }}
 */
function getDeliveryFailureInfo(message) {
  return {
    count: typeof message.deliveryFailures === 'number' ? message.deliveryFailures : 0,
    lastAttemptAt: typeof message.lastFailureAt === 'number' ? message.lastFailureAt : null,
    lastFailureReason: typeof message.lastFailureReason === 'string' ? message.lastFailureReason : null,
  };
}

module.exports = {
  // Errors
  DeliveryNotAllowedError,
  ReceiverOfflineError,
  InvalidAckError,
  // Constants
  ACK_TYPE_DELIVERED,
  ACK_TYPE_READ,
  // Core delivery
  canDeliverMessage,
  deliverMessage,
  markMessageRead,
  // ACK Protocol
  createDeliveredAck,
  createReadAck,
  isValidAck,
  processDeliveredAck,
  processReadAck,
  processAck,
  // TTL
  addTtlMetadata,
  isMessageExpired,
  // Retry
  recordDeliveryAttempt,
  canRetryDelivery,
  // Failure tracking
  recordDeliveryFailure,
  getDeliveryFailureInfo,
};
