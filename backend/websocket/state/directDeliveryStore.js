'use strict';

/**
 * MOVED IN STABILITY PASS — STATE OWNERSHIP FIX
 * Tier-0: Per-recipient delivery state storage for direct messages.
 * Owns all Map-based delivery state and timeout handles.
 * 
 * This store owns:
 * - Delivery records Map (messageId:recipientId -> delivery record)
 * - Sent timeout handles Map (messageId:recipientId -> timeoutId)
 * 
 * Business logic remains in services/delivery.service.js
 */

/** Delivery records: key(messageId, recipientId) -> delivery record */
const storeMap = new Map();

/** Timeout handles for SENT deliveries: key(messageId, recipientId) -> timeoutId */
const sentTimeouts = new Map();

/**
 * Generate key for delivery record
 * @param {string} messageId
 * @param {string} recipientId
 * @returns {string}
 */
function key(messageId, recipientId) {
  return `${messageId}:${recipientId}`;
}

/**
 * Get delivery record
 * @param {string} messageId
 * @param {string} recipientId
 * @returns {Object|null}
 */
function getDelivery(messageId, recipientId) {
  const k = key(messageId, recipientId);
  const record = storeMap.get(k);
  return record ? { ...record } : null;
}

/**
 * Set delivery record
 * @param {string} messageId
 * @param {string} recipientId
 * @param {Object} record
 */
function setDelivery(messageId, recipientId, record) {
  const k = key(messageId, recipientId);
  storeMap.set(k, record);
}

/**
 * Check if delivery record exists
 * @param {string} messageId
 * @param {string} recipientId
 * @returns {boolean}
 */
function hasDelivery(messageId, recipientId) {
  const k = key(messageId, recipientId);
  return storeMap.has(k);
}

/**
 * Get all delivery records for a message
 * @param {string} messageId
 * @returns {Array<Object>}
 */
function getDeliveriesForMessage(messageId) {
  const results = [];
  for (const [k, record] of storeMap) {
    if (record.messageId === messageId) {
      results.push({ ...record });
    }
  }
  return results;
}

/**
 * Get all delivery records (for iteration)
 * @returns {MapIterator}
 */
function getAllDeliveries() {
  return storeMap.entries();
}

/**
 * Set delivery timeout
 * @param {string} messageId
 * @param {string} recipientId
 * @param {number} timeoutId
 */
function setDeliveryTimeout(messageId, recipientId, timeoutId) {
  const k = key(messageId, recipientId);
  sentTimeouts.set(k, timeoutId);
}

/**
 * Clear delivery timeout
 * @param {string} messageId
 * @param {string} recipientId
 */
function clearDeliveryTimeout(messageId, recipientId) {
  const k = key(messageId, recipientId);
  const timeoutId = sentTimeouts.get(k);
  if (timeoutId) {
    clearTimeout(timeoutId);
    sentTimeouts.delete(k);
  }
}

/**
 * Get delivery timeout
 * @param {string} messageId
 * @param {string} recipientId
 * @returns {number|null}
 */
function getDeliveryTimeout(messageId, recipientId) {
  const k = key(messageId, recipientId);
  return sentTimeouts.get(k) || null;
}

/**
 * Delete delivery timeout (without clearing)
 * @param {string} messageId
 * @param {string} recipientId
 */
function deleteDeliveryTimeout(messageId, recipientId) {
  const k = key(messageId, recipientId);
  sentTimeouts.delete(k);
}

/**
 * Get all sent timeouts (for iteration)
 * @returns {MapIterator}
 */
function getAllSentTimeouts() {
  return sentTimeouts.entries();
}

module.exports = {
  getDelivery,
  setDelivery,
  hasDelivery,
  getDeliveriesForMessage,
  getAllDeliveries,
  setDeliveryTimeout,
  clearDeliveryTimeout,
  getDeliveryTimeout,
  deleteDeliveryTimeout,
  getAllSentTimeouts,
  key,
};
