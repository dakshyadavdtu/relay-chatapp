'use strict';

/**
 * Origin/Referer guard for CSRF protection (strict allowlisting only).
 * No token-style CSRF: we do NOT require x-csrf-token or a csrf cookie.
 *
 * Logic:
 *   - If request is same-site (no Origin in dev, or Origin allowed): next()
 *   - Else: 403 JSON { success: false, error: 'Cross-site request blocked', code: 'CSRF_BLOCKED' }
 *
 * Blocks cross-site state-changing requests (POST, PUT, PATCH, DELETE)
 * when Origin/Referer does not match allowed origins (config/origins.js).
 * Dev: any localhost/127.0.0.1 allowed; missing Origin+Referer allowed (tooling).
 * Prod: block missing Origin+Referer and block non-allowed origins.
 *
 * WS upgrade is unaffected (handled before /api routes).
 */

const { isAllowedOrigin, normalizeOrigin } = require('../../config/origins');

const UNSAFE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];
const isProduction = process.env.NODE_ENV === 'production';

/** Single function that computes request origin: Origin header or Referer origin, normalized (no trailing slash, origin-only). */
function getRequestOrigin(req) {
  const raw = req.get('Origin') || (() => {
    const referer = req.get('Referer');
    if (!referer) return null;
    try {
      return new URL(referer).origin;
    } catch {
      return null;
    }
  })();
  if (!raw) return null;
  try {
    return normalizeOrigin(raw);
  } catch {
    return null;
  }
}

function originGuard(req, res, next) {
  if (!UNSAFE_METHODS.includes(req.method)) {
    return next();
  }

  const requestOrigin = getRequestOrigin(req);
  const matched = Boolean(requestOrigin && isAllowedOrigin(requestOrigin));

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
