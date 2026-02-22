'use strict';

/**
 * HTTP chat metadata controller.
 * HTTP owns chat structure (list, participants, unread counts).
 * 
 * This controller:
 * - Returns chat list for authenticated user
 * - Returns chat participants
 * - Calculates unread counts from DB
 * - Does NOT return messages (that's history endpoint)
 * - Does NOT return delivery/read transitions (that's WebSocket)
 * - Does NOT return typing/presence (that's WebSocket)
 * - May query DB directly
 * - May NOT emit WebSocket events
 * 
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * ARCHITECTURAL BOUNDARIES
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 
 * HTTP OWNS:
 * - Chat list (structure)
 * - Chat participants (metadata)
 * - Unread counts (DB-based)
 * 
 * HTTP DOES NOT OWN:
 * - Messages (that's history endpoint for past, WebSocket for real-time)
 * - Delivery/read transitions (WebSocket owns state transitions)
 * - Typing indicators (WebSocket owns typing)
 * - Presence state (WebSocket owns presence)
 * - Real-time updates (WebSocket owns real-time)
 * 
 * FORBIDDEN:
 * - Emitting WebSocket events
 * - Querying websocket/state/* stores
 * - Importing from websocket/ directories
 * 
 * See: http/README.md for full contract.
 */

const messageStore = require('../../services/message.store');
const messageService = require('../../services/message.service');
const deliveryService = require('../../services/delivery.service');
const readCursorStore = require('../../chat/readCursorStore.mongo');
const { MAX_CONTENT_LENGTH } = require('../../config/constants');
const { attemptRealtimeDelivery } = require('../../services/delivery.trigger');
const redisBus = require('../../services/redisBus');
const { sendError, sendSuccess } = require('../../utils/errorResponse');
const { toApiMessage } = require('../../utils/apiShape');

/**
 * Send a message (HTTP wrapper around message service)
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 */
async function sendMessage(req, res) {
  const userId = req.user?.userId;

  if (!userId) {
    return sendError(res, 401, 'Not authenticated', 'UNAUTHORIZED');
  }

  const { recipientId, content, clientMessageId } = req.body;

  // Lightweight validation
  if (!recipientId || typeof recipientId !== 'string' || recipientId.trim().length === 0) {
    return sendError(res, 400, 'recipientId is required', 'INVALID_PAYLOAD');
  }

  if (!content || typeof content !== 'string' || content.trim().length === 0) {
    return sendError(res, 400, 'content is required and must be non-empty string', 'INVALID_PAYLOAD');
  }

  if (content.length > MAX_CONTENT_LENGTH) {
    return sendError(res, 400, `content exceeds maximum length of ${MAX_CONTENT_LENGTH} characters`, 'CONTENT_TOO_LONG');
  }

  if (userId === recipientId.trim()) {
    return sendError(res, 400, 'Cannot send message to yourself', 'INVALID_PAYLOAD');
  }

  try {
    // Accept incoming message (validates and deduplicates)
    const trimmedRecipientId = recipientId.trim();
    const intake = messageService.acceptIncomingMessage({
      senderId: userId,
      receiverId: trimmedRecipientId,
      clientMessageId,
      content: content.trim(),
    });

    if (!intake.ok) {
      if (intake.duplicate) {
        // Return existing message
        const existingMessage = intake.message;
        const apiMessage = toApiMessage(existingMessage);
        return sendSuccess(res, { message: apiMessage });
      }
      return sendError(res, 400, intake.error || 'Invalid payload', intake.code || 'INVALID_PAYLOAD');
    }

    // Persist and get ACK (ack has messageId, state, timestamp; not full message)
    const ack = await messageService.persistAndReturnAck(intake.message, { correlationId: null });

    // Build stable API message from intake + ack
    const { messageId, senderId, recipientId: recvId, content: msgContent } = intake.message;
    const builtMessage = {
      messageId: ack.messageId || messageId,
      senderId,
      recipientId: recvId,
      content: msgContent,
      timestamp: ack.timestamp,
      state: ack.state,
    };
    const apiMessage = toApiMessage(builtMessage);
    sendSuccess(res, { message: apiMessage }, 201);

    // Realtime: attempt delivery to recipient if online (same as WS handler)
    const receivePayload = {
      type: 'MESSAGE_RECEIVE',
      messageId: builtMessage.messageId,
      senderId: builtMessage.senderId,
      recipientId: builtMessage.recipientId,
      content: builtMessage.content,
      timestamp: builtMessage.timestamp,
      state: builtMessage.state,
    };
    attemptRealtimeDelivery(builtMessage.messageId, receivePayload, { correlationId: null });

    // Cross-instance: publish to Redis so other instances can deliver (fire-and-forget)
    try {
      redisBus.publishChatMessage({
        type: 'chat.message',
        originInstanceId: redisBus.getInstanceId(),
        messageId: builtMessage.messageId,
        recipientId: builtMessage.recipientId,
        senderId: builtMessage.senderId,
        ts: builtMessage.timestamp,
        receivePayload,
      }).catch(() => {});
    } catch (_) {}
  } catch (error) {
    console.error('Error sending message:', error);
    sendError(res, 500, 'Failed to send message', 'MESSAGE_SEND_ERROR');
  }
}

/**
 * Generate chatId for direct messages
 * Ensures consistent chatId regardless of sender/recipient order
 * @param {string} userId1 - First user ID
 * @param {string} userId2 - Second user ID
 * @returns {string} Consistent chatId
 */
function generateDirectChatId(userId1, userId2) {
  // Sort user IDs to ensure consistent chatId
  const sorted = [userId1, userId2].sort();
  return `direct:${sorted[0]}:${sorted[1]}`;
}

/**
 * Parse direct chatId to get participants
 * @param {string} chatId - Chat ID (format: "direct:userId1:userId2")
 * @returns {Array<string>|null} Array of user IDs or null if invalid
 */
function parseDirectChatId(chatId) {
  if (!chatId || !chatId.startsWith('direct:')) {
    return null;
  }
  const parts = chatId.split(':');
  if (parts.length !== 3) {
    return null;
  }
  return [parts[1], parts[2]];
}

/**
 * Resolve lastReadMessageId to a timestamp for unread comparison.
 * If message not found (purged), returns 0; caller can use cursor.lastReadAt as fallback.
 * @param {string} userId - Not used for lookup; for API consistency
 * @param {string} chatId - Not used for lookup
 * @param {string|null|undefined} lastReadMessageId
 * @returns {Promise<number>} Timestamp in ms, or 0 if null/unknown
 */
async function resolveLastReadTimestamp(userId, chatId, lastReadMessageId) {
  if (!lastReadMessageId || typeof lastReadMessageId !== 'string' || !lastReadMessageId.trim()) {
    return 0;
  }
  const msg = await messageStore.getById(lastReadMessageId.trim());
  return (msg && (msg.timestamp ?? msg.createdAt)) ? (msg.timestamp ?? msg.createdAt) : 0;
}

/**
 * Get unread count for a direct chat using DB-backed read cursor (timestamp after lastRead).
 * No message.state checks. If no cursor, lastReadTs = 0 => all incoming messages count as unread.
 * @param {string} chatId - Chat ID
 * @param {string} userId - User ID (recipient for unread)
 * @param {Object|null} cursor - { lastReadMessageId, lastReadAt } from readCursorStore
 * @param {Array<Object>} recipientMessages - Messages where user is recipient (avoid N+1)
 * @returns {Promise<number>} Unread count
 */
async function getUnreadCountWithCursor(chatId, userId, cursor, recipientMessages) {
  try {
    const isDirect = chatId.startsWith('direct:');
    if (!isDirect) return 0;

    const participants = parseDirectChatId(chatId);
    if (!participants || !participants.includes(userId)) return 0;

    const otherParticipant = participants.find(id => id !== userId);
    if (!otherParticipant) return 0;

    let lastReadTs = await resolveLastReadTimestamp(userId, chatId, cursor?.lastReadMessageId);
    if (lastReadTs === 0 && cursor?.lastReadAt != null) lastReadTs = cursor.lastReadAt;

    let unreadCount = 0;
    for (const message of recipientMessages) {
      if (message.senderId !== otherParticipant) continue;
      const ts = message.timestamp ?? message.createdAt ?? 0;
      if (ts > lastReadTs) unreadCount++;
    }
    return unreadCount;
  } catch (error) {
    console.error('Error calculating unread count:', error);
    return 0;
  }
}

/**
 * Get unread count for a single chat (fetches cursor and messages). Use for getChatById.
 * @param {string} chatId
 * @param {string} userId
 * @returns {Promise<number>}
 */
async function getUnreadCount(chatId, userId) {
  const cursor = await readCursorStore.getCursor(userId, chatId);
  const recipientMessages = await messageStore.getMessagesForRecipient(userId);
  return getUnreadCountWithCursor(chatId, userId, cursor, recipientMessages);
}

/**
 * Get last message preview for a chat (optional, for UI)
 * @param {string} chatId - Chat ID
 * @param {string} userId - User ID
 * @returns {Promise<Object|null>} Last message preview or null
 */
async function getLastMessagePreview(chatId, userId) {
  try {
    const isDirect = chatId.startsWith('direct:');
    
    if (isDirect) {
      const participants = parseDirectChatId(chatId);
      if (!participants || !participants.includes(userId)) {
        return null;
      }
      
      // Get all messages for this user (via messageStore service layer)
      const allMessages = await messageStore.getMessagesForRecipient(userId);
      
      // Find the other participant
      const otherParticipant = participants.find(id => id !== userId);
      if (!otherParticipant) {
        return null;
      }
      
      // Find last message from other participant (direct messages only; exclude room/group)
      const messagesFromOther = allMessages
        .filter(m => m.senderId === otherParticipant && !m.roomId && !m.groupId && !m.roomChatId)
        .sort((a, b) => b.timestamp - a.timestamp);
      
      if (messagesFromOther.length === 0) {
        return null;
      }
      
      const lastMessage = messagesFromOther[0];
      return {
        content: lastMessage.content,
        timestamp: lastMessage.timestamp,
        senderId: lastMessage.senderId,
      };
    }
    
    // Room chat - stub for now
    return null;
  } catch (error) {
    console.error('Error getting last message preview:', error);
    return null;
  }
}

/**
 * Get all chats for authenticated user
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 */
async function getChats(req, res) {
  const userId = req.user.userId;

  if (!userId) {
    return sendError(res, 401, 'Not authenticated', 'UNAUTHORIZED');
  }

  try {
    // Include both: conversations where user is recipient AND where user is sender (outgoing)
    const [recipientMessages, senderMessages] = await Promise.all([
      messageStore.getMessagesForRecipient(userId),
      messageStore.getMessagesForSender(userId),
    ]);
    const allMessages = [...recipientMessages, ...senderMessages];
    const directOnly = allMessages.filter(m => !m.roomId && !m.groupId && !m.roomChatId);

    // Build chat map: chatId -> { participants } (dedupe by chatId); direct messages only
    const chatMap = {};
    for (const message of directOnly) {
      const chatId = generateDirectChatId(message.senderId, message.recipientId);
      if (!chatMap[chatId]) {
        chatMap[chatId] = {
          chatId,
          participants: [message.senderId, message.recipientId],
          type: 'direct',
        };
      }
    }

    const chatIds = Object.keys(chatMap);
    const cursorMap = await readCursorStore.bulkGetCursors(userId, chatIds);

    // Last message per chat from direct messages only (room/group must not affect DM preview)
    const lastMessageByChat = {};
    for (const message of directOnly) {
      const chatId = generateDirectChatId(message.senderId, message.recipientId);
      const ts = message.timestamp ?? 0;
      if (!lastMessageByChat[chatId] || (lastMessageByChat[chatId].timestamp ?? 0) < ts) {
        lastMessageByChat[chatId] = {
          content: message.content,
          timestamp: message.timestamp,
          senderId: message.senderId,
        };
      }
    }

    const chats = [];
    for (const chatId of chatIds) {
      const chat = chatMap[chatId];
      const cursor = cursorMap.get(chatId) || null;
      const unreadCount = await getUnreadCountWithCursor(chatId, userId, cursor, recipientMessages);
      const lastMessage = lastMessageByChat[chatId] || await getLastMessagePreview(chatId, userId);

      chats.push({
        chatId: chat.chatId,
        type: chat.type,
        participants: chat.participants.filter(id => id !== userId),
        unreadCount,
        lastMessage: lastMessage || null,
      });
    }

    // Sort by last message timestamp (newest first), stable
    chats.sort((a, b) => {
      const aTime = (a.lastMessage && a.lastMessage.timestamp) ? a.lastMessage.timestamp : 0;
      const bTime = (b.lastMessage && b.lastMessage.timestamp) ? b.lastMessage.timestamp : 0;
      if (bTime !== aTime) return bTime - aTime;
      return (a.chatId || '').localeCompare(b.chatId || '');
    });

    sendSuccess(res, { chats });
  } catch (error) {
    console.error('Error fetching chats:', error);
    sendError(res, 500, 'Failed to fetch chats', 'CHAT_FETCH_ERROR');
  }
}

/**
 * Get specific chat metadata by chatId
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 */
async function getChatById(req, res) {
  const userId = req.user.userId;
  const { chatId } = req.params;

  if (!userId) {
    return sendError(res, 401, 'Not authenticated', 'UNAUTHORIZED');
  }

  if (!chatId || typeof chatId !== 'string') {
    return sendError(res, 400, 'Chat ID is required', 'INVALID_CHAT_ID');
  }

  try {
    const isDirect = chatId.startsWith('direct:');
    
    if (isDirect) {
      const participants = parseDirectChatId(chatId);
      
      if (!participants || !participants.includes(userId)) {
        return sendError(res, 403, 'Access denied to this chat', 'CHAT_ACCESS_DENIED');
      }

      const unreadCount = await getUnreadCount(chatId, userId);
      const lastMessage = await getLastMessagePreview(chatId, userId);

      sendSuccess(res, {
        chat: {
          chatId,
          type: 'direct',
          participants: participants.filter(id => id !== userId), // Exclude self
          unreadCount,
          lastMessage: lastMessage || null,
        },
      });
    } else {
      // Room chat - stub for now
      return sendError(res, 404, 'Chat not found', 'CHAT_NOT_FOUND');
    }
  } catch (error) {
    console.error('Error fetching chat:', error);
    sendError(res, 500, 'Failed to fetch chat', 'CHAT_FETCH_ERROR');
  }
}

/**
 * POST mark-read: mark messages in a direct chat as read up to lastReadMessageId (delivery store).
 * Kept for backward compatibility; prefer POST /:chatId/read for persistent cursor.
 */
async function markRead(req, res) {
  const userId = req.user?.userId;
  if (!userId) return sendError(res, 401, 'Not authenticated', 'UNAUTHORIZED');
  const { chatId } = req.params;
  const body = req.body || {};
  const lastReadMessageId = (body.lastReadMessageId || body.messageId || '').trim();
  if (!lastReadMessageId) return sendError(res, 400, 'lastReadMessageId or messageId is required', 'INVALID_PAYLOAD');
  if (!chatId || !chatId.startsWith('direct:')) return sendError(res, 400, 'Invalid chat ID', 'INVALID_CHAT_ID');
  const participants = parseDirectChatId(chatId);
  if (!participants || !participants.includes(userId)) return sendError(res, 403, 'Access denied to this chat', 'CHAT_ACCESS_DENIED');
  const otherParticipant = participants.find(id => id !== userId);
  if (!otherParticipant) return sendError(res, 400, 'Invalid direct chat', 'INVALID_CHAT_ID');
  try {
    const pivotMessage = await messageStore.getById(lastReadMessageId);
    if (!pivotMessage) return sendError(res, 404, 'Message not found', 'MESSAGE_NOT_FOUND');
    if (pivotMessage.senderId !== otherParticipant || pivotMessage.recipientId !== userId) {
      return sendError(res, 403, 'Not authorized to mark this message as read', 'NOT_AUTHORIZED');
    }
    const pivotTs = pivotMessage.timestamp ?? 0;
    const allMessages = await messageStore.getMessagesForRecipient(userId);
    const toMark = allMessages.filter((m) => m.senderId === otherParticipant && (m.timestamp ?? 0) <= pivotTs);
    for (const m of toMark) {
      const messageId = m.messageId || m.id;
      if (messageId) deliveryService.forceMarkAsRead(messageId, userId);
    }
    return sendSuccess(res, { ok: true });
  } catch (error) {
    console.error('Error marking chat read:', error);
    return sendError(res, 500, 'Failed to mark as read', 'MARK_READ_ERROR');
  }
}

/**
 * POST read: persist read cursor for a direct chat (DB-backed; unread survives refresh/restart).
 * Body: { lastReadMessageId: string }. Validates message belongs to chat and user is participant.
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 */
async function markChatRead(req, res) {
  const userId = req.user?.userId;
  if (!userId) return sendError(res, 401, 'Not authenticated', 'UNAUTHORIZED');

  const chatId = (req.params.chatId || '').trim();
  const body = req.body || {};
  const lastReadMessageId = (body.lastReadMessageId || body.messageId || '').trim();
  if (!lastReadMessageId) {
    return sendError(res, 400, 'lastReadMessageId is required', 'INVALID_PAYLOAD');
  }

  if (!chatId || !chatId.startsWith('direct:')) {
    return sendError(res, 400, 'Invalid chat ID', 'INVALID_CHAT_ID');
  }

  const participants = parseDirectChatId(chatId);
  if (!participants || !participants.includes(userId)) {
    return sendError(res, 403, 'Access denied to this chat', 'CHAT_ACCESS_DENIED');
  }

  try {
    const [recipientMessages, senderMessages] = await Promise.all([
      messageStore.getMessagesForRecipient(userId),
      messageStore.getMessagesForSender(userId),
    ]);
    const combined = [...recipientMessages, ...senderMessages];
    const message = combined.find(
      (m) => (m.messageId || m.id) === lastReadMessageId
    );
    if (!message) {
      return sendError(res, 400, 'Message not found or not in this chat', 'INVALID_MESSAGE_ID');
    }
    const msgChatId = generateDirectChatId(message.senderId, message.recipientId);
    if (msgChatId !== chatId) {
      return sendError(res, 403, 'Message does not belong to this chat', 'NOT_AUTHORIZED');
    }

    const lastReadAt = message.timestamp ?? message.createdAt ?? Date.now();
    await readCursorStore.upsertCursor(userId, chatId, lastReadMessageId, lastReadAt);
    if (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test') {
      console.debug('[readCursor] upserted', { userId, chatId, messageId: lastReadMessageId, ts: lastReadAt });
    }
    return sendSuccess(res, { ok: true });
  } catch (error) {
    console.error('Error persisting read cursor:', error);
    return sendError(res, 500, 'Failed to update read cursor', 'MARK_READ_ERROR');
  }
}

module.exports = {
  sendMessage,
  getChats,
  getChatById,
  markRead,
  markChatRead,
};
