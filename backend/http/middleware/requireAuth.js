'use strict';

/**
 * Session-aware requireAuth middleware (Phase 2F).
 * Runs after authMiddleware. Verifies access JWT (already done), confirms session exists
 * and not revoked, attaches req.user = { id, role, sessionId }, throttles touchSession.
 *
 * If session is revoked server-side, HTTP requests fail with 401 even if JWT is not expired.
 */

const sessionStore = require('../../auth/sessionStore');

/**
 * Require authentication + valid session.
 * Expects req.user from authMiddleware: { userId, sid, role }.
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {Function} next - Express next middleware
 */
function requireAuth(req, res, next) {
  if (!req.user || !req.user.userId) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required',
      code: 'UNAUTHORIZED',
    });
  }

  const sessionId = req.user.sid;
  if (!sessionId) {
    return res.status(401).json({
      success: false,
      error: 'Session required',
      code: 'UNAUTHORIZED',
    });
  }

  (async () => {
    const session = await sessionStore.getSession(sessionId);
    if (!session || session.revokedAt) {
      return res.status(401).json({
        success: false,
        error: 'Session invalid or revoked',
        code: 'UNAUTHORIZED',
      });
    }

    sessionStore.touchSession(sessionId).catch(() => {});

    req.user.id = session.userId;
    req.user.userId = session.userId;
    // PHASE 4: Do not overwrite req.user.role with session.role (stale). Auth middleware sets role from DB.
    req.user.effectiveRole = req.user.isRootAdmin ? 'ADMIN' : req.user.role;
    req.user.sessionId = session.sessionId;

    next();
  })().catch(next);
}

module.exports = {
  requireAuth,
};
