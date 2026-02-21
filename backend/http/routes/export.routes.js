'use strict';

const express = require('express');
const exportController = require('../controllers/export.controller');
const { requireAuth } = require('../middleware/auth.middleware');

const router = express.Router();
router.use(requireAuth);

router.get('/chat/:chatId.json', exportController.exportChatJson);
router.get('/chat/:chatId.pdf', exportController.exportChatPdf);

module.exports = router;
