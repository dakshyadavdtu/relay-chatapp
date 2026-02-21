'use strict';

/**
 * MOVED IN PHASE 2 — NO LOGIC CHANGE
 * Message parsing and basic validation extracted from websocket/protocol/dispatcher.js verbatim
 * 
 * Parse and validate incoming message
 * @param {string|Buffer} data - Raw message data
 * @returns {{success: boolean, message?: Object, error?: string, code?: string}}
 */

const config = require('../../config/constants');
const ErrorCodes = require('../../utils/errorCodes');

function parseMessage(data) {
  try {
    // Handle Buffer
    const str = Buffer.isBuffer(data) ? data.toString('utf8') : data;
    
    if (typeof str !== 'string') {
      return { success: false, error: 'Invalid message format' };
    }

    const message = JSON.parse(str);

    if (!message || typeof message !== 'object') {
      return { success: false, error: 'Message must be a JSON object' };
    }

    if (!message.type) {
      return { success: false, error: 'Message type is required' };
    }

    // Skip per-message version check for HELLO (version is negotiated in HELLO)
    if (message.type !== 'HELLO' && message.version && message.version !== config.PROTOCOL_VERSION) {
      return {
        success: false,
        error: `Protocol version mismatch. Expected ${config.PROTOCOL_VERSION}, got ${message.version}`,
        code: ErrorCodes.VERSION_MISMATCH,
      };
    }

    return { success: true, message };
  } catch (err) {
    return { success: false, error: `JSON parse error: ${err.message}` };
  }
}

module.exports = {
  parseMessage,
};
