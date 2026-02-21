'use strict';

/**
 * WebSocket inbound message schemas (zod).
 * Validates payload per message type before dispatch.
 * Aligned with CONTRACT.json incomingMessageTypes.
 */

const { z } = require('zod');
const { MAX_CONTENT_LENGTH } = require('../../config/constants');

const MAX_CONTENT = MAX_CONTENT_LENGTH;
const MAX_ROOM_NAME_LENGTH = 200;
const MAX_THUMBNAIL_URL_LENGTH = 2048;

// Payload schemas per type (validates { type, ...payload })
const payloadSchemas = {
  HELLO: z.object({
    type: z.literal('HELLO'),
    version: z.number().int(),
  }),
  MESSAGE_SEND: z.object({
    type: z.literal('MESSAGE_SEND'),
    recipientId: z.string().min(1, 'recipientId is required'),
    content: z.string().min(1, 'content is required').max(MAX_CONTENT, `content exceeds ${MAX_CONTENT} characters`),
    clientMessageId: z.string().optional(),
  }),
  MESSAGE_READ: z.object({
    type: z.literal('MESSAGE_READ'),
    messageId: z.string().min(1, 'messageId is required'),
  }),
  MESSAGE_READ_CONFIRM: z.object({
    type: z.literal('MESSAGE_READ_CONFIRM'),
    messageId: z.string().min(1, 'messageId is required'),
  }),
  MESSAGE_DELIVERED_CONFIRM: z.object({
    type: z.literal('MESSAGE_DELIVERED_CONFIRM'),
    messageId: z.string().min(1, 'messageId is required'),
  }),
  MESSAGE_REPLAY: z.object({
    type: z.literal('MESSAGE_REPLAY'),
    lastMessageId: z.string().optional(),
    limit: z.number().int().positive().optional(),
  }),
  STATE_SYNC: z.object({
    type: z.literal('STATE_SYNC'),
    lastMessageId: z.string().optional(),
    lastReadMessageId: z.string().optional(),
  }),
  RESUME: z.object({
    type: z.literal('RESUME'),
    lastSeenMessageId: z.string().optional(),
  }),
  PRESENCE_PING: z.object({
    type: z.literal('PRESENCE_PING'),
    status: z.enum(['online', 'away', 'busy', 'offline']).optional(),
  }),
  CLIENT_ACK: z.object({
    type: z.literal('CLIENT_ACK'),
    messageId: z.string().min(1, 'messageId is required'),
    ackType: z.enum(['delivered', 'read']).optional(),
  }),
  PING: z.object({
    type: z.literal('PING'),
  }),
  TYPING_START: z.object({
    type: z.literal('TYPING_START'),
    roomId: z.string().optional(),
    targetUserId: z.string().optional(),
  }),
  TYPING_STOP: z.object({
    type: z.literal('TYPING_STOP'),
    roomId: z.string().optional(),
    targetUserId: z.string().optional(),
  }),
  ROOM_CREATE: z
    .object({
      type: z.literal('ROOM_CREATE'),
      name: z.string().max(MAX_ROOM_NAME_LENGTH).optional(),
      thumbnailUrl: z.string().max(MAX_THUMBNAIL_URL_LENGTH).nullable().optional(),
      memberIds: z.array(z.string().min(1)).optional().default([]),
      correlationId: z.string().optional(),
      metadata: z.record(z.unknown()).optional(),
    })
    .passthrough(),
  ROOM_JOIN: z.object({
    type: z.literal('ROOM_JOIN'),
    roomId: z.string().min(1, 'roomId is required'),
    correlationId: z.string().optional(),
  }),
  ROOM_LEAVE: z.object({
    type: z.literal('ROOM_LEAVE'),
    roomId: z.string().min(1, 'roomId is required'),
    correlationId: z.string().optional(),
  }),
  ROOM_MESSAGE: z.object({
    type: z.literal('ROOM_MESSAGE'),
    roomId: z.string().min(1, 'roomId is required'),
    content: z.string().min(1, 'content is required').max(MAX_CONTENT, `content exceeds ${MAX_CONTENT} characters`),
    clientMessageId: z.string().optional(),
    messageType: z.string().optional(),
  }),
  ROOM_INFO: z.object({
    type: z.literal('ROOM_INFO'),
    roomId: z.string().min(1, 'roomId is required'),
    correlationId: z.string().optional(),
  }),
  ROOM_LIST: z.object({
    type: z.literal('ROOM_LIST'),
    includeAll: z.boolean().optional(),
    correlationId: z.string().optional(),
  }),
  ROOM_MEMBERS: z.object({
    type: z.literal('ROOM_MEMBERS'),
    roomId: z.string().min(1, 'roomId is required'),
    correlationId: z.string().optional(),
  }),
  ROOM_UPDATE_META: z.object({
    type: z.literal('ROOM_UPDATE_META'),
    roomId: z.string().min(1, 'roomId is required'),
    patch: z.object({
      name: z.string().max(MAX_ROOM_NAME_LENGTH).optional(),
      thumbnailUrl: z.string().max(MAX_THUMBNAIL_URL_LENGTH).nullable().optional(),
    }),
    correlationId: z.string().optional(),
  }),
  ROOM_ADD_MEMBERS: z.object({
    type: z.literal('ROOM_ADD_MEMBERS'),
    roomId: z.string().min(1, 'roomId is required'),
    userIds: z.array(z.string().min(1)).min(1, 'userIds must be non-empty'),
    correlationId: z.string().optional(),
  }),
  ROOM_REMOVE_MEMBER: z.object({
    type: z.literal('ROOM_REMOVE_MEMBER'),
    roomId: z.string().min(1, 'roomId is required'),
    userId: z.string().min(1, 'userId is required'),
    correlationId: z.string().optional(),
  }),
  ROOM_SET_ROLE: z.object({
    type: z.literal('ROOM_SET_ROLE'),
    roomId: z.string().min(1, 'roomId is required'),
    userId: z.string().min(1, 'userId is required'),
    role: z.enum(['ADMIN', 'MEMBER']),
    correlationId: z.string().optional(),
  }),
  ROOM_DELETE: z.object({
    type: z.literal('ROOM_DELETE'),
    roomId: z.string().min(1, 'roomId is required'),
    correlationId: z.string().optional(),
  }),
  // Message mutations (edit/delete) — inbound from client
  MESSAGE_EDIT: z.object({
    type: z.literal('MESSAGE_EDIT'),
    messageId: z.string().min(1, 'messageId is required'),
    content: z.string().min(1, 'content is required').max(MAX_CONTENT, `content exceeds ${MAX_CONTENT} characters`),
  }),
  MESSAGE_DELETE: z.object({
    type: z.literal('MESSAGE_DELETE'),
    messageId: z.string().min(1, 'messageId is required'),
  }),
  // Outbound (server → client) — for reference; not used for inbound validation
  MESSAGE_MUTATION: z.object({
    type: z.literal('MESSAGE_MUTATION'),
    action: z.enum(['edit', 'delete']),
    messageId: z.string().min(1),
    content: z.string().optional(),
    editedAt: z.number().nullable().optional(),
    deleted: z.boolean().optional(),
    deletedAt: z.number().nullable().optional(),
    senderId: z.string().min(1),
    recipientId: z.string().min(1),
  }),
  MESSAGE_MUTATION_ACK: z.object({
    type: z.literal('MESSAGE_MUTATION_ACK'),
    action: z.enum(['edit', 'delete']),
    messageId: z.string().min(1),
    success: z.boolean(),
    code: z.string().optional(),
    serverTs: z.number(),
    editedAt: z.number().nullable().optional(),
    deletedAt: z.number().nullable().optional(),
  }),
};

/**
 * Validate inbound message against schema for its type.
 * @param {Object} message - Parsed { type, ...payload }
 * @returns {{ ok: boolean, error?: string, details?: string }}
 */
function validatePayload(message) {
  if (!message || typeof message !== 'object') {
    return { ok: false, error: 'Invalid payload', details: 'Message must be an object' };
  }
  const type = message.type;
  if (!type || typeof type !== 'string') {
    return { ok: false, error: 'Invalid payload', details: 'Message type is required' };
  }

  const schema = payloadSchemas[type];
  if (!schema) {
    return { ok: true };
  }

  const result = schema.safeParse(message);
  if (result.success) {
    return { ok: true };
  }

  const err = result.error;
  const details = err.errors?.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ') || err.message;
  return {
    ok: false,
    error: 'Invalid payload',
    details,
  };
}

module.exports = {
  payloadSchemas,
  validatePayload,
};
