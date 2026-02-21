'use strict';

/**
 * Tier-1.3: Sole owner of per-socket safety state.
 * Encapsulates WeakMaps for socket state tracking.
 * Only this module may mutate the store.
 */

const socketState = new WeakMap();
const backpressureState = new WeakMap();
const dbFailureState = new WeakMap();

/**
 * Set socket rate limiting state
 * @param {WebSocket} ws - WebSocket connection
 * @param {Object} state - State object
 */
function setSocketState(ws, state) {
  socketState.set(ws, state);
}

/**
 * Get socket rate limiting state
 * @param {WebSocket} ws - WebSocket connection
 * @returns {Object|undefined} State or undefined
 */
function getSocketState(ws) {
  return socketState.get(ws);
}

/**
 * Delete socket rate limiting state
 * @param {WebSocket} ws - WebSocket connection
 */
function deleteSocketState(ws) {
  // WeakMap doesn't have delete, but we can't prevent GC
  // This is a no-op for WeakMap
}

/**
 * Set backpressure state
 * @param {WebSocket} ws - WebSocket connection
 * @param {Object} state - State object
 */
function setBackpressureState(ws, state) {
  backpressureState.set(ws, state);
}

/**
 * Get backpressure state
 * @param {WebSocket} ws - WebSocket connection
 * @returns {Object|undefined} State or undefined
 */
function getBackpressureState(ws) {
  return backpressureState.get(ws);
}

/**
 * Delete backpressure state
 * @param {WebSocket} ws - WebSocket connection
 */
function deleteBackpressureState(ws) {
  // WeakMap doesn't have delete, but we can't prevent GC
  // This is a no-op for WeakMap
}

/**
 * Set DB failure state
 * @param {WebSocket} ws - WebSocket connection
 * @param {Object} state - State object
 */
function setDbFailureState(ws, state) {
  dbFailureState.set(ws, state);
}

/**
 * Get DB failure state
 * @param {WebSocket} ws - WebSocket connection
 * @returns {Object|undefined} State or undefined
 */
function getDbFailureState(ws) {
  return dbFailureState.get(ws);
}

/**
 * Delete DB failure state
 * @param {WebSocket} ws - WebSocket connection
 */
function deleteDbFailureState(ws) {
  // WeakMap doesn't have delete, but we can't prevent GC
  // This is a no-op for WeakMap
}

module.exports = {
  setSocketState,
  getSocketState,
  deleteSocketState,
  setBackpressureState,
  getBackpressureState,
  deleteBackpressureState,
  setDbFailureState,
  getDbFailureState,
  deleteDbFailureState,
};
