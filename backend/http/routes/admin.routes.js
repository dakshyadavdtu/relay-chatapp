'use strict';

/**
 * Admin routes.
 * requireAuth runs first; then role middleware per route.
 * Diagnostics: ADMIN only. Role changes / monitoring: ADMIN only.
 */

const express = require('express');
const adminController = require('../controllers/admin.controller');
const adminUsersRoutes = require('./admin.users.routes');
const { requireAuth } = require('../middleware/auth.middleware');
const { requireAdmin } = require('../middleware/requireRole');
const { requireRootAdmin } = require('../middleware/requireRootAdmin');
const { adminActionLimiter } = require('../middleware/rateLimit.middleware');

const router = express.Router();

router.use(requireAuth);

// Root-only user/role management (list users with email, set role)
router.use('/root/users', adminUsersRoutes);

// GET /admin/dashboard - Dashboard aggregates (ADMIN only)
router.get('/dashboard', requireAdmin, adminController.getDashboard);
router.get('/dashboard/timeseries', requireAdmin, adminController.getDashboardTimeseries);
router.get('/dashboard/series', requireAdmin, adminController.getDashboardSeries);
router.get('/dashboard/stats', requireAdmin, adminController.getDashboardStats);
router.get('/dashboard/activity', requireAdmin, adminController.getDashboardActivity);
router.get('/dashboard/history', requireAdmin, adminController.getDashboardHistory);

// GET /admin/activity - Activity feed (ADMIN only)
router.get('/activity', requireAdmin, adminController.getActivity);

// GET /admin/users - Users list with search/pagination (ADMIN only)
router.get('/users', requireAdmin, adminController.getUsers);
router.get('/users/:id/sessions', requireAdmin, adminController.getUserSessions);

// GET /admin/diagnostics/:userId - User diagnostics (ADMIN only)
router.get('/diagnostics/:userId', requireAdmin, adminController.getDiagnostics);

// GET /admin/messages - Admin message inspection (ADMIN only)
router.get('/messages', requireAdmin, adminController.getAdminMessages);

// GET /admin/reports - Moderation queue (ADMIN only)
router.get('/reports', requireAdmin, adminController.getReports);
// GET /admin/reports/:id - Report details + message context (ADMIN only)
router.get('/reports/:id', requireAdmin, adminController.getReportDetails);

// POST admin actions: rate limited (60/hour per admin)
router.post('/reports/:id/resolve', requireAdmin, adminActionLimiter, adminController.resolveReport);
// Role change: root only (non-root ADMIN get 403 at middleware if they hit /admin/root/users/:id/role)
router.post('/users/:id/role', requireRootAdmin, adminActionLimiter, adminController.promoteUserToAdmin);
router.post('/users/:id/warn', requireAdmin, adminActionLimiter, adminController.warnUser);
router.post('/users/:id/ban', requireAdmin, adminActionLimiter, adminController.banUser);
router.post('/users/:id/unban', requireAdmin, adminActionLimiter, adminController.unbanUser);
router.post('/users/:id/sessions/:sessionId/revoke', requireAdmin, adminActionLimiter, adminController.revokeOneSession);
router.post('/users/:id/revoke-sessions', requireAdmin, adminActionLimiter, adminController.revokeSessions);

module.exports = router;
