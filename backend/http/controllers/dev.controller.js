'use strict';

/**
 * DEV-only controller. No auth required.
 * - GET /api/dev/debug/auth — cookie config, request host/origin, cookie presence (no secrets).
 * - GET /api/dev/chats/list?asUserId=... — same as GET /api/chats but bypasses auth for local debugging.
 * Routes are only registered when ENABLE_DEV_ROUTES=true and DEV_ROUTES_KEY (or DEV_SESSION_KEY) is set.
 * All /api/dev/* requests require header x-dev-key to match the configured key; wrong/missing key → 404.
 */
const config = require('../../config/constants');
const cookieConfig = require('../../config/cookieConfig');
const { getCookie } = require('../../utils/cookies');
const chatController = require('./chat.controller');

const JWT_COOKIE_NAME = config.JWT_COOKIE_NAME;
const REFRESH_COOKIE_NAME = config.REFRESH_COOKIE_NAME;

/** Expected dev host (align with frontend policy: use localhost only). */
const EXPECTED_DEV_HOST = 'localhost';

/** Effective key for x-dev-key check: DEV_ROUTES_KEY or fallback DEV_SESSION_KEY. */
function getDevRoutesKey() {
  const key = process.env.DEV_ROUTES_KEY || process.env.DEV_SESSION_KEY;
  return typeof key === 'string' && key.length > 0 ? key : null;
}

/**
 * Guard for /api/dev/* routes. Requires header x-dev-key to equal configured key.
 * Returns 404 (not 401) on missing/mismatch to avoid advertising the endpoint.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function requireDevKey(req, res, next) {
  const key = getDevRoutesKey();
  if (!key) return res.status(404).end();
  const provided = req.headers['x-dev-key'];
  if (provided !== key) return res.status(404).end();
  next();
}

/**
 * GET /api/dev/debug/auth
 * DEV only. Returns: nodeEnv, cookieConfigEffective, requestHost, requestOrigin, hasSessionCookie, hasRefreshCookie, hint.
 */
function getDebugAuth(req, res) {

  const cookieHeader = req.headers.cookie || '';
  const requestHost = req.get('host') || req.hostname || '';
  const requestOrigin = req.get('origin') || '';

  const hasSessionCookie = !!getCookie(cookieHeader, JWT_COOKIE_NAME);
  const hasRefreshCookie = !!getCookie(cookieHeader, REFRESH_COOKIE_NAME);

  const hostnameFromHost = requestHost.split(':')[0];
  const hint =
    hostnameFromHost && hostnameFromHost !== EXPECTED_DEV_HOST
      ? 'HOST_MISMATCH_LIKELY'
      : undefined;

  res.status(200).json({
    nodeEnv: process.env.NODE_ENV || 'development',
    cookieConfigEffective: {
      secure: cookieConfig.COOKIE_SECURE,
      sameSite: cookieConfig.COOKIE_SAME_SITE,
      domain: cookieConfig.COOKIE_DOMAIN ?? '(host-only)',
      path: cookieConfig.COOKIE_PATH,
    },
    requestHost,
    requestOrigin,
    hasSessionCookie,
    hasRefreshCookie,
    ...(hint && { hint }),
  });
}

/**
 * GET /api/dev/chats/list?asUserId=...
 * DEV only. Returns same shape as GET /api/chats for the given asUserId (no auth required).
 */
async function getChatListAsUser(req, res) {
  const asUserId = (req.query && req.query.asUserId) || '';
  if (!asUserId || typeof asUserId !== 'string' || !asUserId.trim()) {
    return res.status(400).json({ error: 'Query asUserId is required' });
  }
  req.user = { userId: asUserId.trim() };
  return chatController.getChats(req, res);
}

module.exports = {
  requireDevKey,
  getDevRoutesKey,
  getDebugAuth,
  getChatListAsUser,
};
