'use strict';

/**
 * Uploads routes.
 * POST /api/uploads/image — multipart "file", image only, max 2MB.
 */

const path = require('path');
const fs = require('fs');
const multer = require('multer');
const uploadsController = require('../controllers/uploads.controller');
const { requireAuth } = require('../middleware/auth.middleware');
const { sendError } = require('../../utils/errorResponse');

const UPLOADS_DIR = path.resolve(__dirname, '../../storage/_data/uploads');
const MAX_SIZE_BYTES = 2 * 1024 * 1024;

function ensureUploadsDir() {
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }
}

ensureUploadsDir();

const upload = multer({
  dest: UPLOADS_DIR,
  limits: { fileSize: MAX_SIZE_BYTES },
});

const router = require('express').Router();

router.post('/image', requireAuth, (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') return sendError(res, 400, 'File too large. Max 2MB.', 'FILE_TOO_LARGE');
      return sendError(res, 400, err.message || 'Upload failed', err.code || 'UPLOAD_ERROR');
    }
    next();
  });
}, uploadsController.uploadImage);

module.exports = router;
