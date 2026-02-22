'use strict';

/**
 * Shared auth cookie options for local dev and production.
 * Host-only cookies (no Domain attribute) for reliable cross-site (e.g. Vercel→Render).
 * Production: SameSite=None; Secure so cookies work cross-site (frontend on Vercel, backend on Render).
 * CSRF is enforced by Origin/Referer allowlisting only (no x-csrf-token or csrf cookie).
 * Refresh cookie Path MUST be "/" so the browser sends it on /api/auth/refresh and /api/me.
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
/** Refresh cookie path: MUST be "/" so browser sends it on /api/auth/refresh and /api/me. Host-only (no domain). */
const REFRESH_COOKIE_PATH = process.env.REFRESH_COOKIE_PATH || '/';

if (process.env.NODE_ENV === 'production') {
  console.log('[cookie-config] production', {
    path: COOKIE_PATH,
    refreshCookiePath: REFRESH_COOKIE_PATH,
    secure: COOKIE_SECURE,
    sameSite: COOKIE_SAME_SITE,
    domain: COOKIE_DOMAIN ?? '(host-only)',
  });
} else {
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
