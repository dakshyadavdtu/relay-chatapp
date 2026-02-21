'use strict';

/**
 * Shared auth cookie options for local dev and production.
 * Host-only cookies (no Domain attribute) for reliable cross-site (e.g. Vercel→Render).
 * Env overrides: COOKIE_SECURE, COOKIE_SAME_SITE, COOKIE_PATH, REFRESH_COOKIE_PATH. COOKIE_DOMAIN is not used for Set-Cookie (host-only).
 */
const rawDomain = process.env.COOKIE_DOMAIN;
const COOKIE_DOMAIN =
  rawDomain !== undefined && rawDomain !== null && String(rawDomain).trim() !== ''
    ? String(rawDomain).trim()
    : undefined;

const secureEnv = process.env.COOKIE_SECURE;
const COOKIE_SECURE =
  secureEnv === 'true'
    ? true
    : secureEnv === 'false'
      ? false
      : process.env.NODE_ENV === 'production';

const COOKIE_SAME_SITE =
  process.env.COOKIE_SAME_SITE ||
  (process.env.NODE_ENV === 'production' ? 'None' : 'Lax');
const COOKIE_PATH = process.env.COOKIE_PATH || '/';
/** Refresh cookie path: scoped so browser sends it only to refresh endpoint. Host-only (no domain). */
const REFRESH_COOKIE_PATH = process.env.REFRESH_COOKIE_PATH || '/api/auth/refresh';

if (process.env.NODE_ENV !== 'production') {
  console.warn('[cookie-config] effective', {
    secure: COOKIE_SECURE,
    sameSite: COOKIE_SAME_SITE,
    domain: COOKIE_DOMAIN ?? '(host-only)',
    path: COOKIE_PATH,
    refreshCookiePath: REFRESH_COOKIE_PATH,
  });
}

module.exports = {
  COOKIE_DOMAIN,
  COOKIE_SECURE,
  COOKIE_SAME_SITE,
  COOKIE_PATH,
  REFRESH_COOKIE_PATH,
};
