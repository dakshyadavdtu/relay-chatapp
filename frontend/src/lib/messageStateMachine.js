/**
 * Phase 5.2: Frontend message state machine.
 * Mirrors backend/models/message.state.js exactly.
 * States: sending → sent → delivered → read (terminal)
 */

export const MessageState = Object.freeze({
  SENDING: 'sending',
  SENT: 'sent',
  DELIVERED: 'delivered',
  READ: 'read',
});

/** Allowed transitions: current → [next]. sent → read allowed so tick updates when backend sends read and sender never got delivered. */
export const VALID_TRANSITIONS = Object.freeze({
  [MessageState.SENDING]: [MessageState.SENT],
  [MessageState.SENT]: [MessageState.DELIVERED, MessageState.READ],
  [MessageState.DELIVERED]: [MessageState.READ],
  [MessageState.READ]: [],
});

const STATE_ORDER = { sending: 1, sent: 2, delivered: 3, read: 4 };

/**
 * Check if a state transition is allowed.
 * @param {string} current - Current state
 * @param {string} next - Next state
 * @returns {boolean}
 */
export function isValidTransition(current, next) {
  const c = normalizeState(current);
  const n = normalizeState(next);
  if (!c || !n) return false;
  const allowed = VALID_TRANSITIONS[c];
  return Array.isArray(allowed) && allowed.includes(n);
}

/**
 * Normalize backend state to canonical form (lowercase).
 * Handles backend variants: SENT, sent, SENDING, sending, etc.
 * @param {string} state
 * @returns {string|null}
 */
export function normalizeState(state) {
  if (!state || typeof state !== 'string') return null;
  const s = state.trim().toLowerCase();
  if (Object.values(MessageState).includes(s)) return s;
  return null;
}

/**
 * Check if message is considered delivered or read (can send MESSAGE_READ).
 * @param {string} state
 * @returns {boolean}
 */
export function isDeliveredOrRead(state) {
  const s = normalizeState(state);
  return s === MessageState.DELIVERED || s === MessageState.READ;
}

/**
 * Determine if we should apply an incoming state update.
 * Returns the new state to set, or null if update should be ignored (stale).
 * @param {string} current - Current local state
 * @param {string} incoming - Incoming state from backend
 * @returns {string|null} New state to set, or null to ignore
 */
export function applyStateUpdate(current, incoming) {
  const c = normalizeState(current);
  const n = normalizeState(incoming);
  if (!n) return null;
  // No current state: accept incoming if valid
  if (!c) return n;
  // Same or already ahead: no change needed (idempotent)
  const co = STATE_ORDER[c];
  const no = STATE_ORDER[n];
  if (no <= co) return null;
  // Must be valid transition
  if (!isValidTransition(c, n)) return null;
  return n;
}
