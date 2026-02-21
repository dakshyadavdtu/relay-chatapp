'use strict';

/**
 * HTTP rate limit middleware.
 * Limits are configurable via env with safe defaults for dev.
 *
 * Env overrides:
 * - RATE_LIMIT_AUTH_MAX (default 10) - max requests per window for login/register
 * - RATE_LIMIT_AUTH_WINDOW_MS (default 300000 = 5 min)
 * - RATE_LIMIT_LOGOUT_MAX (default 30)
 * - RATE_LIMIT_LOGOUT_WINDOW_MS (default 60000 = 1 min)
 * - RATE_LIMIT_MESSAGE_MAX (default 60)
 * - RATE_LIMIT_MESSAGE_WINDOW_MS (default 60000 = 1 min)
 */

const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

function rateLimitHandler(req, res) {
  res.status(429).json({
    success: false,
    error: 'Too many requests',
    code: 'RATE_LIMITED',
  });
}

function createLimiter(max, windowMs) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    handler: rateLimitHandler,
  });
}

const authMax = parseInt(process.env.RATE_LIMIT_AUTH_MAX || '10', 10);
const authWindowMs = parseInt(process.env.RATE_LIMIT_AUTH_WINDOW_MS || '300000', 10); // 5 min
const logoutMax = parseInt(process.env.RATE_LIMIT_LOGOUT_MAX || '30', 10);
const logoutWindowMs = parseInt(process.env.RATE_LIMIT_LOGOUT_WINDOW_MS || '60000', 10); // 1 min
const messageMax = parseInt(process.env.RATE_LIMIT_MESSAGE_MAX || '60', 10);
const messageWindowMs = parseInt(process.env.RATE_LIMIT_MESSAGE_WINDOW_MS || '60000', 10); // 1 min
const reportMax = parseInt(process.env.RATE_LIMIT_REPORT_MAX || '10', 10);
const reportWindowMs = parseInt(process.env.RATE_LIMIT_REPORT_WINDOW_MS || '3600000', 10); // 1 hour

/** Login and register: 10 req / 5 min per IP (configurable) */
const authLimiter = createLimiter(authMax, authWindowMs);

/** Logout: 30 req / 1 min per IP (configurable) */
const logoutLimiter = createLimiter(logoutMax, logoutWindowMs);

/** Chat send: 60 req / 1 min per IP (configurable) */
const messageLimiter = createLimiter(messageMax, messageWindowMs);

/** Report creation: 10 req / hour per user (must run after requireAuth) */
const reportLimiter = rateLimit({
  windowMs: reportWindowMs,
  max: reportMax,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  keyGenerator: (req) => (req.user?.userId ? String(req.user.userId) : ipKeyGenerator(req.ip || '0.0.0.0')),
});

const adminActionMax = parseInt(process.env.RATE_LIMIT_ADMIN_ACTION_MAX || '60', 10);
const adminActionWindowMs = parseInt(process.env.RATE_LIMIT_ADMIN_ACTION_WINDOW_MS || '3600000', 10); // 1 hour

/** Admin POST actions: 60 req / hour per admin (must run after requireAuth) */
const adminActionLimiter = rateLimit({
  windowMs: adminActionWindowMs,
  max: adminActionMax,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  keyGenerator: (req) => (req.user?.userId ? String(req.user.userId) : ipKeyGenerator(req.ip || '0.0.0.0')),
});

module.exports = {
  authLimiter,
  logoutLimiter,
  messageLimiter,
  reportLimiter,
  adminActionLimiter,
};
