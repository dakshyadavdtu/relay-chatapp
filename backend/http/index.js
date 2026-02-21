'use strict';

/**
 * HTTP Subsystem — First-class entry point.
 * HTTP begins here.
 * 
 * This file represents the root of all HTTP logic.
 * All HTTP routes and middleware MUST be mounted through this file.
 * Middleware execution order is deterministic and explicit.
 * 
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * ARCHITECTURAL BOUNDARIES (PERMANENT LOCK)
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 
 * HTTP IS ALLOWED TO:
 * - Authenticate users (login, logout, token creation)
 * - Discover users (search, profiles)
 * - Return chat metadata (list, participants, unread counts)
 * - Query chat history (paginated, DB-based)
 * - Query database directly
 * 
 * HTTP IS FORBIDDEN FROM:
 * - Sending/receiving real-time messages
 * - Emitting WebSocket events
 * - Returning online/offline status
 * - Returning typing indicators
 * - Returning presence state
 * - Querying WebSocket connection state
 * - Importing from websocket/ directories
 * - Depend on in-memory WebSocket state
 * 
 * See: http/README.md for full architectural contract.
 * 
 * If someone suggests adding real-time logic to HTTP → CONTRACT VIOLATION.
 * Real-time logic belongs in websocket/handlers/, not http/controllers/.
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 */

const express = require('express');
const { authMiddleware, requireAuth } = require('./middleware/auth.middleware');
const { sendError } = require('../utils/errorResponse');
const authRoutes = require('./routes/auth.routes');
const passwordRoutes = require('./routes/password.routes');
const userRoutes = require('./routes/user.routes');
const chatRoutes = require('./routes/chat.routes');
const historyRoutes = require('./routes/history.routes');
const sessionsRoutes = require('./routes/sessions.routes');
const reportsRoutes = require('./routes/reports.routes');
const uploadsRoutes = require('./routes/uploads.routes');
const adminRoutes = require('./routes/admin.routes');
const exportRoutes = require('./routes/export.routes');
const searchRoutes = require('./routes/search.routes');
const chatController = require('./controllers/chat.controller');
const devController = require('./controllers/dev.controller');
const { messageLimiter } = require('./middleware/rateLimit.middleware');
const { originGuard } = require('./middleware/originGuard.middleware');
const { requireAdmin } = require('./middleware/requireRole');
const { handleMetrics } = require('../observability/metricsRoute');

// Create HTTP router (mountable unit)
const httpRouter = express.Router();

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MIDDLEWARE ORDER (deterministic and explicit)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// 1. JSON/body parsing
// Prevent large-body DoS. Override via HTTP_BODY_LIMIT (e.g. '256kb', '1mb').
const BODY_LIMIT = process.env.HTTP_BODY_LIMIT || '256kb';
httpRouter.use(express.json({ limit: BODY_LIMIT }));
httpRouter.use(express.urlencoded({ extended: false, limit: BODY_LIMIT }));

// 2. Origin guard (CSRF: block cross-site POST/PUT/PATCH/DELETE)
// Excludes /health (handled by app directly before httpRouter)
httpRouter.use(originGuard);

// 3. Auth middleware (HTTP auth boundary)
// Verifies JWT from cookies and attaches req.user
// HTTP is the SOLE owner of authentication lifecycle
httpRouter.use(authMiddleware);

// 4. Route mounting
httpRouter.use(authRoutes); // POST /login, POST /register, POST /logout, GET /me (under /api)
httpRouter.use('/password', passwordRoutes); // POST /password/forgot, /verify, /reset
httpRouter.use('/users', userRoutes); // GET /users/:id, GET /users/me
httpRouter.use('/chats', chatRoutes); // GET /chats, GET /chats/:chatId
// POST /chat/send (separate route for send endpoint)
httpRouter.post('/chat/send', messageLimiter, requireAuth, chatController.sendMessage);
httpRouter.use('/chat', historyRoutes); // GET /chat/history, GET /chat/history/:conversationId
httpRouter.use('/sessions', sessionsRoutes); // GET /sessions/active, POST /sessions/logout
httpRouter.use('/reports', reportsRoutes);
httpRouter.use('/uploads', uploadsRoutes);
httpRouter.use('/admin', adminRoutes);
httpRouter.use('/export', exportRoutes);
httpRouter.use('/search', searchRoutes);

// Optional admin-only metrics (browser/cookie): same JSON contract as GET /metrics
if (process.env.METRICS_ENABLE_ADMIN_ROUTE === 'true') {
  httpRouter.get('/metrics', requireAuth, requireAdmin, (req, res) => handleMetrics(req, res));
}

// DEV routes: only when ENABLE_DEV_ROUTES=true AND DEV_ROUTES_KEY or DEV_SESSION_KEY is set.
// All /api/dev/* require header x-dev-key to match; wrong/missing → 404.
const devRoutesEnabled = process.env.ENABLE_DEV_ROUTES === 'true' && devController.getDevRoutesKey();
if (devRoutesEnabled) {
  httpRouter.get('/dev/debug/auth', devController.requireDevKey, devController.getDebugAuth);
  httpRouter.get('/dev/chats/list', devController.requireDevKey, devController.getChatListAsUser);
}

// 5. Error middleware (HTTP error boundary)
httpRouter.use((err, req, res, next) => {
  // Normalize body-parser "entity too large" to API shape (consistent with reports, etc.)
  if (err?.type === 'entity.too.large' || err?.status === 413 || err?.statusCode === 413) {
    return sendError(res, 413, 'Request body too large', 'PAYLOAD_TOO_LARGE');
  }
  // HTTP error boundary: catch errors from routes/middleware
  console.error('HTTP error:', err);
  sendError(res, err.status || 500, err.message || 'Internal server error', err.code || 'HTTP_ERROR');
});

// Export mountable unit
module.exports = httpRouter;
