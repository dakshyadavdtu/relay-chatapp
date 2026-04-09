'use strict';

/**
 * Password reset (OTP) routes. Mounted at /api/password.
 * POST /forgot, /verify, /reset — no auth required.
 */

const express = require('express');
const passwordController = require('../controllers/password.controller');
const { authLimiter } = require('../middleware/rateLimit.middleware');

const router = express.Router();

router.post('/forgot', authLimiter, passwordController.forgot);
router.post('/verify', authLimiter, passwordController.verify);
router.post('/reset', authLimiter, passwordController.reset);

// TEMPORARY: debug mail route — remove after confirming delivery
router.post('/debug-mail', passwordController.debugMail);

module.exports = router;
