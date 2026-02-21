'use strict';

/**
 * HTTP user identity routes.
 * Minimal, safe HTTP user surface for frontend discovery.
 * 
 * Routes:
 * - GET /users - List all users (id, username, displayName, role); includes self
 * - GET /users/search?q=query - Search users by username
 * - GET /users/:id - Get user by ID
 * - GET /users/me - Get current authenticated user
 * - DELETE /users/me - Soft-delete current user (body: { confirm: "DELETE" })
 * 
 * All routes require authentication.
 * No WebSocket state is exposed.
 */

const express = require('express');
const userController = require('../controllers/user.controller');
const { requireAuth } = require('../middleware/auth.middleware');

const router = express.Router();

// All user routes require authentication (GET /me, DELETE /me, GET /:id, etc.)
router.use(requireAuth);

// GET /users - List all users (safe fields only)
router.get('/', userController.listUsers);

// GET /users/search?q=query - Search users
router.get('/search', userController.searchUsers);

// GET /users/me - Get current user (must be before /:id to avoid route conflict)
router.get('/me', userController.getMe);

// DELETE /users/me - Soft-delete current user; requires body { confirm: "DELETE" }
router.delete('/me', userController.deleteMe);

// GET /users/:id - Get user by ID
router.get('/:id', userController.getUserById);

module.exports = router;
