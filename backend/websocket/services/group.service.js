'use strict';

/**
 * Group / room service.
 * Tier-2: Per-member delivery. N-way delivery with independent state per member.
 * Owns: room message idempotency, persistence, per-member send, delivery state.
 */

const roomManager = require('../state/roomManager');
const groupStore = require('../state/groupStore');
const roomDeliveryStore = require('../state/roomDeliveryStore');
// MOVED IN PHASE 4 — OWNERSHIP ONLY: use canonical deliveryStore
const deliveryStore = require('../state/deliveryStore');
const connectionManager = require('../connection/connectionManager');
const socketSafety = require('../safety/socketSafety');
const messageService = require('../../services/message.service');
const { sendToUserSocket } = require('./message.service');
const logger = require('../../utils/logger');
const monitoring = require('../../utils/monitoring');

function generateMessageId() {
  return `rm_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Tier-2: Per-member send to ALL sockets (tabs/devices) for that member.
 * Skips originSocket when provided (so sender tab does not receive its own broadcast).
 * Returns number of sockets the message was queued to.
 */
function sendToMember(memberId, messageId, payload, context = {}) {
  const originSocket = context.originSocket || null;
  const sockets = connectionManager.getSockets(memberId);
  if (sockets.length > 1) {
    logger.info('GroupService', 'room_broadcast_multi_socket', { userId: memberId, socketCount: sockets.length });
  }
  let queuedCount = 0;
  for (const ws of sockets) {
    if (originSocket && ws === originSocket) continue;
    const connectionId = ws._socket ? `${ws._socket.remoteAddress}:${ws._socket.remotePort}` : null;
    const messageContext = {
      ...context,
      messageId,
      userId: memberId,
      connectionId,
    };
    const result = socketSafety.sendMessage(ws, payload, messageContext);
    if (result.shouldClose) {
      socketSafety.closeAbusiveConnection(ws, 'Slow consumer: queue overflow', 1008);
      continue;
    }
    if (result.queued) {
      queuedCount += 1;
    }
  }
  if (queuedCount > 0) {
    deliveryStore.setSent(messageId);
  }
  return queuedCount;
}

/**
 * Send room message: persist per recipient, per-member send, mark SENT per member.
 *
 * Regression: do NOT use getSocket(userId) for broadcast.
 * A user may have multiple active sockets (multiple tabs/devices).
 * Always broadcast to ALL sockets via getSockets(userId).
 *
 * @param {string} userId - Sender
 * @param {string} roomId
 * @param {string} content
 * @param {string} [clientMessageId]
 * @param {string} [messageType]
 * @param {Object} [context] - Context object with correlationId
 * @returns {Promise<Object>} ROOM_MESSAGE_RESPONSE
 */
async function sendRoomMessage(userId, roomId, content, clientMessageId, messageType, context = {}) {
  const correlationId = context.correlationId || null;
  if (clientMessageId) {
    const key = `${userId}:${roomId}:${clientMessageId}`;
    const existing = groupStore.getRoomIdempotency(key);
    if (existing) {
      return {
        type: 'ROOM_MESSAGE_RESPONSE',
        success: true,
        roomId,
        roomMessageId: existing.roomMessageId,
        messageIds: existing.messageIds,
        duplicate: true,
      };
    }
  }

  const roomMessageId = generateMessageId();
  const timestamp = Date.now();
  const members = roomManager.getRoomMembers(roomId);
  const messageIds = [];
  let sentCount = 0;

  try {
    await messageService.persistRoomMessageCanonical({
      roomId,
      roomMessageId,
      senderId: userId,
      content,
      timestamp,
      clientMessageId,
    });
  } catch (err) {
    logger.error('GroupService', 'room_message_canonical_persist_failed', { correlationId, roomId, userId, error: err.message });
  }

  const totalRecipients = members.filter((m) => m !== userId).length;
  roomDeliveryStore.setTotal(roomMessageId, roomId, userId, totalRecipients);

  const originSocket = context.originSocket || null;
  for (const memberId of members) {
    const messageId = `rm_${roomMessageId}_${memberId}`;
    messageIds.push(messageId);
    try {
      await messageService.persistRoomMessageForRecipient({
        messageId,
        senderId: userId,
        recipientId: memberId,
        content,
        timestamp,
        roomId,
        roomMessageId,
        messageType: 'room',
      });
    } catch (err) {
      logger.error('GroupService', 'room_message_persist_failed', { correlationId, roomId, userId, error: err.message });
    }

    const payload = {
      type: 'ROOM_MESSAGE',
      messageId,
      roomId,
      roomMessageId,
      senderId: userId,
      content,
      timestamp,
      messageType: messageType || 'text',
    };

    const socketsSent = sendToMember(memberId, messageId, payload, {
      correlationId,
      originSocket: memberId === userId ? originSocket : null,
    });
    sentCount += socketsSent;

    if (memberId !== userId && socketsSent > 0) {
      const { complete, deliveredCount, totalCount } = roomDeliveryStore.recordDelivery(roomMessageId, roomId, userId, memberId, totalRecipients);
      if (complete) {
        sendToUserSocket(userId, {
          type: 'ROOM_DELIVERY_UPDATE',
          roomId,
          roomMessageId,
          deliveredCount,
          totalCount,
        }, { correlationId, messageId: roomMessageId });
      }
    }
  }

  monitoring.increment('rooms', 'messages');

  logger.info('GroupService', 'room_message_broadcast_result', { roomId, recipientsSockets: sentCount });

  if (clientMessageId) {
    groupStore.setRoomIdempotency(`${userId}:${roomId}:${clientMessageId}`, { roomMessageId, messageIds });
  }

  logger.info('GroupService', 'room_message_sent', { correlationId, roomId, userId, sentCount, memberCount: members.length });

  return {
    type: 'ROOM_MESSAGE_RESPONSE',
    success: true,
    roomId,
    roomMessageId,
    messageIds,
    sentCount,
    memberCount: members.length,
    timestamp,
  };
}

module.exports = {
  sendRoomMessage,
  roomManager,
};
