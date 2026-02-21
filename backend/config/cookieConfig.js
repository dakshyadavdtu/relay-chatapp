'use strict';

/**
 * Shared auth cookie options for local dev and production.
 * Env overrides (safe precedence): COOKIE_SECURE, COOKIE_SAME_SITE, COOKIE_DOMAIN, COOKIE_PATH.
 * Dev: secure=false, sameSite=Lax, domain=undefined (host-only).
 * Production: secure=true, sameSite=None for cross-site (e.g. Vercel→Render); set COOKIE_SAME_SITE=Lax for same-origin. Domain only if COOKIE_DOMAIN set.
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

if (process.env.NODE_ENV !== 'production') {
  console.warn('[cookie-config] effective', {
    secure: COOKIE_SECURE,
    sameSite: COOKIE_SAME_SITE,
    domain: COOKIE_DOMAIN ?? '(host-only)',
    path: COOKIE_PATH,
  });
}

module.exports = {
  COOKIE_DOMAIN,
  COOKIE_SECURE,
  COOKIE_SAME_SITE,
  COOKIE_PATH,
};
