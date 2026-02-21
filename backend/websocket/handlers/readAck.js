'use strict';

/**
 * Tier-0.3: THIN handler. No DB access. Validate → call messageService.markRead → emit result.
 * MUST NOT touch DB or mutate delivery state; service owns all of that.
 */

const connectionManager = require('../connection/connectionManager');
const ErrorCodes = require('../../utils/errorCodes');
const dbFailureHelper = require('../safety/dbFailureHelper');
const { sendToUserSocket, getOrLoadMessage } = require('../services/message.service');
const messageService = require('../../services/message.service');

/**
 * Handle MESSAGE_READ: validate, call messageService.markRead, emit returned result.
 */
async function handleMessageRead(ws, payload, context = {}) {
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
      error: 'Not authorized to mark this message as read',
      code: ErrorCodes.NOT_AUTHORIZED,
      messageId,
    };
  }

  try {
    const result = await messageService.markRead(messageId, userId, { correlationId });

    if (!result.ok) {
      return {
        type: 'MESSAGE_ERROR',
        error: result.error || 'Read confirmation failed',
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

/**
 * Handle MESSAGE_READ_CONFIRM protocol message
 */
async function handleMessageReadConfirm(ws, payload, context = {}) {
  return handleMessageRead(ws, payload, context);
}

/**
 * Handle CLIENT_ACK (delivery/read receipts)
 * Delegates to message.service for DB-first ACK production.
 */
async function handleClientAck(ws, payload, context = {}) {
  const correlationId = context.correlationId || null;
  const userId = connectionManager.getUserId(ws);
  if (!userId) {
    return { type: 'ACK_ERROR', error: 'Not authenticated', code: ErrorCodes.AUTH_REQUIRED };
  }

  const { messageId, ackType } = payload;
  if (!messageId) {
    return { type: 'ACK_ERROR', error: 'messageId is required', code: ErrorCodes.INVALID_PAYLOAD };
  }

  const msgData = await getOrLoadMessage(messageId);
  if (!msgData) {
    return { type: 'ACK_ERROR', error: 'Message not found', code: ErrorCodes.MESSAGE_NOT_FOUND, messageId };
  }

  if (msgData.recipientId !== userId) {
    return {
      type: 'ACK_ERROR',
      error: 'Not authorized to acknowledge this message',
      code: ErrorCodes.NOT_AUTHORIZED,
      messageId,
    };
  }

  let result;
  if (ackType === 'delivered') {
    result = await messageService.markDelivered(messageId, userId, { correlationId });
  } else if (ackType === 'read') {
    result = await messageService.markRead(messageId, userId, { correlationId });
  } else {
    return {
      type: 'ACK_ERROR',
      error: 'Invalid ackType. Must be "delivered" or "read"',
      code: ErrorCodes.INVALID_ACK_TYPE,
      messageId,
    };
  }

  if (!result.ok) {
    return {
      type: 'ACK_ERROR',
      error: result.error || 'Acknowledgement failed',
      code: result.code || ErrorCodes.INVALID_TRANSITION,
      messageId: result.messageId || messageId,
      currentState: result.currentState,
    };
  }

  dbFailureHelper.resetDbFailureCount(ws);

  if (result.senderNotification) sendToUserSocket(msgData.senderId, result.senderNotification, { correlationId });
  if (result.senderStateUpdate) sendToUserSocket(msgData.senderId, result.senderStateUpdate, { correlationId });

  return result.clientAckResponse || result.recipientResponse;
}

module.exports = {
  handleMessageRead,
  handleMessageReadConfirm,
  handleClientAck,
};
