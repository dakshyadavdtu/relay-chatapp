/**
 * Cookie-mode only: detect when another tab has logged in as a different account.
 * Cookie auth is shared across tabs (one cookie per origin), so we cannot have
 * multi-account per tab; we show a clear "Session switched" message and redirect.
 *
 * - On successful /me or login we set localStorage.auth_user_id_last_seen = user.id.
 * - When another tab logs in, it overwrites that key. This tab's storage event
 *   fires with the new value; if it differs from our current user id we show
 *   session-switched and redirect.
 */

const STORAGE_KEY_LAST_SEEN_USER_ID = 'auth_user_id_last_seen';

export function isCookieMode() {
  try {
    return typeof import.meta !== 'undefined' && import.meta.env?.VITE_DEV_TOKEN_MODE !== 'true';
  } catch {
    return true;
  }
}

export function setLastSeenUserId(userId) {
  if (!isCookieMode()) return;
  if (typeof localStorage === 'undefined') return;
  try {
    if (userId != null) localStorage.setItem(STORAGE_KEY_LAST_SEEN_USER_ID, String(userId));
    else localStorage.removeItem(STORAGE_KEY_LAST_SEEN_USER_ID);
  } catch {
    /* ignore */
  }
}

export function getLastSeenUserId() {
  if (typeof localStorage === 'undefined') return null;
  try {
    return localStorage.getItem(STORAGE_KEY_LAST_SEEN_USER_ID);
  } catch {
    return null;
  }
}

/**
 * Install storage listener for cookie mode. When auth_user_id_last_seen changes
 * (set by another tab on login) and the new value !== currentUserId, call onSessionSwitched().
 * @param {() => string | null} getCurrentUserId - function that returns current user id
 * @param {() => void} onSessionSwitched - called when we detect another tab logged in
 * @returns {() => void} unsubscribe
 */
export function subscribeSessionSwitch(getCurrentUserId, onSessionSwitched) {
  if (!isCookieMode()) return () => {};

  const handler = (e) => {
    if (e.key !== STORAGE_KEY_LAST_SEEN_USER_ID || e.newValue == null) return;
    const current = getCurrentUserId();
    if (current == null) return;
    if (String(e.newValue) !== String(current)) {
      onSessionSwitched();
    }
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }
  return () => {};
}
