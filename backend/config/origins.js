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
 * Wildcard allowlist entries (in CORS_ORIGINS, CORS_ORIGIN, or CORS_ORIGIN_PATTERNS):
 *   - Any entry containing '*' is treated as a wildcard over the host portion.
 *   - Only https:// is allowed for wildcards (http:// is not allowed via wildcard).
 *   - Examples: https://relay-chatapp-vercel-frontend.vercel.app (exact),
 *     https://relay-chatapp-vercel-frontend-*.vercel.app, https://*.vercel.app
 */

const isProduction = process.env.NODE_ENV === 'production';

const DEV_DEFAULTS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];

/** Regex cache for wildcard patterns (pattern string -> RegExp). */
const wildcardRegexCache = new Map();

/**
 * Converts a wildcard origin pattern to a RegExp for full-origin match.
 * Escapes regex special chars, then replaces * with .*.
 * Only use for patterns that start with https:// and contain *.
 *
 * @param {string} pattern - e.g. "https://relay-chatapp-vercel-frontend-*.vercel.app"
 * @returns {RegExp}
 */
function wildcardToRegExp(pattern) {
  if (wildcardRegexCache.has(pattern)) return wildcardRegexCache.get(pattern);
  // Placeholder for * so we don't escape it, then escape regex specials, then replace * with .*
  const escaped = pattern
    .replace(/\*/g, '\u0000')
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\u0000/g, '.*');
  const re = new RegExp('^' + escaped + '$');
  wildcardRegexCache.set(pattern, re);
  return re;
}

/**
 * Validates a wildcard origin pattern for env validation.
 * Must be https:// only, origin-shaped (no path), and contain at least one *.
 *
 * @param {string} patternStr - Trimmed pattern string
 * @returns {boolean}
 */
function validateWildcardOriginPattern(patternStr) {
  if (typeof patternStr !== 'string' || !patternStr.trim()) return false;
  const s = patternStr.trim();
  if (!s.startsWith('https://') || !s.includes('*')) return false;
  // No path: after "https://" there must be no further /
  if (s.slice(8).includes('/')) return false;
  return true;
}

/**
 * Validates that a pattern string is one of the allowed origin patterns (for env validation).
 * @deprecated Prefer wildcard entries in CORS_ORIGINS; still supported for backward compat.
 * @param {string} patternStr - Trimmed pattern string from CORS_ORIGIN_PATTERNS
 * @returns {boolean}
 */
function validateOriginPatternString(patternStr) {
  return validateWildcardOriginPattern(patternStr);
}

/** Remove trailing slash(es) from env origin/pattern so https://x/ -> https://x */
function stripTrailingSlash(s) {
  return typeof s === 'string' ? s.replace(/\/+$/, '') : s;
}

function parseOriginPatterns() {
  const raw = (process.env.CORS_ORIGIN_PATTERNS || '').trim();
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => stripTrailingSlash(s.trim()))
    .filter(Boolean)
    .filter(validateWildcardOriginPattern);
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
  // Prefer CORS_ORIGINS (comma-separated), else CORS_ORIGIN (single). Trim and normalize trailing slash.
  const corsOrigins = (process.env.CORS_ORIGINS || '').trim();
  let list = [];
  if (corsOrigins) {
    list = corsOrigins.split(',').map((s) => stripTrailingSlash(s.trim())).filter(Boolean);
  }
  if (list.length === 0) {
    const corsOrigin = (process.env.CORS_ORIGIN || '').trim();
    if (corsOrigin) list = [stripTrailingSlash(corsOrigin)];
  }
  if (list.length === 0) return DEV_DEFAULTS;

  const out = [];
  for (const entry of list) {
    if (entry.includes('*')) {
      if (validateWildcardOriginPattern(entry)) out.push(entry);
    } else {
      try {
        out.push(normalizeOrigin(entry));
      } catch {
        // Skip invalid entries
      }
    }
  }
  // Merge CORS_ORIGIN_PATTERNS (wildcard strings only)
  const patterns = parseOriginPatterns();
  for (const p of patterns) {
    if (!out.includes(p)) out.push(p);
  }
  return out.length ? out : DEV_DEFAULTS;
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
  cached = { allowedOrigins: dedupe(list) };
  return cached;
}

/** One-line string of effective allowlist for production startup logs. */
function getAllowlistSummary() {
  const { allowedOrigins } = getAllowedOrigins();
  return allowedOrigins.join(', ');
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
 * Exact match against allowlist (both sides canonical), or wildcard match for entries containing '*',
 * or in dev any localhost/127.0.0.1 (any port). Wildcards only match https:// origins.
 *
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

  const { allowedOrigins } = getAllowedOrigins();
  if (allowedOrigins.includes(canonicalOrigin)) return true;
  if (!isProduction && isLocalhostOrigin(canonicalOrigin)) return true;
  // Wildcard match: only https:// origins; each allowlist entry that contains * is treated as pattern
  if (canonicalOrigin.startsWith('https://')) {
    for (const entry of allowedOrigins) {
      if (entry.includes('*')) {
        try {
          if (wildcardToRegExp(entry).test(canonicalOrigin)) return true;
        } catch {
          // ignore invalid pattern
        }
      }
    }
  }
  return false;
}

module.exports = {
  getAllowedOrigins,
  get allowedOrigins() {
    return getAllowedOrigins().allowedOrigins;
  },
  getAllowlistSummary,
  isAllowedOrigin,
  normalizeOrigin,
  stripTrailingSlash,
  validateOriginFormat,
  validateWildcardOriginPattern,
  validateOriginPatternString,
  wildcardToRegExp,
  isLocalhostOrigin,
};
