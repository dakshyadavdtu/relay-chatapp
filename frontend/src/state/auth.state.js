/**
 * Auth state module. Phase 6C: /api/me is single source of truth.
 * - user: current user from GET /api/me (null if not authenticated)
 * - isAuthenticated: true only when user exists
 * - isLoading: true until initial GET /api/me completes
 * - sessionSwitched: true when another tab logged in (cookie mode); show banner and redirect to login
 */
let state = {
  user: null,
  isLoading: true, // start loading until GET /api/me resolves (avoids redirect before auth known)
  isAuthenticated: false,
  error: null,
  authFailureFlag: false, // blocks reconnect after auth error
  sessionSwitched: false,
};

const listeners = new Set();

export function getAuthState() {
  return { ...state };
}

export function setAuthState(next) {
  state = { ...state, ...next };
  // Clear session-switched when we become authenticated again
  if (state.isAuthenticated && state.sessionSwitched) {
    state = { ...state, sessionSwitched: false };
  }
  listeners.forEach((fn) => fn());
}

export function subscribeAuth(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
