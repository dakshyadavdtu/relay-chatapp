'use strict';

/**
 * HTTP chat history controller.
 * HTTP-owned: works without WebSocket, survives server restarts, survives reconnects.
 * 
 * This controller:
 * - Enforces authentication (via requireAuth middleware)
 * - Enforces pagination (limit required, cursor optional)
 * - Enforces ownership validation (user must belong to chat)
 * - Queries DB directly (no in-memory state dependency)
 * 
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * ARCHITECTURAL BOUNDARIES
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 
 * HTTP OWNS:
 * - Historical messages (paginated, DB-based)
 * - Past chat history (survives restarts)
 * 
 * HTTP DOES NOT OWN:
 * - Real-time message delivery (WebSocket owns real-time)
 * - Delivery/read state transitions (WebSocket owns state)
 * - Message sending (WebSocket owns sending)
 * - In-memory message state (WebSocket owns real-time state)
 * 
 * REQUIREMENTS:
 * - MUST work without WebSocket connection
 * - MUST work after server restart
 * - MUST work after reconnect
 * - MUST query DB only (no in-memory state)
 * 
 * FORBIDDEN:
 * - Emitting WebSocket events
 * - Querying websocket/state/* stores
 * - Depend on active WebSocket connections
 * 
 * See: http/README.md for full contract.
 */

const logger = require('../../utils/logger');
const historyService = require('../../services/history.service');
const { sendError, sendSuccess } = require('../../utils/errorResponse');
const { toApiMessage } = require('../../utils/apiShape');
const { toRoomId } = require('../../utils/chatId');
const roomManager = require('../../websocket/state/roomManager');

/**
 * Get chat history for a specific chat
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 */
async function getHistory(req, res) {
  const userId = req.user?.userId ?? req.user?.id;
  const { chatId } = req.query;
  const { limit, beforeId } = req.query;

  // Validate authentication (should be handled by requireAuth middleware, but double-check)
  if (userId == null || userId === '') {
    return sendError(res, 401, 'Not authenticated', 'UNAUTHORIZED');
  }
  const uid = typeof userId === 'string' ? userId.trim() : String(userId);

  // Validate chatId (required)
  if (!chatId || typeof chatId !== 'string' || chatId.trim().length === 0) {
    return sendError(res, 400, 'chatId query parameter is required', 'INVALID_CHAT_ID');
  }
  const trimmedChatId = chatId.trim();

  // Validate ownership (room membership from roomManager persistent state, not connection)
  const { validateChatOwnership } = require('../../services/history.service');
  if (!validateChatOwnership(trimmedChatId, uid)) {
    const parsedRoomId = trimmedChatId.startsWith('room:') ? toRoomId(trimmedChatId) : null;
    const isMember = parsedRoomId ? roomManager.isRoomMember(parsedRoomId, uid) : false;
    const members = parsedRoomId && roomManager.getRoomMembers ? roomManager.getRoomMembers(parsedRoomId) : [];
    const memberIdsSample = Array.isArray(members) ? members.slice(0, 5) : [];
    logger.debug('History', 'chat_access_denied', { userId: uid, chatId: trimmedChatId, parsedRoomId, isMember, memberIdsSampleLength: memberIdsSample.length });
    return sendError(res, 403, 'Access denied to this chat', 'CHAT_ACCESS_DENIED');
  }

  // Enforce pagination: limit is required
  if (!limit) {
    return sendError(res, 400, 'limit query parameter is required', 'PAGINATION_REQUIRED');
  }

  const limitNum = parseInt(limit, 10);
  if (isNaN(limitNum) || limitNum < 1) {
    return sendError(res, 400, 'limit must be a positive number', 'INVALID_LIMIT');
  }

  try {
    const result = await historyService.getHistory(uid, trimmedChatId, {
      limit: limitNum,
      beforeId: beforeId && typeof beforeId === 'string' ? beforeId.trim() : undefined,
    });

    const apiMessages = result.messages.map((m) => {
      const out = toApiMessage(m);
      if (m.deliverySummary && typeof m.deliverySummary === 'object') {
        out.deliverySummary = m.deliverySummary;
      }
      return out;
    }).filter(Boolean);
    logger.debug('History', 'getHistory', { chatId: trimmedChatId, userId: uid, messageCount: apiMessages.length, hasMore: result.hasMore });

    sendSuccess(res, {
      chatId: trimmedChatId,
      messages: apiMessages,
      nextCursor: result.nextCursor,
      hasMore: result.hasMore,
    });
  } catch (err) {
    logger.error('History', 'getHistory_error', { error: err.message });
    sendError(res, 500, 'Failed to fetch history', 'HISTORY_ERROR');
  }
}

/**
 * Get chat history by path parameter (conversationId)
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 */
async function getHistoryByPath(req, res) {
  // Extract conversationId from path and set as chatId in query
  req.query.chatId = req.params.conversationId;
  // Delegate to getHistory
  return getHistory(req, res);
}

module.exports = {
  getHistory,
  getHistoryByPath,
};
