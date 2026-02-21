/**
 * DEV-only auth: access/refresh tokens when VITE_DEV_TOKEN_MODE=true.
 *
 * - When dev token mode is ON: we use sessionStorage (per-tab) so each tab can be
 *   logged in as a different account. WS URL and Authorization header read from here.
 * - When dev token mode is OFF: production uses cookie-based auth; get/set/clear
 *   are no-ops for storage (tokens live in httpOnly cookies).
 *
 * Why cookie mode cannot do multi-account per tab: the browser sends one cookie
 * per origin; logging in as another user in another tab overwrites that cookie, so
 * all tabs share the same session. Session-switched detection is used to show a
 * clear message and redirect instead of silent 401.
 */

const KEY_ACCESS = 'dev_access_token';
const KEY_REFRESH = 'dev_refresh_token';

// Fail-fast: dev token mode must never run in production (runs on module import)
if (typeof import.meta !== 'undefined' && import.meta.env?.PROD === true && import.meta.env?.VITE_DEV_TOKEN_MODE === 'true') {
  throw new Error('VITE_DEV_TOKEN_MODE must never be enabled in production.');
}

export function isDevTokenMode() {
  return typeof import.meta !== 'undefined' && import.meta.env?.VITE_DEV_TOKEN_MODE === 'true';
}

/** In dev token mode use sessionStorage (per-tab); otherwise no storage. */
function getStorage() {
  if (!isDevTokenMode()) return null;
  if (typeof sessionStorage === 'undefined') return null;
  return sessionStorage;
}

export function getAccessToken() {
  const storage = getStorage();
  if (!storage) return null;
  try {
    return storage.getItem(KEY_ACCESS);
  } catch {
    return null;
  }
}

export function getRefreshToken() {
  const storage = getStorage();
  if (!storage) return null;
  try {
    return storage.getItem(KEY_REFRESH);
  } catch {
    return null;
  }
}

export function setTokens({ accessToken, refreshToken }) {
  const storage = getStorage();
  if (!storage) return;
  try {
    if (accessToken != null) storage.setItem(KEY_ACCESS, accessToken);
    if (refreshToken != null) storage.setItem(KEY_REFRESH, refreshToken);
  } catch {
    /* ignore */
  }
}

export function clearTokens() {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.removeItem(KEY_ACCESS);
    storage.removeItem(KEY_REFRESH);
  } catch {
    /* ignore */
  }
}
