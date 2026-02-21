'use strict';

/**
 * HTTP-owned authentication middleware.
 * HTTP is the SOLE owner of authentication lifecycle.
 * 
 * This middleware:
 * - Verifies JWT from HTTP-only cookies
 * - Attaches req.user with userId
 * - NEVER generates tokens (that's auth.controller's job)
 * 
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * ARCHITECTURAL BOUNDARIES
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 
 * HTTP OWNS:
 * - JWT verification (from cookies)
 * - Request authentication (req.user attachment)
 * 
 * HTTP DOES NOT OWN:
 * - Token creation (auth.controller owns creation)
 * - WebSocket authentication (WebSocket verifies tokens independently)
 * 
 * See: http/README.md for full contract.
 */

const { getCookie } = require('../../utils/cookies');
const config = require('../../config/constants');
const tokenService = require('../../auth/tokenService');
const userStore = require('../../storage/user.store');
const { isRootUser } = require('../../auth/rootProtection');

const JWT_COOKIE_NAME = config.JWT_COOKIE_NAME;

/**
 * Get JWT from request: Authorization Bearer first (dev-token-mode); only then fallback to cookies.
 * When Authorization is present, cookies are ignored so per-tab dev mode works.
 */
function getTokenFromRequest(req) {
  const authHeader = req.headers.authorization;
  if (authHeader && typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    const t = authHeader.slice(7).trim();
    if (t) return t;
  }
  const cookieHeader = req.headers.cookie || '';
  return getCookie(cookieHeader, JWT_COOKIE_NAME);
}

/**
 * Authentication middleware
 * Verifies JWT from Authorization header (Bearer) or cookies and attaches req.user.
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {Function} next - Express next middleware
 */
async function authMiddleware(req, res, next) {
  const token = getTokenFromRequest(req);

  if (!token) {
    req.user = null;
    return next();
  }

  const payload = tokenService.verifyAccess(token);
  if (!payload) {
    req.user = null;
    return next();
  }

  const userId = payload.userId;
  if (!userId) {
    req.user = null;
    return next();
  }

  const banned = await userStore.isBanned(userId);
  if (banned) {
    req.user = null;
    return res.status(403).json({
      success: false,
      error: 'Account is suspended',
      code: 'ACCOUNT_BANNED',
    });
  }

  const rawUser = await userStore.findById(userId);
  const isRootAdmin = !!isRootUser(rawUser || {});

  // PHASE 4: Role from DB so admin promotion takes effect immediately (no logout/login).
  const dbRole = rawUser?.role && typeof rawUser.role === 'string' ? rawUser.role : (payload.role ?? 'USER');

  req.user = {
    userId,
    sid: payload.sid ?? null,
    isRootAdmin,
    ...payload,
  };
  req.user.role = dbRole; // DB is authority; overwrites any payload.role from JWT
  if (payload.role !== undefined) req.user.tokenRole = payload.role; // optional debug

  next();
}

const { requireAuth } = require('./requireAuth');

module.exports = {
  authMiddleware,
  requireAuth,
};
