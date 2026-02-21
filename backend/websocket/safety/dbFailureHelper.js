'use strict';

/**
 * Tier-1: Handlers must not call socketSafety directly.
 * This helper provides DB failure tracking; handlers use this instead.
 */

const socketSafety = require('./socketSafety');

function resetDbFailureCount(ws) {
  return socketSafety.resetDbFailureCount(ws);
}

function recordDbFailure(ws) {
  return socketSafety.recordDbFailure(ws);
}

function closeAbusiveConnection(ws, reason, code) {
  return socketSafety.closeAbusiveConnection(ws, reason, code);
}

module.exports = {
  resetDbFailureCount,
  recordDbFailure,
  closeAbusiveConnection,
};
