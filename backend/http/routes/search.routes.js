'use strict';

/**
 * Global search routes. Mounted at /api/search.
 * GET /api/search?q=<query> — returns { groups, contacts, messages }
 */

const express = require('express');
const searchController = require('../controllers/search.controller');
const { requireAuth } = require('../middleware/auth.middleware');

const router = express.Router();
router.use(requireAuth);

router.get('/', searchController.getSearch);

module.exports = router;
