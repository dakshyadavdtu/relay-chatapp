'use strict';

/**
 * Metrics access guard: protects GET /metrics by env (METRICS_MODE, NODE_ENV, METRICS_SECRET).
 * Modes: open (allow), disabled (404), secret (x-metrics-key header), admin (root /metrics → 403).
 * Uses constant-time comparison for secret. No query-param auth; header only.
 */

const crypto = require('crypto');

const HEADER = 'x-metrics-key';

function getMode() {
  const raw = process.env.METRICS_MODE;
  if (raw && typeof raw === 'string') {
    return raw.toLowerCase().trim();
  }
  return process.env.NODE_ENV === 'production' ? 'secret' : 'open';
}

function toBuffer(value) {
  if (value == null || value === '') return null;
  const s = typeof value === 'string' ? value : String(value);
  return Buffer.from(s, 'utf8');
}

function constantTimeEqual(a, b) {
  const bufA = toBuffer(a);
  const bufB = toBuffer(b);
  if (!bufA || !bufB || bufA.length !== bufB.length) {
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function metricsAccessGuard(req, res, next) {
  const mode = getMode();

  if (mode === 'open') {
    return next();
  }

  if (mode === 'disabled') {
    return res.status(404).json({
      success: false,
      error: 'Not Found',
      code: 'METRICS_DISABLED',
    });
  }

  if (mode === 'admin') {
    // Root /metrics with mode=admin: do not allow; direct to /api/metrics
    return res.status(403).json({
      success: false,
      error: 'Forbidden',
      code: 'METRICS_ADMIN_ONLY',
      message: 'Use /api/metrics with admin session when METRICS_ENABLE_ADMIN_ROUTE is enabled.',
    });
  }

  if (mode === 'secret') {
    const configured = process.env.METRICS_SECRET;
    const provided = req.headers[HEADER];
    if (
      configured == null ||
      String(configured).trim() === '' ||
      provided == null ||
      (typeof provided === 'string' && provided.trim() === '')
    ) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
        code: 'METRICS_UNAUTHORIZED',
      });
    }
    if (!constantTimeEqual(configured, provided)) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
        code: 'METRICS_UNAUTHORIZED',
      });
    }
    return next();
  }

  // Unknown mode: treat as disabled
  return res.status(404).json({
    success: false,
    error: 'Not Found',
    code: 'METRICS_DISABLED',
  });
}

module.exports = {
  metricsAccessGuard,
};
