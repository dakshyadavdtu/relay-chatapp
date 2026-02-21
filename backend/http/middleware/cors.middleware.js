'use strict';

/**
 * Lightweight CORS response headers. Uses unified config (config/origins.js).
 * If request has Origin and it is allowed → set Access-Control-* and Vary: Origin.
 * OPTIONS preflight → 204. If Origin missing → no-op (same-origin requests work).
 */

const { isAllowedOrigin } = require('../../config/origins');

const ALLOWED_HEADERS = 'Content-Type, Authorization';
const ALLOWED_METHODS = 'GET, POST, PUT, PATCH, DELETE, OPTIONS';

function corsMiddleware(req, res, next) {
  const origin = req.get('Origin');
  if (!origin) {
    return next();
  }
  if (!isAllowedOrigin(origin)) {
    return next();
  }
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', ALLOWED_HEADERS);
  res.setHeader('Access-Control-Allow-Methods', ALLOWED_METHODS);

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  next();
}

module.exports = { corsMiddleware };
