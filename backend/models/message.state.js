'use strict';

/**
 * Tier-3: Message state machine.
 * States and allowed transitions. Must stay in sync with engines/messageEngine.js (Tier-1/2).
 */

const MessageState = {
  SENDING: 'sending',
  SENT: 'sent',
  DELIVERED: 'delivered',
  READ: 'read',
};

const VALID_TRANSITIONS = {
  [MessageState.SENDING]: [MessageState.SENT],
  [MessageState.SENT]: [MessageState.DELIVERED],
  [MessageState.DELIVERED]: [MessageState.READ],
  [MessageState.READ]: [],
};

/**
 * Check if a state transition is allowed
 * @param {string} current - Current state
 * @param {string} next - Next state
 * @returns {boolean}
 */
function isValidTransition(current, next) {
  const allowed = VALID_TRANSITIONS[current];
  return Array.isArray(allowed) && allowed.includes(next);
}

/**
 * Check if message is considered delivered (for offline queue: do not replay)
 * @param {string} state
 * @returns {boolean}
 */
function isDeliveredOrRead(state) {
  return state === MessageState.DELIVERED || state === MessageState.READ;
}

module.exports = {
  MessageState,
  VALID_TRANSITIONS,
  isValidTransition,
  isDeliveredOrRead,
};
