'use strict';

/**
 * HTTP chat history routes.
 * HTTP-owned: works without WebSocket, survives server restarts, survives reconnects.
 *
 * Routes (mounted at /api/chat):
 * - GET /api/chat?chatId=...&limit=...&beforeId=... - Paginated chat history
 * - GET /api/chat/:conversationId?limit=...&beforeId=... - Same, chatId from path
 *
 * chatId formats:
 * - direct:u1:u2 - DM history (user must be participant)
 * - room:<roomId> - Room history (user must be room member via validateChatOwnership)
 *
 * Response: { success, data: { chatId, messages, nextCursor, hasMore } }.
 * All routes require authentication. Pagination: limit required, beforeId optional.
 */

const express = require('express');
const historyController = require('../controllers/history.controller');
const { requireAuth } = require('../middleware/auth.middleware');

const router = express.Router();

// All history routes require authentication
router.use(requireAuth);

// GET /history - Get paginated chat history for a specific chat (query param)
router.get('/', historyController.getHistory);

// GET /history/:conversationId - Get paginated chat history for a specific chat (path param)
router.get('/:conversationId', historyController.getHistoryByPath);

module.exports = router;
