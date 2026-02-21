/**
 * offline.logic.js
 *
 * Offline message semantics. Decides what should happen logically when
 * delivery is impossible (e.g. receiver offline). Does NOT mutate messages,
 * store them, retry delivery, or assume how offline storage works.
 * Transport-agnostic; answers: "What should the system do if delivery
 * cannot happen now?"
 *
 * Implements:
 * - Offline message handling (mark SENT, store for later)
 * - Reconnection with resync (lastKnownSequence-based)
 * - Delivery state reconciliation
 * - Sequence-aware offline message collection
 */

const delivery = require('../messaging/delivery.logic.js');
const validator = require('../../message.core/core/messaging/message.validator.js');
const machine = require('../../message.core/core/messaging/message.machine.js');

const STATE_SENT = 'sent';
const STATE_DELIVERED = 'delivered';
const STATE_READ = 'read';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
function isBoolean(value) {
  return value === true || value === false;
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
function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Gets sequenceNumber from a message, or returns -1 if missing/invalid.
 *
 * @param {{ sequenceNumber?: number, [key: string]: unknown }} message
 * @returns {number}
 */
function getSequenceNumber(message) {
  if (typeof message.sequenceNumber === 'number' && Number.isInteger(message.sequenceNumber) && message.sequenceNumber >= 0) {
    return message.sequenceNumber;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Handles an outgoing message from the perspective of delivery/offline semantics.
 * Returns a result object describing what the system should do logically;
 * does NOT mutate the message, send it, or store it.
 *
 * - If receiver is online and message is in "sent" -> can deliver now.
 * - If receiver is offline and message is in "sent" -> must hold; message stays in "sent".
 * - If message is not in "sent" -> no delivery transition applies (e.g. already delivered/read).
 *
 * Production guarantees:
 * - Deterministic: same input always produces same output
 * - Idempotent: safe to call multiple times (no side effects)
 * - Immutable: does not mutate message
 * - Defensive: handles invalid inputs gracefully
 *
 * @param {{ messageId: string, senderId: string, receiverId: string, content: string, state: string, createdAt?: number, updatedAt?: number }} message
 * @param {boolean} receiverOnline
 * @returns {{ action: 'deliver'|'hold'|'none', message: object }}
 */
function handleOutgoingMessage(message, receiverOnline) {
  if (message === null || typeof message !== 'object') {
    return { action: 'none', message: message || {} };
  }
  if (!hasValidMessageShape(message)) {
    return { action: 'none', message };
  }
  if (!isBoolean(receiverOnline)) {
    return { action: 'hold', message };
  }

  const currentState = message.state;
  if (currentState !== STATE_SENT) {
    return { action: 'none', message };
  }

  if (receiverOnline && delivery.canDeliverMessage(message, true)) {
    return { action: 'deliver', message };
  }

  return { action: 'hold', message };
}

/**
 * Collects messages that are in "sent" state (not yet delivered).
 * These are candidates for (re-)delivery when the receiver comes online.
 * Does NOT mutate the input array or any message; returns a new array.
 *
 * Production guarantees:
 * - Deterministic: same input always produces same output
 * - Idempotent: safe to call multiple times (no side effects)
 * - Immutable: does not mutate input array or messages
 * - Deduplicated: same messageId appears only once
 *
 * @param {Array<{ messageId: string, senderId: string, receiverId: string, content: string, state: string, createdAt?: number, updatedAt?: number }>} messages
 * @returns {Array<object>}
 */
function collectOfflineMessages(messages) {
  if (!Array.isArray(messages)) return [];
  const result = [];
  const seenMessageIds = new Set();

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (!hasValidMessageShape(msg) || msg.state !== STATE_SENT) continue;

    // Deduplicate by messageId (defensive: handle duplicate messages in array)
    if (typeof msg.messageId === 'string' && msg.messageId.length > 0) {
      if (seenMessageIds.has(msg.messageId)) continue;
      seenMessageIds.add(msg.messageId);
    }

    result.push(msg);
  }

  return result;
}

/**
 * Prepares a message for redelivery check. The message must be in "sent" state;
 * no state transition is applied. Caller can then call canDeliverMessage(message, true)
 * when receiver is online and, if true, deliverMessage(message).
 *
 * Does NOT mutate the message. If the message is not in "sent", returns null
 * (not eligible for redelivery).
 *
 * Production guarantees:
 * - Deterministic: same input always produces same output
 * - Idempotent: safe to call multiple times (no side effects)
 * - Immutable: does not mutate message
 * - Defensive: handles invalid inputs gracefully (returns null)
 *
 * @param {{ messageId: string, senderId: string, receiverId: string, content: string, state: string, createdAt?: number, updatedAt?: number }} message
 * @returns {{ messageId: string, senderId: string, receiverId: string, content: string, state: string, createdAt?: number, updatedAt?: number } | null}
 */
function prepareForRedelivery(message) {
  if (message === null || typeof message !== 'object') return null;
  if (!hasValidMessageShape(message)) return null;
  if (message.state !== STATE_SENT) return null;
  // STATE_SENT -> STATE_DELIVERED is always valid in delivery FSM
  return message;
}

// ---------------------------------------------------------------------------
// Enhanced Offline Handling with Sequence Awareness
// ---------------------------------------------------------------------------

/**
 * Collects messages that are in "sent" state, optionally filtered by conversationId.
 * Returns messages sorted by sequenceNumber (ascending) for ordered delivery.
 * Does NOT mutate the input array or any message.
 *
 * Production guarantees:
 * - Deterministic: same input always produces same output
 * - Idempotent: safe to call multiple times (no side effects)
 * - Immutable: does not mutate input array or messages
 * - Deduplicated: same messageId appears only once
 *
 * @param {Array<{ messageId: string, conversationId?: string, sequenceNumber?: number, state: string, [key: string]: unknown }>} messages
 * @param {string} [conversationId] - optional filter by conversationId
 * @returns {Array<object>}
 */
function collectOfflineMessagesByConversation(messages, conversationId) {
  if (!Array.isArray(messages)) return [];
  const result = [];
  const seenMessageIds = new Set();

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (!hasValidMessageShape(msg) || msg.state !== STATE_SENT) continue;
    if (conversationId !== undefined && msg.conversationId !== conversationId) continue;

    // Deduplicate by messageId (defensive: handle duplicate messages in array)
    if (typeof msg.messageId === 'string' && msg.messageId.length > 0) {
      if (seenMessageIds.has(msg.messageId)) continue;
      seenMessageIds.add(msg.messageId);
    }

    result.push(msg);
  }

  // Sort by sequenceNumber (ascending) for ordered delivery
  result.sort((a, b) => {
    const seqA = getSequenceNumber(a);
    const seqB = getSequenceNumber(b);
    if (seqA === -1 && seqB === -1) return 0;
    if (seqA === -1) return 1;
    if (seqB === -1) return -1;
    return seqA - seqB;
  });

  return result;
}

/**
 * Marks messages as SENT when recipient is offline.
 * Returns a result object indicating which messages should be stored for later delivery.
 * Does NOT mutate messages; returns new message objects if state changes are needed.
 *
 * @param {Array<{ messageId: string, state: string, [key: string]: unknown }>} messages
 * @param {boolean} receiverOnline
 * @returns {{ toStore: Array<object>, toDeliver: Array<object> }}
 */
function handleOfflineMessages(messages, receiverOnline) {
  if (!Array.isArray(messages)) return { toStore: [], toDeliver: [] };
  if (receiverOnline === true) {
    return { toStore: [], toDeliver: messages.filter(msg => hasValidMessageShape(msg) && msg.state === STATE_SENT) };
  }

  const toStore = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (!hasValidMessageShape(msg)) continue;
    if (msg.state === STATE_SENT) {
      toStore.push(msg);
    }
  }
  return { toStore, toDeliver: [] };
}

// ---------------------------------------------------------------------------
// Reconnection with Resync
// ---------------------------------------------------------------------------

/**
 * Computes missing messages for resync after network drop.
 * Client provides lastKnownSequence; server returns messages with sequenceNumber > lastKnownSequence.
 * Messages are sorted by sequenceNumber (ascending).
 *
 * Production guarantees:
 * - Deterministic: same input always produces same output
 * - Idempotent: safe to call multiple times (no side effects)
 * - Immutable: does not mutate input array or messages
 * - Defensive: handles invalid inputs gracefully
 *
 * @param {Array<{ conversationId: string, sequenceNumber?: number, [key: string]: unknown }>} allMessages
 * @param {string} conversationId
 * @param {number} lastKnownSequence - client's last known sequence number
 * @returns {Array<object>}
 */
function computeMissingMessages(allMessages, conversationId, lastKnownSequence) {
  if (!Array.isArray(allMessages)) return [];
  if (!isNonEmptyString(conversationId)) return [];
  if (!isSafeNonNegativeInteger(lastKnownSequence)) return [];

  const result = [];
  const seenMessageIds = new Set();

  for (let i = 0; i < allMessages.length; i++) {
    const msg = allMessages[i];
    if (!hasValidMessageShape(msg)) continue;
    if (msg.conversationId !== conversationId) continue;
    const seq = getSequenceNumber(msg);
    if (seq === -1) continue;
    if (seq <= lastKnownSequence) continue;

    // Deduplicate by messageId (defensive: handle duplicate messages in array)
    if (typeof msg.messageId === 'string' && msg.messageId.length > 0) {
      if (seenMessageIds.has(msg.messageId)) continue;
      seenMessageIds.add(msg.messageId);
    }

    result.push(msg);
  }

  // Sort by sequenceNumber (ascending) for ordered delivery
  result.sort((a, b) => {
    const seqA = getSequenceNumber(a);
    const seqB = getSequenceNumber(b);
    return seqA - seqB;
  });

  return result;
}

/**
 * Resyncs messages for a conversation after reconnection.
 * Returns missing messages and messages that need delivery state reconciliation.
 *
 * Production guarantees:
 * - Deterministic: same input always produces same output
 * - Idempotent: safe to call multiple times (no side effects)
 * - Immutable: does not mutate input array or messages
 * - Consistent: reconciliation messages are deduplicated
 *
 * @param {Array<{ conversationId: string, sequenceNumber?: number, state: string, [key: string]: unknown }>} allMessages
 * @param {string} conversationId
 * @param {number} lastKnownSequence
 * @returns {{ missing: Array<object>, needsReconciliation: Array<object> }}
 */
function resyncConversation(allMessages, conversationId, lastKnownSequence) {
  if (!Array.isArray(allMessages)) return { missing: [], needsReconciliation: [] };
  if (!isNonEmptyString(conversationId)) return { missing: [], needsReconciliation: [] };
  if (!isSafeNonNegativeInteger(lastKnownSequence)) return { missing: [], needsReconciliation: [] };

  const missing = computeMissingMessages(allMessages, conversationId, lastKnownSequence);
  const needsReconciliation = [];
  const seenMessageIds = new Set();

  // Messages that client might have but need state updates (e.g., delivered -> read)
  // Only include messages client has seen (seq <= lastKnownSequence) but state may have advanced
  for (let i = 0; i < allMessages.length; i++) {
    const msg = allMessages[i];
    if (!hasValidMessageShape(msg)) continue;
    if (msg.conversationId !== conversationId) continue;
    const seq = getSequenceNumber(msg);
    if (seq === -1 || seq > lastKnownSequence) continue;

    // Deduplicate by messageId
    if (typeof msg.messageId === 'string' && msg.messageId.length > 0) {
      if (seenMessageIds.has(msg.messageId)) continue;
      seenMessageIds.add(msg.messageId);
    }

    // If message is delivered or read, client might need state update
    if (msg.state === STATE_DELIVERED || msg.state === STATE_READ) {
      needsReconciliation.push(msg);
    }
  }

  return { missing, needsReconciliation };
}

// ---------------------------------------------------------------------------
// Delivery State Reconciliation
// ---------------------------------------------------------------------------

/**
 * Reconciles delivery state for messages after reconnection.
 * Compares client's known states with server's states and returns updates needed.
 * Returns { updates: Array<{ messageId, currentState, targetState }> }.
 *
 * Production guarantees:
 * - Deterministic: same input always produces same output
 * - Idempotent: safe to call multiple times (no side effects)
 * - Immutable: does not mutate input arrays or messages
 * - Backward-transition-safe: only allows forward state transitions (SENT -> DELIVERED -> READ)
 * - Defensive: handles invalid states gracefully
 *
 * @param {Array<{ messageId: string, state: string, [key: string]: unknown }>} serverMessages
 * @param {Array<{ messageId: string, state: string, [key: string]: unknown }>} clientMessages
 * @returns {{ updates: Array<{ messageId: string, currentState: string, targetState: string }> }}
 */
function reconcileDeliveryState(serverMessages, clientMessages) {
  if (!Array.isArray(serverMessages) || !Array.isArray(clientMessages)) {
    return { updates: [] };
  }

  const clientStateMap = new Map();
  for (let i = 0; i < clientMessages.length; i++) {
    const msg = clientMessages[i];
    if (msg && typeof msg === 'object' && typeof msg.messageId === 'string' && msg.messageId.length > 0) {
      const state = typeof msg.state === 'string' ? msg.state : STATE_SENT;
      // Only store valid delivery states
      if (state === STATE_SENT || state === STATE_DELIVERED || state === STATE_READ) {
        clientStateMap.set(msg.messageId, state);
      }
    }
  }

  const updates = [];
  const seenMessageIds = new Set();

  for (let i = 0; i < serverMessages.length; i++) {
    const serverMsg = serverMessages[i];
    if (!hasValidMessageShape(serverMsg)) continue;
    if (typeof serverMsg.messageId !== 'string' || serverMsg.messageId.length === 0) continue;

    // Deduplicate
    if (seenMessageIds.has(serverMsg.messageId)) continue;
    seenMessageIds.add(serverMsg.messageId);

    const clientState = clientStateMap.get(serverMsg.messageId);
    if (clientState === undefined) continue;

    const serverState = serverMsg.state;

    // Only process valid delivery states
    const validStates = [STATE_SENT, STATE_DELIVERED, STATE_READ];
    if (!validStates.includes(serverState) || !validStates.includes(clientState)) continue;

    // State order: SENT (0) -> DELIVERED (1) -> READ (2)
    const stateOrder = { [STATE_SENT]: 0, [STATE_DELIVERED]: 1, [STATE_READ]: 2 };
    const serverOrder = stateOrder[serverState];
    const clientOrder = stateOrder[clientState];

    // Only allow forward transitions (server state ahead of client)
    if (serverOrder > clientOrder) {
      updates.push({
        messageId: serverMsg.messageId,
        currentState: clientState,
        targetState: serverState,
      });
    }
    // If states are equal or client is ahead, no update needed (idempotent)
  }

  return { updates };
}

/**
 * Fetches missed messages for a receiver after reconnection.
 * Combines missing messages (sequence gap) and offline messages (state = SENT).
 *
 * Production guarantees:
 * - Deterministic: same input always produces same output
 * - Idempotent: safe to call multiple times (no side effects)
 * - Immutable: does not mutate input array or messages
 * - Deduplicated: same messageId appears only once
 * - Ordered: messages sorted by sequenceNumber (ascending)
 *
 * @param {Array<{ conversationId: string, sequenceNumber?: number, state: string, receiverId?: string, [key: string]: unknown }>} allMessages
 * @param {string} receiverId
 * @param {string} conversationId
 * @param {number} lastKnownSequence
 * @returns {Array<object>}
 */
function fetchMissedMessages(allMessages, receiverId, conversationId, lastKnownSequence) {
  if (!Array.isArray(allMessages)) return [];
  if (!isNonEmptyString(receiverId)) return [];
  if (!isNonEmptyString(conversationId)) return [];
  if (!isSafeNonNegativeInteger(lastKnownSequence)) return [];

  const missing = computeMissingMessages(allMessages, conversationId, lastKnownSequence);
  const offline = collectOfflineMessagesByConversation(allMessages, conversationId);

  // Combine and deduplicate by messageId (defensive: handle duplicates)
  const messageMap = new Map();
  for (let i = 0; i < missing.length; i++) {
    const msg = missing[i];
    if (msg && typeof msg === 'object' && typeof msg.messageId === 'string' && msg.messageId.length > 0) {
      messageMap.set(msg.messageId, msg);
    }
  }
  for (let i = 0; i < offline.length; i++) {
    const msg = offline[i];
    if (msg && typeof msg === 'object' && typeof msg.messageId === 'string' && msg.messageId.length > 0) {
      // Only include messages for this receiver
      if (msg.receiverId === receiverId) {
        // Prefer missing messages over offline (missing are newer)
        if (!messageMap.has(msg.messageId)) {
          messageMap.set(msg.messageId, msg);
        }
      }
    }
  }

  const result = Array.from(messageMap.values());
  // Sort by sequenceNumber (ascending) for ordered delivery
  result.sort((a, b) => {
    const seqA = getSequenceNumber(a);
    const seqB = getSequenceNumber(b);
    if (seqA === -1 && seqB === -1) return 0;
    if (seqA === -1) return 1;
    if (seqB === -1) return -1;
    return seqA - seqB;
  });

  return result;
}

module.exports = {
  // Original API
  handleOutgoingMessage,
  collectOfflineMessages,
  prepareForRedelivery,
  // Enhanced offline handling
  collectOfflineMessagesByConversation,
  handleOfflineMessages,
  // Resync
  computeMissingMessages,
  resyncConversation,
  fetchMissedMessages,
  // Reconciliation
  reconcileDeliveryState,
};
