'use strict';

/**
 * Reports routes.
 * POST /api/reports - create report (auth required, rate limited).
 */

const express = require('express');
const reportsController = require('../controllers/reports.controller');
const { requireAuth } = require('../middleware/auth.middleware');
const { reportLimiter } = require('../middleware/rateLimit.middleware');

const router = express.Router();

// POST /reports - create a report (auth + rate limit applied in order)
router.post('/', requireAuth, reportLimiter, reportsController.createReport);

module.exports = router;
