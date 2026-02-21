'use strict';

/**
 * Origin/Referer guard for CSRF protection.
 * Blocks cross-site state-changing requests (POST, PUT, PATCH, DELETE)
 * when Origin/Referer does not match allowed origins.
 *
 * Uses unified config (config/origins.js): CORS_ORIGINS or CORS_ORIGIN, or dev defaults.
 * Dev: any localhost/127.0.0.1 with any port allowed; missing Origin+Referer allowed (tooling).
 * Prod: block missing Origin+Referer and block non-allowed origins.
 *
 * WS upgrade is unaffected (handled before /api routes).
 *
 * Debug (safe logging only; never logs cookies, auth headers, or body):
 *   DEBUG_ORIGIN_GUARD=true     → log requestOrigin, decision, and allowedOrigins count.
 *   DEBUG_ORIGIN_GUARD_VERBOSE=true → also log full allowedOrigins list (use only when needed).
 */

const { isAllowedOrigin, getAllowedOrigins } = require('../../config/origins');

const DEBUG_ORIGIN_GUARD = process.env.DEBUG_ORIGIN_GUARD === 'true';
const DEBUG_ORIGIN_GUARD_VERBOSE = process.env.DEBUG_ORIGIN_GUARD_VERBOSE === 'true';

const UNSAFE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];
const isProduction = process.env.NODE_ENV === 'production';

function getRequestOrigin(req) {
  const origin = req.get('Origin');
  if (origin) return origin;
  const referer = req.get('Referer');
  if (referer) {
    try {
      return new URL(referer).origin;
    } catch {
      return null;
    }
  }
  return null;
}

function originGuard(req, res, next) {
  if (!UNSAFE_METHODS.includes(req.method)) {
    return next();
  }

  const requestOrigin = getRequestOrigin(req);
  const allowed = getAllowedOrigins().allowedOrigins;
  const matched = Boolean(requestOrigin && isAllowedOrigin(requestOrigin));

  // Safe logging only: never cookies, auth headers, or body. Default: origin + decision + count.
  if (DEBUG_ORIGIN_GUARD) {
    const payload = {
      requestOrigin: requestOrigin ?? '(none)',
      decision: matched ? 'allow' : 'block',
      allowedOriginsCount: allowed.length,
    };
    if (DEBUG_ORIGIN_GUARD_VERBOSE) payload.allowedOrigins = allowed;
    console.debug('[OriginGuard]', payload);
  }

  if (matched) {
    return next();
  }

  // Dev: missing Origin+Referer (curl, Postman) — allow for tooling
  if (!isProduction && !requestOrigin) {
    return next();
  }

  // Production: missing Origin+Referer — block (browsers send Origin for cross-origin)
  if (isProduction && !requestOrigin) {
    res.status(403).json({
      success: false,
      error: 'Cross-site request blocked',
      code: 'CSRF_BLOCKED',
    });
    return;
  }

  // Cross-site origin not allowed
  res.status(403).json({
    success: false,
    error: 'Cross-site request blocked',
    code: 'CSRF_BLOCKED',
  });
}

module.exports = { originGuard };
