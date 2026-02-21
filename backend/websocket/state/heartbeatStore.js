'use strict';

/**
 * Tier-1.3: Sole owner of heartbeat state.
 * Encapsulates aliveMap WeakMap.
 * Only this module may mutate the store.
 */

const aliveMap = new WeakMap();

/**
 * Set socket alive status
 * @param {WebSocket} ws - WebSocket connection
 * @param {boolean} alive - Alive status
 */
function setAlive(ws, alive) {
  aliveMap.set(ws, alive);
}

/**
 * Get socket alive status
 * @param {WebSocket} ws - WebSocket connection
 * @returns {boolean|undefined} Alive status or undefined
 */
function getAlive(ws) {
  return aliveMap.get(ws);
}

module.exports = {
  setAlive,
  getAlive,
};
