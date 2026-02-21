'use strict';

/**
 * Standardized error response helper.
 * Ensures consistent error format across all endpoints.
 */

/**
 * Send standardized error response.
 * @param {Object} res - Express response
 * @param {number} status - HTTP status code
 * @param {string} message - Error message
 * @param {string} code - Error code
 */
function sendError(res, status, message, code) {
  res.status(status).json({
    success: false,
    error: message,
    code: code || 'ERROR',
  });
}

/**
 * Send standardized success response.
 * @param {Object} res - Express response
 * @param {number} status - HTTP status code (default 200)
 * @param {*} data - Response data
 */
function sendSuccess(res, data, status = 200) {
  res.status(status).json({
    success: true,
    data,
  });
}

module.exports = {
  sendError,
  sendSuccess,
};
