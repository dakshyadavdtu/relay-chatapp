'use strict';

const crypto = require('crypto');

/**
 * JWT Secret - MUST come from process.env. No default; fail fast if missing.
 * @type {string}
 */
const JWT_SECRET = (function () {
  const secret = process.env.JWT_SECRET;
  if (secret === undefined || secret === '' || (typeof secret === 'string' && secret.trim() === '')) {
    throw new Error('JWT_SECRET is required but was not provided via environment variables.');
  }
  return secret;
})();

/**
 * Base64URL encode
 * @param {string} str - String to encode
 * @returns {string} Base64URL encoded string
 */
function base64UrlEncode(str) {
  return Buffer.from(str)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

/**
 * Base64URL decode
 * @param {string} str - Base64URL encoded string
 * @returns {string} Decoded string
 */
function base64UrlDecode(str) {
  // Replace URL-safe characters
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  
  // Add padding if necessary
  const padding = base64.length % 4;
  if (padding) {
    base64 += '='.repeat(4 - padding);
  }
  
  return Buffer.from(base64, 'base64').toString('utf8');
}

/** Default clock tolerance for access tokens only (ms). Reduces immediate logout from minor skew or just-expired token. */
const ACCESS_TOKEN_CLOCK_TOLERANCE_MS = 30 * 1000; // 30 seconds

/**
 * Verify JWT signature
 * @param {string} token - JWT token string
 * @param {string} secret - Secret key for verification
 * @param {{ clockToleranceMs?: number }} [options] - Optional. clockToleranceMs: treat as expired only if now >= exp*1000 + clockToleranceMs (use for access tokens only; omit for strict validation e.g. refresh).
 * @returns {Object|null} Decoded payload or null if invalid
 */
function verifyJwt(token, secret = JWT_SECRET, options = {}) {
  if (!token || typeof token !== 'string') {
    return null;
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }

  const [headerB64, payloadB64, signatureB64] = parts;

  try {
    // Verify signature
    const signatureInput = `${headerB64}.${payloadB64}`;
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(signatureInput)
      .digest('base64url');

    // Timing-safe comparison to prevent timing attacks
    const signatureBuffer = Buffer.from(signatureB64);
    const expectedBuffer = Buffer.from(expectedSignature);

    if (signatureBuffer.length !== expectedBuffer.length) {
      return null;
    }

    if (!crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) {
      return null;
    }

    // Decode payload
    const payload = JSON.parse(base64UrlDecode(payloadB64));

    // Check expiration: consider expired only if now >= exp*1000 + tolerance (tolerance only for access tokens)
    const skewMs = options.clockToleranceMs != null ? Number(options.clockToleranceMs) : 0;
    if (payload.exp && Date.now() >= payload.exp * 1000 + skewMs) {
      return null;
    }

    // Check not-before
    if (payload.nbf && Date.now() < payload.nbf * 1000) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

/**
 * Extract user ID from JWT payload
 * @param {Object} payload - Decoded JWT payload
 * @returns {string|null} User ID or null
 */
function extractUserId(payload) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  // Common JWT user ID field names
  return payload.userId || payload.user_id || payload.sub || null;
}

/**
 * Sign JWT token
 * HTTP-owned authentication: JWT creation happens ONLY in auth.controller
 * @param {Object} payload - JWT payload object
 * @param {string} payload.userId - User ID (required)
 * @param {number} [expiresInSeconds] - Token expiration in seconds (default: 7 days)
 * @param {string} [secret] - Secret key for signing (default: JWT_SECRET)
 * @returns {string} Signed JWT token
 */
function signJwt(payload, expiresInSeconds = 7 * 24 * 60 * 60, secret = JWT_SECRET) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Payload must be an object');
  }

  if (!payload.userId) {
    throw new Error('Payload must contain userId');
  }

  const now = Math.floor(Date.now() / 1000);
  const exp = now + expiresInSeconds;

  const fullPayload = {
    ...payload,
    iat: now, // Issued at
    exp, // Expiration
    nbf: now, // Not before
  };

  // JWT header
  const header = {
    alg: 'HS256',
    typ: 'JWT',
  };

  // Encode header and payload
  const headerB64 = base64UrlEncode(JSON.stringify(header));
  const payloadB64 = base64UrlEncode(JSON.stringify(fullPayload));

  // Create signature
  const signatureInput = `${headerB64}.${payloadB64}`;
  const signature = crypto
    .createHmac('sha256', secret)
    .update(signatureInput)
    .digest('base64url');

  // Return complete JWT
  return `${headerB64}.${payloadB64}.${signature}`;
}

module.exports = {
  signJwt,
  verifyJwt,
  extractUserId,
  JWT_SECRET,
  ACCESS_TOKEN_CLOCK_TOLERANCE_MS,
};
