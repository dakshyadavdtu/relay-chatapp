'use strict';

/**
 * HTTP session management routes.
 *
 * Routes:
 * - GET  /sessions/active   - Get active sessions for authenticated user
 * - POST /sessions/logout   - Log out current or specific session (Phase 1.A2)
 * - POST /sessions/logout-all - Revoke all sessions for user (Phase 1.A3)
 */

const express = require('express');
const sessionsController = require('../controllers/sessions.controller');
const { requireAuth } = require('../middleware/auth.middleware');

const router = express.Router();

// All session routes require authentication
router.use(requireAuth);

// GET /sessions/active - Get active sessions
router.get('/active', sessionsController.getActiveSessions);

// POST /sessions/logout - Log out
router.post('/logout', sessionsController.logout);

// POST /sessions/logout-all - Revoke all sessions for this user
router.post('/logout-all', sessionsController.logoutAll);

module.exports = router;
