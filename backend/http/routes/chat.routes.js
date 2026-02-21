'use strict';

/**
 * HTTP chat metadata routes.
 * HTTP owns chat structure (list, participants, unread counts).
 * 
 * Routes:
 * - GET /chats - List all chats for authenticated user
 * - GET /chats/:chatId - Get specific chat metadata
 * 
 * All routes require authentication.
 * Controllers may query DB but may NOT emit WebSocket events.
 */

const express = require('express');
const chatController = require('../controllers/chat.controller');
const { requireAuth } = require('../middleware/auth.middleware');

const router = express.Router();

// All chat routes require authentication
router.use(requireAuth);

// GET /chats - List all chats
router.get('/', chatController.getChats);

// POST /chats/:chatId/read - Persist read cursor (DB-backed; unread persists across refresh)
router.post('/:chatId/read', chatController.markChatRead);

// POST /chats/:chatId/mark-read - Mark messages as read (delivery store; legacy)
router.post('/:chatId/mark-read', chatController.markRead);

// GET /chats/:chatId - Get specific chat
router.get('/:chatId', chatController.getChatById);

module.exports = router;
