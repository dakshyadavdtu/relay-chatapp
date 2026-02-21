'use strict';

/**
 * Tier-0.3: THIN handler. No DB access. Validate → call messageService.markDelivered → emit result.
 * MUST NOT touch DB or mutate delivery state; service owns all of that.
 */

const connectionManager = require('../connection/connectionManager');
const dbFailureHelper = require('../safety/dbFailureHelper');
const { sendToUserSocket, getOrLoadMessage } = require('../services/message.service');
const messageService = require('../../services/message.service');
const ErrorCodes = require('../../utils/errorCodes');
const logger = require('../../utils/logger');
const { transition, TRANSITION_EVENT } = require('../../utils/logger');

/**
 * Handle MESSAGE_DELIVERED_CONFIRM: validate, call messageService.markDelivered, emit returned result.
 */
async function handleMessageDeliveredConfirm(ws, payload, context = {}) {
  const correlationId = context.correlationId || null;
  const userId = connectionManager.getUserId(ws);
  if (!userId) {
    return { type: 'MESSAGE_ERROR', error: 'Not authenticated', code: ErrorCodes.AUTH_REQUIRED };
  }

  const { messageId } = payload;
  if (!messageId) {
    return { type: 'MESSAGE_ERROR', error: 'messageId is required', code: ErrorCodes.INVALID_PAYLOAD };
  }

  const msgData = await getOrLoadMessage(messageId);
  if (!msgData) {
    return { type: 'MESSAGE_ERROR', error: 'Message not found', code: ErrorCodes.MESSAGE_NOT_FOUND, messageId };
  }

  if (msgData.recipientId !== userId) {
    return {
      type: 'MESSAGE_ERROR',
      error: 'Not authorized to confirm delivery of this message',
      code: ErrorCodes.NOT_AUTHORIZED,
      messageId,
    };
  }

  try {
    const result = await messageService.markDelivered(messageId, userId, { correlationId });

    if (!result.ok) {
      return {
        type: 'MESSAGE_ERROR',
        error: result.error || 'Delivery confirmation failed',
        code: result.code || ErrorCodes.INVALID_TRANSITION,
        messageId: result.messageId || messageId,
        currentState: result.currentState,
      };
    }

    dbFailureHelper.resetDbFailureCount(ws);

    if (result.senderNotification) sendToUserSocket(msgData.senderId, result.senderNotification, { correlationId });
    if (result.senderStateUpdate) sendToUserSocket(msgData.senderId, result.senderStateUpdate, { correlationId });

    return result.recipientResponse;
  } catch (updateError) {
    const failureInfo = dbFailureHelper.recordDbFailure(ws);
    if (failureInfo.shouldDegrade) {
      dbFailureHelper.closeAbusiveConnection(ws, 'Excessive DB failures', 1011);
    }
    return {
      type: 'MESSAGE_ERROR',
      error: 'Failed to update message state',
      code: ErrorCodes.PERSISTENCE_ERROR,
      messageId,
      details: updateError.message,
    };
  }
}

module.exports = {
  handleMessageDeliveredConfirm,
};
