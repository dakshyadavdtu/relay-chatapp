'use strict';

/**
 * Tier-3: Chat history service — paginated, queryable history.
 * HTTP-owned: works without WebSocket, survives server restarts.
 */

const messageStore = require('./message.store');
const roomManager = require('../websocket/state/roomManager');
const { toApiShape } = require('../models/Message.model');
const { toRoomId } = require('../utils/chatId');

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 50;
const MIN_PAGE_SIZE = 1;

/**
 * Generate chatId for direct messages
 * Ensures consistent chatId regardless of sender/recipient order
 * @param {string} userId1 - First user ID
 * @param {string} userId2 - Second user ID
 * @returns {string} Consistent chatId
 */
function generateDirectChatId(userId1, userId2) {
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
 * Validate that user belongs to chat
 * @param {string} chatId - Chat ID (direct:u1:u2 for DM, or room:<roomId> for room)
 * @param {string} userId - User ID
 * @returns {boolean} True if user is participant
 */
function validateChatOwnership(chatId, userId) {
  if (!chatId || userId == null || userId === '') {
    return false;
  }
  const uid = typeof userId === 'string' ? userId.trim() : String(userId);

  const isDirect = chatId.startsWith('direct:');
  if (isDirect) {
    const participants = parseDirectChatId(chatId);
    return participants !== null && (participants.includes(uid) || participants.includes(userId));
  }

  if (chatId.startsWith('room:')) {
    const roomId = toRoomId(chatId);
    return roomId !== null && roomManager.isRoomMember(roomId, uid);
  }
  const roomId = toRoomId(chatId);
  return roomId !== null && roomManager.isRoomMember(roomId, uid);
}

/**
 * Filter messages by chatId
 * For direct chats: filters by senderId/recipientId pair
 * @param {Array<Object>} messages - Array of message objects
 * @param {string} chatId - Chat ID
 * @param {string} userId - Current user ID
 * @returns {Array<Object>} Filtered messages
 */
function filterMessagesByChatId(messages, chatId, userId) {
  if (!chatId) {
    return messages; // No chatId filter - return all (backward compatibility)
  }

  const isDirect = chatId.startsWith('direct:');
  if (isDirect) {
    const participants = parseDirectChatId(chatId);
    if (!participants || !participants.includes(userId)) {
      return []; // User not in chat
    }

    const otherParticipant = participants.find(id => id !== userId);
    if (!otherParticipant) {
      return [];
    }

    // Filter: messages where (senderId, recipientId) matches chat participants.
    // Exclude room messages: getMessagesForRecipient returns all messages for recipient (including
    // room per-recipient rows), so room messages would otherwise appear in DM history.
    return messages.filter(msg => {
      if (msg.roomId) return false;
      const isFromOtherToUser = msg.senderId === otherParticipant && msg.recipientId === userId;
      const isFromUserToOther = msg.senderId === userId && msg.recipientId === otherParticipant;
      return isFromOtherToUser || isFromUserToOther;
    });
  }

  // Room: filter by resolved roomId (chatId may be room:<roomId> or legacy raw roomId)
  const roomId = toRoomId(chatId);
  if (!roomId) return [];
  return messages.filter(msg => msg.roomId === roomId);
}

/**
 * Get paginated chat history for a specific chat.
 * HTTP-owned: works without WebSocket, survives server restarts.
 * Cursor-based: use beforeId from previous response for next page.
 * @param {string} userId - Current user ID
 * @param {string} chatId - Chat ID (required)
 * @param {{ beforeId?: string, limit: number }} options - Pagination options
 * @returns {Promise<{ messages: Array<Object>, nextCursor: string|null, hasMore: boolean }>}
 */
async function getHistory(userId, chatId, options = {}) {
  // Validate inputs
  if (!userId || typeof userId !== 'string') {
    return { messages: [], nextCursor: null, hasMore: false };
  }

  if (!chatId || typeof chatId !== 'string') {
    return { messages: [], nextCursor: null, hasMore: false };
  }

  // Validate ownership
  if (!validateChatOwnership(chatId, userId)) {
    return { messages: [], nextCursor: null, hasMore: false };
  }

  // Enforce pagination: limit is required
  const limit = Math.min(
    MAX_PAGE_SIZE,
    Math.max(MIN_PAGE_SIZE, parseInt(options.limit, 10) || DEFAULT_PAGE_SIZE)
  );

  const isDirect = chatId.startsWith('direct:');
  let allMessages;

  if (isDirect) {
    const recipientMessages = await messageStore.getMessagesForRecipient(userId);
    let senderMessages = [];
    const participants = parseDirectChatId(chatId);
    const otherParticipant = participants ? participants.find(id => id !== userId) : null;
    if (otherParticipant) {
      senderMessages = await messageStore.getMessagesForRecipient(otherParticipant);
      senderMessages = senderMessages.filter(msg => msg.senderId === userId && msg.recipientId === otherParticipant);
    }
    allMessages = [...recipientMessages, ...senderMessages];
  } else {
    // Room: resolve roomId from chatId (room:<roomId> or legacy raw roomId)
    const roomId = toRoomId(chatId);
    if (!roomId) {
      allMessages = [];
    } else {
      allMessages = await messageStore.getMessagesByRoom(roomId);
    }
  }

  const chatMessages = filterMessagesByChatId(allMessages, chatId, userId);
  const isRoom = chatId.startsWith('room:');

  // Sort by timestamp descending (newest first)
  chatMessages.sort((a, b) => {
    if (b.timestamp !== a.timestamp) return b.timestamp - a.timestamp;
    return (b.roomMessageId || b.messageId || '').localeCompare(a.roomMessageId || a.messageId || '');
  });

  // Apply cursor pagination: beforeId is the cursor from previous response (messageId or roomMessageId for rooms)
  let startIndex = 0;
  if (options.beforeId && typeof options.beforeId === 'string') {
    const beforeId = options.beforeId.trim();
    const idx = chatMessages.findIndex(m =>
      m.messageId === beforeId || (m.roomMessageId && m.roomMessageId === beforeId)
    );
    startIndex = idx === -1 ? 0 : idx + 1;
  }

  // Get page
  const page = chatMessages.slice(startIndex, startIndex + limit);
  const hasMore = startIndex + limit < chatMessages.length;
  const lastInPage = page.length > 0 ? page[page.length - 1] : null;
  const nextCursor = hasMore && lastInPage
    ? (isRoom && lastInPage.roomMessageId ? lastInPage.roomMessageId : lastInPage.messageId)
    : null;

  // Room: delivery summary for sender's messages (so frontend can reconstruct roomDeliveryByRoomMessageId on refresh)
  let deliverySummaries = {};
  if (isRoom && page.length > 0) {
    const roomId = toRoomId(chatId);
    const members = roomManager.getRoomMembers(roomId) || [];
    const totalCountBase = members.filter((m) => m !== userId).length;
    const senderRoomMsgIds = [...new Set(page.filter((m) => m.senderId === userId && m.roomMessageId).map((m) => m.roomMessageId))];
    for (const rid of senderRoomMsgIds) {
      const ids = await messageStore.getDeliveredRecipientIdsForRoomMessage(rid);
      deliverySummaries[rid] = { deliveredCount: ids.length, totalCount: totalCountBase };
    }
  }

  return {
    messages: page.map((m) => {
      const shape = toApiShape(m);
      const summary = deliverySummaries[m.roomMessageId];
      return summary ? { ...shape, deliverySummary: summary } : shape;
    }).filter(Boolean),
    nextCursor,
    hasMore,
  };
}

module.exports = {
  getHistory,
  validateChatOwnership,
  generateDirectChatId,
  parseDirectChatId,
};
