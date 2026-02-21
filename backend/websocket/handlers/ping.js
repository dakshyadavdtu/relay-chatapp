'use strict';

const config = require('../../config/constants');

/**
 * Handle PING message
 * @param {Object} context - Context object with correlationId
 * @returns {Object} PONG response
 */
function handlePing(context = {}) {
  return {
    type: 'PONG',
    timestamp: Date.now(),
    version: config.PROTOCOL_VERSION,
  };
}

module.exports = {
  handlePing,
};
