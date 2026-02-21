'use strict';

/**
 * Root-only admin user management.
 * GET /api/admin/root/users — list users (id, email, username, role, createdAt).
 * POST /api/admin/root/users/:id/role — set role (body: { role: "ADMIN" | "USER" }).
 * Both require requireRootAdmin.
 */

const express = require('express');
const adminController = require('../controllers/admin.controller');
const { requireRootAdmin } = require('../middleware/requireRootAdmin');
const { adminActionLimiter } = require('../middleware/rateLimit.middleware');

const router = express.Router();

router.use(requireRootAdmin);

router.get('/', adminController.getRootUsersList);
router.post('/:id/role', adminActionLimiter, adminController.promoteUserToAdmin);

module.exports = router;
