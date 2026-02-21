'use strict';

/**
 * In-memory delivery failure metrics store.
 * Does not block message flow. Logs through logger.
 */

const logger = require('../utils/logger');

let deliveryFailuresTotal = 0;
let lastDeliveryFailureAt = null;

/**
 * Increment delivery failure counter and update last failure timestamp.
 * Non-blocking; logs through logger.
 * @param {string} reason - Failure reason (e.g. ACK_TIMEOUT, SOCKET_CLOSED, SEND_ERROR)
 * @param {string} [messageId] - Message ID
 * @param {string} [recipientId] - Recipient user ID
 */
function incrementDeliveryFailure(reason, messageId, recipientId) {
  deliveryFailuresTotal += 1;
  lastDeliveryFailureAt = Date.now();
  logger.info('DeliveryMetrics', 'delivery_failure', {
    reason,
    messageId: messageId || null,
    recipientId: recipientId || null,
    total: deliveryFailuresTotal,
    lastAt: lastDeliveryFailureAt,
  });
}

/**
 * Get current delivery failure metrics (read-only snapshot).
 * @returns {{ deliveryFailuresTotal: number, lastDeliveryFailureAt: number|null }}
 */
function getDeliveryMetrics() {
  return {
    deliveryFailuresTotal,
    lastDeliveryFailureAt,
  };
}

module.exports = {
  incrementDeliveryFailure,
  getDeliveryMetrics,
};
