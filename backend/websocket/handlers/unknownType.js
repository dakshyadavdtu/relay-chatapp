'use strict';

/**
 * Handle unknown message type
 * @param {string} type - Received message type
 * @param {Object} context - Context object with correlationId
 * @returns {Object} Error response
 */
function handleUnknownType(type, context = {}) {
  return {
    type: 'ERROR',
    error: `Unknown message type: ${type}`,
    code: 'UNKNOWN_TYPE',
    receivedType: type,
  };
}

module.exports = {
  handleUnknownType,
};
