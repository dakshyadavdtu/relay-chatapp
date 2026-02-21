/**
 * Single HTTP client for /api. All backend calls MUST use this (Vite proxy /api -> backend).
 *
 * 401/refresh policy (Phase 2.3):
 * - Session-protected requests (/api/* except login/register/forgot/reset/refresh): on 401 we attempt
 *   POST /api/auth/refresh once, then retry the original request at most once. No infinite refresh loops.
 * - Only refresh 401/403 logs out: handleSessionExpired() and redirect to /login ONLY when the refresh
 *   request itself returns 401 or 403 (true session invalid). Network errors, 5xx, or other failures
 *   do NOT redirect — we emit auth_degraded and throw AuthDegradedError so the user stays on page.
 * - Login/register/refresh endpoints never trigger refresh; dev-token mode never uses cookie refresh.
 * When VITE_DEV_TOKEN_MODE=true, credentials: omit, Authorization Bearer + x-dev-token-mode only.
 *
 * Proactive refresh: in cookie mode, refresh before access expires so WS-active users don't hit 401.
 * - Dedupe: one in-flight refresh; concurrent 401s or proactive calls await the same promise.
 * - Never refresh when path is /api/auth/refresh (no infinite loop).
 *
 * WS-connected refresh loop (cookie mode only; no-op in devTokenMode):
 * - Timer created: scheduleProactiveRefreshFromWs() on HELLO_ACK → setTimeout(runWsRefreshLoop, 9 min). Only one loop;
 *   scheduleProactiveRefreshFromWs() calls stopProactiveRefreshInterval() first so previous loop is cleared.
 * - Timer cleared: stopProactiveRefreshInterval() on (1) handleSessionExpired (2) wsClient onStatus('disconnected').
 * - Bounded: next run only after 9 min (success) or 2 min backoff (5xx/network); 401/403 → handleSessionExpired once, no reschedule.
 * - Same doRefresh() as 401 path (single-flight); only logout on 401/403 from refresh endpoint.
 */

import { setAuthState, getAuthState } from '@/state/auth.state';
import { wsClient } from '@/transport/wsClient';
import { normalizeBackendError, toUserMessage } from './errorMap';
import { isDevTokenMode, getAccessToken, clearTokens } from '@/features/auth/tokenTransport';
import { isCookieMode, getLastSeenUserId } from '@/features/auth/sessionSwitch';
import { emitAuthChanged } from './authEvents';

const PUBLIC_PATHS = ['/login', '/register', '/forgot', '/reset'];
const REFRESH_PATH = '/api/auth/refresh';
const ME_PATH = '/api/me';

/** Paths that benefit from proactive refresh (cookie mode). */
const PROACTIVE_REFRESH_PATHS = ['/api/me', '/api/chats', '/api/users', '/api/rooms'];
/** Proactive refresh interval when WS is active (9 min; access often ~10 min). */
const PROACTIVE_REFRESH_INTERVAL_MS = 9 * 60 * 1000;
/** Min gap between refresh attempts to avoid storms (10s). */
const MIN_REFRESH_GAP_MS = 10 * 1000;
/** Backoff after 5xx or network failure in WS refresh loop (do not logout; retry later). */
const BACKOFF_AFTER_5XX_MS = 2 * 60 * 1000;

/** Module-level: one in-flight refresh promise; concurrent callers await it. */
let inFlightRefreshPromise = null;
/** Last successful refresh timestamp (for proactive and rate limit). */
let lastRefreshAt = 0;
/** Single timer for WS-connected refresh loop (setTimeout; cleared on close/reconnect). Only one exists at a time. */
let proactiveRefreshTimerId = null;
/** When true, do not attempt refresh until next successful login (avoids tight loop after refresh 401). */
let refreshDisabledUntilLogin = false;

/**
 * @param {{ path?: string, lastFailedUrl?: string, lastStatus?: number, host?: string, cookiePresent?: boolean }} [context] - Optional context (kept for caller compatibility).
 */
function handleSessionExpired(context) {
  stopProactiveRefreshInterval();
  wsClient.shutdown('session_expired'); // Phase 5: close WS and disable reconnect before clearing auth
  if (isDevTokenMode()) clearTokens();
  setAuthState({ user: null, isAuthenticated: false, isLoading: false, error: null });
  if (typeof window !== 'undefined') {
    const path = window.location.pathname;
    const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(p + '/'));
    if (!isPublic) {
      window.location.assign('/login');
    }
  }
}

/**
 * Clear the WS-connected refresh loop. Called on session expiry and on WS close/disconnect.
 * Exactly one loop can exist; this clears it so a new HELLO_ACK can start a fresh one.
 */
function stopProactiveRefreshInterval() {
  if (proactiveRefreshTimerId != null) {
    clearTimeout(proactiveRefreshTimerId);
    proactiveRefreshTimerId = null;
  }
}

/**
 * Perform POST /api/auth/refresh once. Dedupes: concurrent callers get the same promise.
 * Never call this when the current request path is REFRESH_PATH (caller must guard).
 * If refresh previously returned 401, skip network and resolve with 401 until next login.
 * @returns {Promise<{ ok: boolean, status: number }>} ok true if 200, status for 401/403/5xx.
 */
function doRefresh() {
  if (refreshDisabledUntilLogin) {
    return Promise.resolve({ ok: false, status: 401, response: null });
  }
  if (inFlightRefreshPromise != null) {
    return inFlightRefreshPromise;
  }
  const origin = getApiOrigin();
  const refreshUrl = origin ? `${origin}${REFRESH_PATH}` : REFRESH_PATH;
  if (typeof import.meta !== 'undefined' && import.meta.env?.DEV) {
    console.debug('[apiFetch] refresh url=', refreshUrl, 'credentials=include');
  }
  inFlightRefreshPromise = (async () => {
    try {
      const refreshRes = await fetch(refreshUrl, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const ok = refreshRes.ok && refreshRes.status === 200;
      const status = refreshRes.status;
      if (status === 401 || status === 403) {
        refreshDisabledUntilLogin = true;
      }
      if (status === 429) {
        // rate limited
      }
      if (ok) lastRefreshAt = Date.now();
      return { ok, status, response: refreshRes };
    } finally {
      inFlightRefreshPromise = null;
    }
  })();
  return inFlightRefreshPromise;
}

/**
 * Proactive refresh: in cookie mode, if path is "important" and we haven't refreshed recently, refresh once.
 * Skips REFRESH_PATH, auth endpoints, dev token mode. Rate-limited by MIN_REFRESH_GAP_MS.
 */
async function ensureRefreshBeforeRequest(pathNorm, options) {
  if (pathNorm === REFRESH_PATH || pathNorm.startsWith(REFRESH_PATH + '?')) return;
  if (refreshDisabledUntilLogin) return;
  if (
    pathNorm === '/api/login' ||
    pathNorm === '/api/register' ||
    pathNorm.startsWith('/api/forgot') ||
    pathNorm.startsWith('/api/reset')
  )
    return;
  if (isDevTokenMode()) return;
  if (!isCookieMode()) return;
  const isImportant = PROACTIVE_REFRESH_PATHS.some((p) => pathNorm === p || pathNorm.startsWith(p + '/'));
  if (!isImportant) return;
  const now = Date.now();
  if (lastRefreshAt > 0 && now - lastRefreshAt < PROACTIVE_REFRESH_INTERVAL_MS) return;
  if (lastRefreshAt > 0 && now - lastRefreshAt < MIN_REFRESH_GAP_MS) return;
  await doRefresh();
}

/**
 * One shot of the WS-connected refresh loop: call refresh (single-flight), then reschedule or logout.
 * - 401/403: handleSessionExpired once, shutdown WS; no reschedule.
 * - 200: reschedule next in PROACTIVE_REFRESH_INTERVAL_MS (bounded, no storm).
 * - 5xx/network: backoff, reschedule in BACKOFF_AFTER_5XX_MS (do not logout).
 */
async function runWsRefreshLoop() {
  proactiveRefreshTimerId = null;
  if (isDevTokenMode() || !isCookieMode()) return;
  if (refreshDisabledUntilLogin) return;
  try {
    const result = await doRefresh();
    if (result.status === 401 || result.status === 403) {
      const origin = getApiOrigin();
      const refreshUrl = origin ? `${origin}${REFRESH_PATH}` : REFRESH_PATH;
      const logoutContext =
        typeof window !== 'undefined'
          ? {
              path: window.location.pathname,
              lastFailedUrl: refreshUrl,
              lastStatus: result.status,
              host: window.location.host,
              cookiePresent: undefined,
            }
          : undefined;
      handleSessionExpired(logoutContext);
      return;
    }
    if (result.ok) {
      proactiveRefreshTimerId = setTimeout(runWsRefreshLoop, PROACTIVE_REFRESH_INTERVAL_MS);
    } else {
      if (result.status === 429) {
        // rate limited
      }
      proactiveRefreshTimerId = setTimeout(runWsRefreshLoop, BACKOFF_AFTER_5XX_MS);
    }
  } catch (_) {
    proactiveRefreshTimerId = setTimeout(runWsRefreshLoop, BACKOFF_AFTER_5XX_MS);
  }
}

/**
 * Call when WS receives HELLO_ACK: start the single WS-connected refresh loop.
 * Only one loop exists; any previous loop is cleared. Loop is cleared on WS close (onStatus disconnected).
 * Cookie mode only; no-op in devTokenMode. Uses same doRefresh() as http 401 path (single-flight dedupe).
 */
export function scheduleProactiveRefreshFromWs() {
  if (isDevTokenMode() || !isCookieMode()) return;
  stopProactiveRefreshInterval();
  proactiveRefreshTimerId = setTimeout(runWsRefreshLoop, PROACTIVE_REFRESH_INTERVAL_MS);
}

/** Reset refresh guard so refresh is attempted again after next login. Call on successful login. */
export function clearRefreshDisabledUntilLogin() {
  refreshDisabledUntilLogin = false;
}

/** Cookie mode: another tab logged in; show clear message and redirect (no generic 401). */
function handleSessionSwitched() {
  wsClient.shutdown('session_switched');
  setAuthState({
    user: null,
    isAuthenticated: false,
    isLoading: false,
    error: null,
    sessionSwitched: true,
  });
  if (typeof window !== 'undefined') {
    window.location.assign('/login?reason=session_switched');
  }
}

export class UnauthorizedError extends Error {
  constructor(message = 'Unauthorized') {
    super(message);
    this.name = 'UnauthorizedError';
    this.code = 'UNAUTHORIZED';
  }
}

/** Thrown when refresh failed for reasons other than 401/403 (e.g. network error, 5xx). No logout. */
export class AuthDegradedError extends Error {
  constructor(message = 'Auth temporarily unavailable', options = {}) {
    super(message);
    this.name = 'AuthDegradedError';
    this.code = options.code ?? 'AUTH_DEGRADED';
    this.status = options.status;
    this.reason = options.reason;
  }
}

/**
 * Backend origin for API requests.
 * - Production with Vercel proxy: leave VITE_BACKEND_HTTP_URL unset → returns '' so requests go to same-origin /api (proxied to Render).
 * - Production without proxy: set VITE_BACKEND_HTTP_URL to backend origin (e.g. https://relay-chatapp.onrender.com).
 * - Dev: unset = current origin (Vite proxy); set = explicit backend.
 * @returns {string} Origin with no trailing slash, or '' for same-origin (relative /api paths).
 */
export function getApiOrigin() {
  const raw = import.meta.env.VITE_BACKEND_HTTP_URL;
  const trimmed = typeof raw === 'string' ? raw.trim().replace(/\/$/, '') : '';
  if (trimmed && /localhost|127\.0\.0\.1/i.test(trimmed) && import.meta.env.PROD) {
    throw new Error('VITE_BACKEND_HTTP_URL must not point to localhost in production.');
  }
  if (trimmed) return trimmed;
  return '';
}

/**
 * @param {string} path - Path starting with /api (e.g. /api/me)
 * @param {RequestInit & { body?: object, __retried?: boolean }} options - fetch options; body object is JSON.stringify'd; __retried is internal
 * @returns {Promise<{ success: boolean, data?: any, error?: string, code?: string }>} Parsed JSON
 */
function apiBaseUrl() {
  return getApiOrigin();
}

/** DEV only: detect /api/chats call burst (possible regression). Reset every 2s; warn once if >2 in window. */
let _chatsCallCount = 0;
let _chatsCallWindowEnd = 0;
let _chatsBurstWarned = false;
const CHATS_BURST_WINDOW_MS = 2000;
const CHATS_BURST_THRESHOLD = 2;

export async function apiFetch(path, options = {}) {
  const { body, __retried, credentials: _cred, mode: _mode, ...rest } = options;
  const pathNorm = path.startsWith('/') ? path : `/${path}`;
  const url = apiBaseUrl() ? `${apiBaseUrl()}${pathNorm}` : pathNorm;

  if (typeof import.meta !== 'undefined' && import.meta.env?.DEV) {
    const isChatsList = pathNorm === '/api/chats' || pathNorm.startsWith('/api/chats?');
    if (isChatsList) {
      const now = Date.now();
      if (now > _chatsCallWindowEnd) {
        _chatsCallWindowEnd = now + CHATS_BURST_WINDOW_MS;
        _chatsCallCount = 0;
      }
      _chatsCallCount += 1;
      if (_chatsCallCount > CHATS_BURST_THRESHOLD && !_chatsBurstWarned) {
        _chatsBurstWarned = true;
        console.warn('[apiFetch] Possible /api/chats regression: >', CHATS_BURST_THRESHOLD, 'calls within', CHATS_BURST_WINDOW_MS / 1000, 's. See docs/REPEATED_API_CALLS_ROOT_CAUSE_REPORT.md');
      }
    }
  }

  await ensureRefreshBeforeRequest(pathNorm, options);
  const method = rest.method || (body != null ? 'POST' : 'GET');
  const headers = {
    'Content-Type': 'application/json',
    ...rest.headers,
  };
  const devTokenMode = isDevTokenMode();
  if (devTokenMode) {
    const token = getAccessToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
      headers['x-dev-token-mode'] = '1';
    }
  }
  const credentials = devTokenMode ? 'omit' : 'include';
  if (typeof import.meta !== 'undefined' && import.meta.env?.DEV && (pathNorm === ME_PATH || pathNorm.startsWith(ME_PATH + '/') || pathNorm === REFRESH_PATH || pathNorm.startsWith(REFRESH_PATH + '?'))) {
    console.debug('[apiFetch]', pathNorm === REFRESH_PATH || pathNorm.startsWith(REFRESH_PATH + '?') ? 'refresh' : 'me', 'url=', url, 'credentials=', credentials);
  }
  const res = await fetch(url, {
    ...rest,
    method,
    credentials,
    headers,
    ...(body != null && typeof body === 'object' && { body: JSON.stringify(body) }),
  });

  if (res.status === 429) {
    // rate limited
  }
  if (res.status === 401) {
    let correlationId;
    try {
      correlationId =
        typeof globalThis !== 'undefined' &&
        globalThis.crypto &&
        typeof globalThis.crypto.randomUUID === 'function'
          ? globalThis.crypto.randomUUID()
          : String(Date.now());
    } catch (_) {
      correlationId = String(Date.now());
    }

    const isRefreshCall = pathNorm === REFRESH_PATH || pathNorm.startsWith(REFRESH_PATH + '?');
    const alreadyRetried = __retried === true;
    const isMe = pathNorm === ME_PATH;
    const isAuthEndpointNoRefresh =
      pathNorm === '/api/login' ||
      pathNorm === '/api/register' ||
      pathNorm.startsWith('/api/forgot') ||
      pathNorm.startsWith('/api/reset') ||
      isRefreshCall;

    // Cookie mode: if /me 401 and another tab logged in (fingerprint differs), show session-switched
    if (isCookieMode() && isMe && getAuthState().user?.id) {
      const lastSeen = getLastSeenUserId();
      if (lastSeen != null && String(lastSeen) !== String(getAuthState().user?.id)) {
        const json = await res.json().catch(() => ({}));
        handleSessionSwitched();
        const msg = json?.error || 'Another account was used in another tab. Please sign in again.';
        const err = new UnauthorizedError(msg);
        err.status = 401;
        throw err;
      }
    }

    if (isAuthEndpointNoRefresh || alreadyRetried || devTokenMode) {
      const json = await res.json().catch(() => ({}));
      const logoutContext =
        typeof window !== 'undefined'
          ? { path: window.location.pathname, lastFailedUrl: url, lastStatus: res.status, host: window.location.host, cookiePresent: undefined }
          : undefined;
      handleSessionExpired(logoutContext);
      const msg = json?.error || toUserMessage(json?.code) || 'Unauthorized';
      const err = new UnauthorizedError(msg);
      err.status = 401;
      throw err;
    }

    const origin = getApiOrigin();
    const refreshUrl = origin ? `${origin}${REFRESH_PATH}` : REFRESH_PATH;

    let refreshResult;
    try {
      refreshResult = await doRefresh();
    } catch (networkErr) {
      const cid = correlationId ?? String(Date.now());
      emitAuthChanged('auth_degraded', { reason: 'refresh_network_error', correlationId: cid });
      throw new AuthDegradedError('Temporary network error. Please try again.', {
        code: 'NETWORK_ERROR',
        reason: 'refresh_network_error',
      });
    }

    const refreshRes = refreshResult.response;
    if (refreshResult.status === 401 || refreshResult.status === 403) {
      const json = await refreshRes.json().catch(() => ({}));
      const logoutContext =
        typeof window !== 'undefined'
          ? { path: window.location.pathname, lastFailedUrl: refreshUrl, lastStatus: refreshResult.status, host: window.location.host, cookiePresent: undefined }
          : undefined;
      handleSessionExpired(logoutContext);
      const msg = json?.error || toUserMessage(json?.code) || 'Session expired';
      const err = new UnauthorizedError(msg);
      err.status = refreshResult.status;
      throw err;
    }

    if (refreshResult.ok) {
      const cid = correlationId ?? String(Date.now());
      emitAuthChanged('refresh', { correlationId: cid });
      return apiFetch(path, { ...options, __retried: true });
    }

    const cid = correlationId ?? String(Date.now());
    emitAuthChanged('auth_degraded', {
      reason: 'refresh_failed',
      status: refreshResult.status,
      correlationId: cid,
    });
    const json = await res.json().catch(() => ({}));
    const msg = json?.error || toUserMessage(json?.code) || 'Temporarily unavailable';
    throw new AuthDegradedError(msg, {
      code: 'AUTH_DEGRADED',
      status: refreshResult.status,
      reason: 'refresh_failed',
    });
  }

  let json;
  try {
    json = await res.json();
  } catch {
    if (!res.ok) {
      const msg = res.statusText || 'Request failed';
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }
    throw new Error('Invalid JSON response');
  }

  if (!res.ok) {
    const normalized = normalizeBackendError({ code: json?.code, error: json?.error, message: json?.message, details: json?.details });
    const err = new Error(normalized.message);
    err.code = normalized.code;
    err.status = res.status;
    throw err;
  }

  return json;
}

if (typeof wsClient !== 'undefined' && wsClient.subscribe) {
  wsClient.subscribe({
    handleMessage(msg) {
      if (msg?.type === 'HELLO_ACK') scheduleProactiveRefreshFromWs();
    },
    onStatus(status) {
      if (status === 'disconnected') stopProactiveRefreshInterval();
    },
  });
}
