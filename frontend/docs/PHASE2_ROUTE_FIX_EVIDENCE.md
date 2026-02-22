# Phase 2 — Frontend auth route fix evidence

## Files changed

| File | Changes |
|------|--------|
| `src/main.jsx` | Production hard-fail: require `VITE_BACKEND_HTTP_URL` and `VITE_BACKEND_WS_URL`; reject localhost in prod. |
| `src/lib/http.js` | Added `getApiBase()`; `API_BASE` uses it (PROD: no localhost); added `/api/auth/login` to refresh skip lists. |
| `src/utils/api.js` | `getApiBase` re-exported from `@/lib/http` (single canonical source). |
| `src/http/auth.api.js` | Login endpoint: `/api/login` → `/api/auth/login`. |

## Auth call sites (before → after)

| Location | Old endpoint | New endpoint | Method | Credentials |
|----------|--------------|--------------|--------|-------------|
| `auth.api.js` `loginUser` | `/api/login` | `/api/auth/login` | POST | via apiFetch (include in cookie mode) |
| `auth.api.js` `getCurrentUser` | `/api/me` | `/api/me` (unchanged) | GET | include |
| `auth.api.js` `registerUser` | `/api/register` | `/api/register` (unchanged) | POST | include |
| `auth.api.js` `logoutUser` (cookie) | `/api/logout` | `/api/logout` (unchanged) | POST | include |
| `auth.api.js` `logoutUser` (dev-token) | `/api/logout/current` | `/api/logout/current` (unchanged) | POST | omit (Bearer) |
| `lib/http.js` `doRefresh` | `/api/auth/refresh` | `/api/auth/refresh` (unchanged) | POST | include |
| `lib/http.js` `apiFetch` (me) | `/api/me` | `/api/me` (unchanged) | GET | include |
| `auth.api.js` `patchMe` | `/api/me` | `/api/me` (unchanged) | PATCH | include |
| `auth.api.js` `changePassword` | `/api/me/password` | `/api/me/password` (unchanged) | PATCH | include |

## API base and URLs

- **Canonical base:** `getApiBase()` in `src/lib/http.js` returns `(VITE_BACKEND_HTTP_URL || "").replace(/\/+$/, "")`.
- **Production:** All API URLs are `${apiBase}/api/...`; `apiBase` is required (throw at startup if missing).
- **No relative-only in prod:** `buildApiUrl(path)` always prefixes with `API_BASE` in prod (no empty base).

## Credentials

- `apiFetch` (lib/http.js): `credentials: devTokenMode ? 'omit' : 'include'` — all auth-sensitive calls use apiFetch.
- Direct fetch (export/upload/debug): `credentials: "include"` in chat.api.js, upload.api.js, AuthDebugButton.

## WebSocket

- App uses `getWsUrl()` from `src/config/ws.js` (transport/wsClient.js). PROD: `VITE_BACKEND_WS_URL` required and must not be localhost (config/ws throws). main.jsx also throws at startup if missing.

## Verification

- No remaining references to `/auth/login` without `/api` in `src/`.
- `localhost:8000` only in DEV fallback in `lib/http.js` (`API_BASE`) and in comments (`config/api.js`); never used in production code paths.
- Production build includes the env-check error message and `/api/auth/login` in the bundle.

## Frontend must call (summary)

- **Login:** `POST {VITE_BACKEND_HTTP_URL}/api/auth/login` (or `/api/login`) with body `{ usernameOrEmail, password }`, `credentials: "include"`.
- **Refresh:** `POST {VITE_BACKEND_HTTP_URL}/api/auth/refresh`, `credentials: "include"`.
- **Logout:** `POST {VITE_BACKEND_HTTP_URL}/api/logout` (and `/api/logout/current` in dev-token mode).
- **Current user:** `GET {VITE_BACKEND_HTTP_URL}/api/me`, `credentials: "include"`.
