'use strict';

/**
 * Uploads controller.
 * POST /api/uploads/image — multipart form "file", image only, max 2MB.
 * Stores to storage/_data/uploads/<random>.<ext>, returns { url: "/uploads/<filename>" }.
 */

const path = require('path');
const fs = require('fs');
const { sendError, sendSuccess } = require('../../utils/errorResponse');

const UPLOADS_DIR = path.resolve(__dirname, '../../storage/_data/uploads');
const MAX_SIZE_BYTES = 2 * 1024 * 1024; // 2MB
const ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

function ensureUploadsDir() {
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }
}

function randomFilename(ext) {
  const safe = (Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/[^a-z0-9]/g, '');
  return `${safe}.${ext}`;
}

/**
 * POST /api/uploads/image
 * Expects multer to have run (single file field "file").
 */
function uploadImage(req, res) {
  const file = req.file;
  if (!file) {
    return sendError(res, 400, 'No file uploaded. Use multipart field "file".', 'MISSING_FILE');
  }
  if (file.size > MAX_SIZE_BYTES) {
    return sendError(res, 400, `File too large. Max ${MAX_SIZE_BYTES / 1024 / 1024}MB.`, 'FILE_TOO_LARGE');
  }
  const mime = (file.mimetype || '').toLowerCase();
  if (!ALLOWED_MIMES.includes(mime)) {
    return sendError(res, 400, 'Invalid file type. Allowed: image/jpeg, image/png, image/gif, image/webp.', 'INVALID_TYPE');
  }
  const ext = mime === 'image/jpeg' ? 'jpg' : mime.split('/')[1] || 'png';
  ensureUploadsDir();
  const filename = randomFilename(ext);
  const destPath = path.join(UPLOADS_DIR, filename);
  try {
    fs.renameSync(file.path, destPath);
  } catch (err) {
    if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
    return sendError(res, 500, 'Failed to save file.', 'UPLOAD_FAILED');
  }
  const url = `/uploads/${filename}`;
  return sendSuccess(res, { url });
}

module.exports = {
  uploadImage,
};
