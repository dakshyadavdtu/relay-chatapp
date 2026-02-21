'use strict';

/**
 * MOVED IN PHASE 4 — OWNERSHIP ONLY
 * Tier-2: Per-member delivery state for room messages.
 * Map<messageId, DeliveryState> where messageId = rm_roomMessageId_memberId.
 * Single source of truth for room message delivery FSM.
 * SENT -> DELIVERED -> READ (forward only).
 */

const DeliveryState = Object.freeze({
  SENT: 'SENT',
  DELIVERED: 'DELIVERED',
  READ: 'READ',
});

const stateOrder = { SENT: 1, DELIVERED: 2, READ: 3 };

const store = new Map();

function get(messageId) {
  return store.get(messageId) || null;
}

function set(messageId, state) {
  if (!messageId || !DeliveryState[state]) return;
  const current = store.get(messageId);
  const currentOrder = current ? stateOrder[current] : 0;
  const newOrder = stateOrder[state];
  if (newOrder >= currentOrder) {
    store.set(messageId, state);
  }
}

function setSent(messageId) {
  set(messageId, DeliveryState.SENT);
}

function setDelivered(messageId) {
  set(messageId, DeliveryState.DELIVERED);
}

function setRead(messageId) {
  set(messageId, DeliveryState.READ);
}

function isDeliveredOrRead(messageId) {
  const s = store.get(messageId);
  return s === DeliveryState.DELIVERED || s === DeliveryState.READ;
}

function getState(messageId) {
  return store.get(messageId) || null;
}

module.exports = {
  get,
  set,
  setSent,
  setDelivered,
  setRead,
  isDeliveredOrRead,
  getState,
  DeliveryState,
};
