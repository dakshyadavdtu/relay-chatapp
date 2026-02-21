'use strict';

// LEAF MODULE — MUST NOT IMPORT ANYTHING — used to avoid router↔wsServer cycle

/**
 * WebSocket close codes (leaf module — no imports).
 * Used by router and wsServer to avoid circular dependency.
 * @enum {number}
 */
const CloseCodes = {
  NORMAL: 1000,
  GOING_AWAY: 1001,
  PROTOCOL_ERROR: 1002,
  UNSUPPORTED: 1003,
  INVALID_PAYLOAD: 1007,
  POLICY_VIOLATION: 1008,
  MESSAGE_TOO_BIG: 1009,
  INTERNAL_ERROR: 1011,
  // Custom codes (4000-4999)
  UNAUTHORIZED: 4001,
  TOKEN_EXPIRED: 4002,
  INVALID_TOKEN: 4003,
  RATE_LIMIT: 4008,
};

module.exports = { CloseCodes };
