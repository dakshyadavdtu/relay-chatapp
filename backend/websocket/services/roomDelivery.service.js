'use strict';

/**
 * Room delivery state service - sole interface for room delivery store.
 * Handlers must use this instead of deliveryStore directly.
 */

// MOVED IN PHASE 4 — OWNERSHIP ONLY: use canonical deliveryStore
const deliveryStore = require('../state/deliveryStore');

function recordDelivered(messageId) {
  deliveryStore.setDelivered(messageId);
}

function recordRead(messageId) {
  deliveryStore.setRead(messageId);
}

module.exports = {
  recordDelivered,
  recordRead,
};
