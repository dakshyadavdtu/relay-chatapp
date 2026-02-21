'use strict';

/**
 * HTTP session management controller.
 * GET /api/sessions/active: real implementation via sessionStore (Phase 1.A1).
 * POST /api/sessions/logout: Phase 1.A2 — current session or { sessionId }; revoke + WS kick + cookie rules.
 * POST /api/sessions/logout-all: Phase 1.A3 — revoke all sessions for user, drop all WS, clear cookies.
 */

const config = require('../../config/constants');
const { COOKIE_DOMAIN, COOKIE_SECURE, COOKIE_SAME_SITE, COOKIE_PATH } = require('../../config/cookieConfig');
const { sendError, sendSuccess } = require('../../utils/errorResponse');
const sessionStore = require('../../auth/sessionStore');
const connectionManager = require('../../websocket/connection/connectionManager');
const { deviceLabel } = require('../../utils/deviceLabel');
const { getLiveWindowMs, isLiveSession } = require('../../utils/sessionLive');
const { normalizeIp } = require('../../utils/ip');

const JWT_COOKIE_NAME = config.JWT_COOKIE_NAME;
const REFRESH_COOKIE_NAME = config.REFRESH_COOKIE_NAME;

const cookieClearOptions = {
  httpOnly: true,
  secure: COOKIE_SECURE,
  sameSite: COOKIE_SAME_SITE,
  path: COOKIE_PATH,
  maxAge: 0,
};
if (COOKIE_DOMAIN) cookieClearOptions.domain = COOKIE_DOMAIN;

/** Clear auth cookies (parity with auth.controller.js). */
function clearAuthCookies(res) {
  res.clearCookie(JWT_COOKIE_NAME, cookieClearOptions);
  res.clearCookie(REFRESH_COOKIE_NAME, cookieClearOptions);
}

/**
 * Get active sessions for authenticated user.
 * Response: { success: true, data: { sessions: [{ sessionId, userId, createdAt, lastSeenAt, revokedAt, userAgent, ip, device, isCurrent }] } }.
 * Smoke: no userId => 401; empty list => sessions: []; missing userAgent/ip => null or ''.
 */
async function getActiveSessions(req, res) {
  const userId = req.user?.userId;
  const currentSid = req.user?.sid ?? req.user?.sessionId ?? null;

  if (!userId) {
    return sendError(res, 401, 'Not authenticated', 'UNAUTHORIZED');
  }

  const liveOnly = String(req.query.liveOnly || '') === '1';
  const liveWindowMs = getLiveWindowMs(config);

  let list = [];
  try {
    list = await sessionStore.listSessions(userId, { activeOnly: true });
  } catch (_) {
    list = [];
  }

  if (liveOnly) {
    const now = Date.now();
    list = list.filter((s) => isLiveSession(s.lastSeenAt, now, liveWindowMs));
  }

  const sessions = list.map((s) => ({
    sessionId: s.sessionId,
    userId: s.userId,
    createdAt: s.createdAt ?? null,
    lastSeenAt: s.lastSeenAt ?? null,
    revokedAt: s.revokedAt ?? null,
    userAgent: s.userAgent ?? null,
    ip: normalizeIp(s.ip) ?? null,
    device: deviceLabel(s.userAgent),
    isCurrent: currentSid != null && s.sessionId === currentSid,
  }));

  return sendSuccess(res, { sessions });
}

/**
 * POST /api/sessions/logout — Phase 1.A2.
 * Body: { sessionId?: string }. If absent, logout current session only; else revoke that session (iff owned).
 * Revokes in sessionStore, kicks WS for that sessionId, clears cookies only when revoking current session.
 */
async function logout(req, res) {
  const userId = req.user?.userId;
  const currentSid = req.user?.sid ?? req.user?.sessionId ?? null;

  if (!userId) {
    return sendError(res, 401, 'Not authenticated', 'UNAUTHORIZED');
  }

  const bodySessionId = req.body && typeof req.body.sessionId === 'string' ? req.body.sessionId.trim() : null;

  if (!bodySessionId || bodySessionId === '') {
    if (!currentSid) {
      clearAuthCookies(res);
      return sendSuccess(res, {});
    }
    await sessionStore.revokeSession(currentSid);
    try {
      connectionManager.removeSession(currentSid);
    } catch (_) {
      // WS not connected or already closed
    }
    clearAuthCookies(res);
    return sendSuccess(res, {});
  }

  const session = await sessionStore.getSession(bodySessionId);
  if (!session) {
    return sendError(res, 404, 'Session not found', 'NOT_FOUND');
  }
  if (session.userId !== userId) {
    return sendError(res, 403, 'Forbidden', 'FORBIDDEN');
  }

  await sessionStore.revokeSession(bodySessionId);
  try {
    connectionManager.removeSession(bodySessionId);
  } catch (_) {
    // WS not connected or already closed
  }

  if (bodySessionId === currentSid) {
    clearAuthCookies(res);
  }

  return sendSuccess(res, {});
}

/**
 * POST /api/sessions/logout-all — Phase 1.A3.
 * Revoke all sessions for req.user.userId, drop all WS for that user, clear cookies.
 * Response: 200 { success: true, data: { revokedCount } } (revokedCount optional).
 */
async function logoutAll(req, res) {
  const userId = req.user?.userId;

  if (!userId) {
    return sendError(res, 401, 'Not authenticated', 'UNAUTHORIZED');
  }

  let revokedCount;
  try {
    revokedCount = await sessionStore.revokeAllSessions(userId);
  } catch (_) {
    revokedCount = 0;
  }

  try {
    connectionManager.remove(userId);
  } catch (_) {
    // No WS connected or already closed
  }

  clearAuthCookies(res);

  const data = typeof revokedCount === 'number' ? { revokedCount } : {};
  return sendSuccess(res, data);
}

module.exports = {
  getActiveSessions,
  logout,
  logoutAll,
};
