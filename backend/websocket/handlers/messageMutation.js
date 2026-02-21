'use strict';

/**
 * Handlers for MESSAGE_EDIT and MESSAGE_DELETE.
 * Resolve message via getOrLoadMessage; validate sender; persist via db adapter;
 * broadcast MESSAGE_MUTATION to sender and recipient; return MESSAGE_MUTATION_ACK to client.
 */

const connectionManager = require('../connection/connectionManager');
const { sendToUserSocket, getOrLoadMessage } = require('../services/message.service');
const dbAdapter = require('../../config/db');
const logger = require('../../utils/logger');
const MessageType = require('../protocol/types');

function ackFailure(action, messageId, code, correlationId) {
  const serverTs = Date.now();
  const id = messageId != null ? String(messageId) : '';
  logger.info('MessageMutation', `${action}_rejected`, {
    messageId: id || undefined,
    code,
    correlationId: correlationId || undefined,
  });
  return {
    type: MessageType.MESSAGE_MUTATION_ACK,
    action,
    messageId: id,
    success: false,
    code,
    serverTs,
  };
}

function ackSuccess(action, messageId, serverTs, extra = {}, correlationId) {
  logger.info('MessageMutation', `${action}_ok`, {
    messageId,
    correlationId: correlationId || undefined,
  });
  return {
    type: MessageType.MESSAGE_MUTATION_ACK,
    action,
    messageId,
    success: true,
    serverTs,
    ...extra,
  };
}

/**
 * Handle MESSAGE_EDIT: only sender may edit. Resolve message, validate, placeholder persist, broadcast MESSAGE_MUTATION, ACK.
 */
async function handleMessageEdit(ws, payload, context = {}) {
  const correlationId = context.correlationId || null;
  const userId = connectionManager.getUserId(ws);
  if (!userId) {
    return ackFailure('edit', payload?.messageId || null, 'UNAUTHORIZED', correlationId);
  }

  const { messageId, content } = payload;
  if (!messageId || content == null) {
    return ackFailure('edit', messageId || null, 'INVALID_PAYLOAD', correlationId);
  }

  const message = await getOrLoadMessage(messageId);
  if (!message) {
    return ackFailure('edit', messageId, 'NOT_FOUND', correlationId);
  }
  if (message.senderId !== userId) {
    return ackFailure('edit', messageId, 'FORBIDDEN', correlationId);
  }

  const serverTs = Date.now();
  const existingContent = String((message.content ?? '').trim());
  const newContent = String((content ?? '').trim());
  if (existingContent === newContent) {
    return ackSuccess('edit', messageId, serverTs, { editedAt: message.editedAt ?? serverTs }, correlationId);
  }

  const updated = await dbAdapter.editMessageContent(messageId, userId, content);
  if (!updated) {
    return ackFailure('edit', messageId, 'NOT_FOUND', correlationId);
  }
  const editedAt = updated.editedAt ?? serverTs;

  const mutationPayload = {
    type: MessageType.MESSAGE_MUTATION,
    action: 'edit',
    messageId,
    content: updated.content ?? content,
    editedAt,
    deleted: updated.deleted === true,
    deletedAt: updated.deletedAt ?? null,
    senderId: message.senderId,
    recipientId: message.recipientId,
    serverTs,
  };
  sendToUserSocket(message.senderId, mutationPayload, { correlationId });
  sendToUserSocket(message.recipientId, mutationPayload, { correlationId });

  return ackSuccess('edit', messageId, serverTs, { editedAt }, correlationId);
}

/**
 * Handle MESSAGE_DELETE: only sender may delete. Resolve message, validate, placeholder soft-delete, broadcast MESSAGE_MUTATION, ACK.
 */
async function handleMessageDelete(ws, payload, context = {}) {
  const correlationId = context.correlationId || null;
  const userId = connectionManager.getUserId(ws);
  if (!userId) {
    return ackFailure('delete', payload?.messageId || null, 'UNAUTHORIZED', correlationId);
  }

  const { messageId } = payload;
  if (!messageId) {
    return ackFailure('delete', null, 'INVALID_PAYLOAD', correlationId);
  }

  const message = await getOrLoadMessage(messageId);
  if (!message) {
    return ackFailure('delete', messageId, 'NOT_FOUND', correlationId);
  }
  if (message.senderId !== userId) {
    return ackFailure('delete', messageId, 'FORBIDDEN', correlationId);
  }

  const serverTs = Date.now();
  const updated = await dbAdapter.softDeleteMessage(messageId, userId);
  if (!updated) {
    return ackFailure('delete', messageId, 'NOT_FOUND', correlationId);
  }
  const deletedAt = updated.deletedAt ?? serverTs;

  const mutationPayload = {
    type: MessageType.MESSAGE_MUTATION,
    action: 'delete',
    messageId,
    content: undefined,
    editedAt: updated.editedAt ?? null,
    deleted: true,
    deletedAt,
    senderId: message.senderId,
    recipientId: message.recipientId,
    serverTs,
  };
  sendToUserSocket(message.senderId, mutationPayload, { correlationId });
  sendToUserSocket(message.recipientId, mutationPayload, { correlationId });

  return ackSuccess('delete', messageId, serverTs, { deletedAt }, correlationId);
}

module.exports = {
  handleMessageEdit,
  handleMessageDelete,
};
