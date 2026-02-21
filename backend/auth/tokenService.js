'use strict';

/**
 * Phase 2 token service — access JWT + opaque refresh with hash storage.
 *
 * Contract: docs/admin/PHASE2_SESSION_CONTRACT.md
 * - Access: JWT in httpOnly cookie, short TTL, claims include sid (sessionId)
 * - Refresh: opaque random, long TTL; stored as sha256(token + REFRESH_PEPPER)
 * - Refresh rotation: each refresh invalidates old and issues new
 */

const crypto = require('crypto');
const { signJwt, verifyJwt, extractUserId, ACCESS_TOKEN_CLOCK_TOLERANCE_MS } = require('../utils/jwt');
const config = require('../config/constants');

/**
 * Issue a new access token (JWT) for the given session.
 * @param {Object} opts
 * @param {string} opts.userId
 * @param {string} opts.sessionId - sid claim
 * @param {string} opts.role
 * @param {number} [opts.expiresInSeconds] - default from config ACCESS_TOKEN_EXPIRES_IN_SECONDS
 * @returns {string} JWT
 */
function issueAccess(opts) {
  const expiresInSeconds = opts.expiresInSeconds ?? config.ACCESS_TOKEN_EXPIRES_IN_SECONDS;
  return signJwt(
    {
      userId: opts.userId,
      sid: opts.sessionId,
      role: opts.role,
    },
    expiresInSeconds
  );
}

/**
 * Issue a new refresh token (opaque random).
 * @returns {{ token: string, hash: string }} Raw token (to send in cookie) and hash (to store: sha256(token + REFRESH_PEPPER))
 */
function issueRefresh() {
  const token = crypto.randomBytes(32).toString('hex');
  const hash = hashRefresh(token);
  return { token, hash };
}

/**
 * Verify access token (JWT) and return payload.
 * @param {string} token - JWT string
 * @returns {{ userId: string, sid: string, role: string }|null} Decoded payload or null if invalid/expired
 */
function verifyAccess(token) {
  const payload = verifyJwt(token, undefined, { clockToleranceMs: ACCESS_TOKEN_CLOCK_TOLERANCE_MS });
  if (!payload) return null;
  const userId = extractUserId(payload);
  if (!userId) return null;
  return {
    userId,
    sid: payload.sid ?? null,
    role: payload.role ?? 'USER',
  };
}

/**
 * Hash a refresh token for storage (same as issueRefresh storage).
 * @param {string} rawToken - The opaque refresh token string
 * @returns {string} sha256(rawToken + REFRESH_PEPPER)
 */
function hashRefresh(rawToken) {
  const pepper = config.REFRESH_PEPPER || '';
  return crypto.createHash('sha256').update(rawToken + pepper).digest('hex');
}

/**
 * Validate a refresh token against a stored hash.
 * @param {string} rawToken - Token from cookie
 * @param {string} storedHash - Hash previously stored (hex)
 * @returns {boolean}
 */
function validateRefreshHash(rawToken, storedHash) {
  const computed = hashRefresh(rawToken);
  if (typeof storedHash !== 'string' || storedHash.length !== computed.length) return false;
  return crypto.timingSafeEqual(Buffer.from(computed, 'hex'), Buffer.from(storedHash, 'hex'));
}

module.exports = {
  issueAccess,
  issueRefresh,
  verifyAccess,
  hashRefresh,
  validateRefreshHash,
};
