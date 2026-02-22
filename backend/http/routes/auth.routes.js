'use strict';

/**
 * HTTP-owned authentication routes.
 * HTTP is the SOLE owner of authentication lifecycle.
 *
 * Routes (mounted at /api): /login, /logout, /me (GET + PATCH), /register, /auth/refresh
 */

const express = require('express');
const authController = require('../controllers/auth.controller');
const uiPrefsController = require('../controllers/uiPreferences.controller');
const { requireAuth } = require('../middleware/auth.middleware');
const { authLimiter, logoutLimiter } = require('../middleware/rateLimit.middleware');

const router = express.Router();

// POST /register - Register new user
router.post('/register', authLimiter, authController.register);

// POST /login - Create session and set cookies
router.post('/login', authLimiter, authController.login);
// POST /auth/login - Alias so POST /api/auth/login returns 401/200/403 (not 404)
router.post('/auth/login', authLimiter, authController.login);

// POST /auth/refresh - Rotate refresh token, set new access + refresh cookies (no requireAuth)
router.post('/auth/refresh', authLimiter, authController.refresh);

// POST /logout - Clear session cookies
router.post('/logout', logoutLimiter, authController.logout);

// POST /logout/current - Revoke current session only (per-tab in dev-token-mode)
router.post('/logout/current', requireAuth, logoutLimiter, authController.logoutCurrent);

// GET /me - Get current user (requires authentication)
router.get('/me', requireAuth, authController.getMe);

// PATCH /me - Update profile (displayName, avatarUrl only)
router.patch('/me', requireAuth, authController.patchMe);

// PATCH /me/password - Change password (requires current password)
router.patch('/me/password', requireAuth, authLimiter, authController.changePassword);

// GET /me/ui-preferences - Get current user's UI preferences
router.get('/me/ui-preferences', requireAuth, uiPrefsController.getMyUiPreferences);

// PATCH /me/ui-preferences - Update current user's UI preferences
router.patch('/me/ui-preferences', requireAuth, uiPrefsController.patchMyUiPreferences);

module.exports = router;
