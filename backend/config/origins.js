'use strict';

/**
 * Single source of truth for allowed CORS/frontend origins.
 * Used by: origin guard (CSRF), CORS headers middleware, Helmet CSP connect-src.
 *
 * Env priority:
 *   a) CORS_ORIGINS (comma-separated) if set and non-empty
 *   b) else CORS_ORIGIN (single origin) if set and non-empty
 *   c) else dev defaults: http://localhost:5173, http://127.0.0.1:5173
 *
 * All stored and compared origins are canonical (URL.origin); trailing slashes
 * and path/query/fragment are rejected so they cannot cause mismatches.
 *
 * In dev: isAllowedOrigin also allows any localhost/127.0.0.1 with any port.
 *
 * Optional CORS_ORIGIN_PATTERNS (comma-separated): controlled wildcard patterns.
 * Only these two pattern strings are accepted (safe RegExp, https-only, full-origin match):
 *   https://relay-chatapp-vercel-frontend-*.vercel.app
 *   https://relay-chatapp-vercel-frontend-git-*.vercel.app
 */

const isProduction = process.env.NODE_ENV === 'production';

const DEV_DEFAULTS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];

/** Only these pattern strings are allowed; * becomes [a-zA-Z0-9-]+ for full-origin match. */
const ALLOWED_ORIGIN_PATTERN_STRINGS = [
  'https://relay-chatapp-vercel-frontend-*.vercel.app',
  'https://relay-chatapp-vercel-frontend-git-*.vercel.app',
];

/**
 * Validates that a pattern string is one of the allowed origin patterns (for env validation).
 * @param {string} patternStr - Trimmed pattern string from CORS_ORIGIN_PATTERNS
 * @returns {boolean}
 */
function validateOriginPatternString(patternStr) {
  return typeof patternStr === 'string' && ALLOWED_ORIGIN_PATTERN_STRINGS.includes(patternStr);
}

function compileOriginPattern(patternStr) {
  if (!ALLOWED_ORIGIN_PATTERN_STRINGS.includes(patternStr)) return null;
  if (patternStr === 'https://relay-chatapp-vercel-frontend-*.vercel.app') {
    return /^https:\/\/relay-chatapp-vercel-frontend-[a-zA-Z0-9-]+\.vercel\.app$/;
  }
  if (patternStr === 'https://relay-chatapp-vercel-frontend-git-*.vercel.app') {
    return /^https:\/\/relay-chatapp-vercel-frontend-git-[a-zA-Z0-9-]+\.vercel\.app$/;
  }
  return null;
}

function parseOriginPatterns() {
  const raw = (process.env.CORS_ORIGIN_PATTERNS || '').trim();
  if (!raw) return [];
  const list = raw.split(',').map((s) => s.trim()).filter(Boolean);
  const regexes = [];
  for (const entry of list) {
    const re = compileOriginPattern(entry);
    if (re) regexes.push(re);
  }
  return regexes;
}

/**
 * Normalize an origin string to canonical form (URL.origin).
 * Throws if input is invalid or contains path/query/fragment/credentials.
 *
 * @param {string} input - Raw origin or URL string
 * @returns {string} Canonical origin (e.g. "https://host" or "https://host:3000")
 * @throws {Error} If not http/https, has credentials, path, query, or hash
 */
function normalizeOrigin(input) {
  if (input === undefined || input === null || typeof input !== 'string') {
    throw new Error('Origin must be a non-empty string');
  }
  const s = input.trim();
  if (!s) throw new Error('Origin must be a non-empty string');

  const u = new URL(s);

  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error('Origin protocol must be http or https');
  }
  if (u.username || u.password) {
    throw new Error('Origin must not contain username or password');
  }
  if (u.pathname !== '' && u.pathname !== '/') {
    throw new Error('Origin must not contain a path');
  }
  if (u.search || u.hash) {
    throw new Error('Origin must not contain query or fragment');
  }

  return u.origin;
}

function parse() {
  const corsOrigins = (process.env.CORS_ORIGINS || '').trim();
  if (corsOrigins) {
    const list = corsOrigins.split(',').map((s) => s.trim()).filter(Boolean);
    if (list.length > 0) {
      return list.map((entry) => normalizeOrigin(entry));
    }
  }
  const corsOrigin = (process.env.CORS_ORIGIN || '').trim();
  if (corsOrigin) return [normalizeOrigin(corsOrigin)];
  return DEV_DEFAULTS;
}

/** Dedupe and return array (order preserved, first occurrence wins). */
function dedupe(arr) {
  const seen = new Set();
  return arr.filter((item) => {
    if (seen.has(item)) return false;
    seen.add(item);
    return true;
  });
}

let cached = null;

function getAllowedOrigins() {
  if (cached) return cached;
  const list = parse();
  const originPatternRegexes = parseOriginPatterns();
  cached = { allowedOrigins: dedupe(list), originPatternRegexes };
  return cached;
}

/**
 * Validate a single origin string (uses normalizeOrigin; same rules).
 * Used at startup (env.validate). Invalid origins (e.g. with path) return false.
 *
 * @param {string} origin
 * @returns {boolean}
 */
function validateOriginFormat(origin) {
  try {
    normalizeOrigin(origin);
    return true;
  } catch {
    return false;
  }
}

/**
 * True if origin is localhost or 127.0.0.1 with any port (http or https).
 * @param {string} origin
 * @returns {boolean}
 */
function isLocalhostOrigin(origin) {
  if (!origin || typeof origin !== 'string') return false;
  try {
    const u = new URL(origin);
    const host = u.hostname.toLowerCase();
    return (host === 'localhost' || host === '127.0.0.1') && (u.protocol === 'http:' || u.protocol === 'https:');
  } catch {
    return false;
  }
}

/**
 * Exact match against allowlist (both sides canonical), or in dev any localhost/127.0.0.1 (any port).
 * @param {string} origin
 * @returns {boolean}
 */
function isAllowedOrigin(origin) {
  if (!origin) return false;

  let canonicalOrigin;
  try {
    canonicalOrigin = normalizeOrigin(origin);
  } catch {
    return false;
  }

  const { allowedOrigins, originPatternRegexes } = getAllowedOrigins();
  if (allowedOrigins.includes(canonicalOrigin)) return true;
  if (!isProduction && isLocalhostOrigin(origin)) return true;
  // Pattern match: https-only, full-origin; no arbitrary domains
  if (canonicalOrigin.startsWith('https://') && originPatternRegexes.length > 0) {
    for (const re of originPatternRegexes) {
      if (re.test(canonicalOrigin)) return true;
    }
  }
  return false;
}

module.exports = {
  getAllowedOrigins,
  get allowedOrigins() {
    return getAllowedOrigins().allowedOrigins;
  },
  isAllowedOrigin,
  normalizeOrigin,
  validateOriginFormat,
  validateOriginPatternString,
  isLocalhostOrigin,
};
