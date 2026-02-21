# Dev Auth Matrix (B1 — auth/bypass consistency)

Two modes for WS upgrade in dev. Use **one** consistently so upgrade never randomly fails.

---

## Mode A — Cookie JWT auth (default)

- **Frontend:** Do **not** set `VITE_DEV_BYPASS_AUTH` (or set it to anything other than `"true"`). Then `ALLOW_BYPASS_AUTH` is false (`myfrontend/frontend/src/config/flags.js`: `DEV_BYPASS_AUTH = VITE_DEV_BYPASS_AUTH === "true"`, `ALLOW_BYPASS_AUTH = DEV_BYPASS_AUTH && !IS_PROD`).
- **Backend:** Do **not** set `ALLOW_BYPASS_AUTH=true`, or run with `NODE_ENV=production` (bypass is disabled). Backend reads `request.headers.cookie`, extracts `JWT_COOKIE_NAME` (`token` by default; `backend/config/constants.js` line 22), validates JWT (`backend/websocket/connection/wsServer.js` ~388–418).
- **Cookie under proxy:** All API calls (login, /api/me, etc.) go through the same origin (e.g. `localhost:5173`) via `apiFetch` with relative paths (`/api/login`, etc.) and `credentials: 'include'` (`myfrontend/frontend/src/lib/http.js`). No hardcoded backend URL: fetch uses the relative path, so the browser sends the request to the frontend origin and the proxy forwards to the backend; `Set-Cookie` in the response is then stored for the **frontend origin**. WS connects to `window.location.host + '/ws'` (same origin), so the cookie is sent on the upgrade. **In dev:** (1) Do not set `COOKIE_DOMAIN` in the backend so the cookie is scoped to the request host. (2) Do not set `VITE_API_URL` or `VITE_WS_URL` so all requests stay same-origin and the proxy is used.

**Success:** Backend logs `ws_upgrade_token` with `tokenPresent: true`, then `ws_upgrade_resolved` with `userId`; helloHandler logs `sessionExists: true`; HELLO_ACK is sent.

---

## Mode B — DEV bypass auth (dev only)

- **Frontend:** Set in `.env` or `.env.local`:
  ```bash
  VITE_DEV_BYPASS_AUTH=true
  ```
  Then `ALLOW_BYPASS_AUTH` is true in dev (`flags.js`). `getWsUrl` in `wsClient.js` (lines 27–29) appends `?dev_user=dev_admin` to the WS URL.
- **Backend:** Set in `.env` or `.env.local`:
  ```bash
  NODE_ENV=development
  ALLOW_BYPASS_AUTH=true
  ```
  Bypass is enabled only when `NODE_ENV !== 'production'` and `ALLOW_BYPASS_AUTH === 'true'` (`backend/websocket/connection/wsServer.js`). If the request URL has `dev_user=` and bypass is enabled, the upgrade is accepted without a cookie and `ws_upgrade_bypass` is logged.

**Success:** WS URL includes `?dev_user=dev_admin`; backend logs `ws_upgrade_bypass` with `bypassUserId`, `userRole` and proceeds; helloHandler sees session (created for bypass user); HELLO_ACK is sent.

---

## Env summary (both sides)

| Side    | Mode A (cookie)        | Mode B (bypass)                          |
|---------|------------------------|------------------------------------------|
| **FE**  | `VITE_DEV_BYPASS_AUTH` unset or ≠ `"true"` | `VITE_DEV_BYPASS_AUTH=true`              |
| **BE**  | `ALLOW_BYPASS_AUTH` unset or ≠ `true`     | `ALLOW_BYPASS_AUTH=true`, `NODE_ENV≠production` |

Backend logs at startup whether bypass is enabled (B1 DEV line). Use the same mode on both sides; mixing (e.g. FE bypass + BE cookie-only) causes upgrade rejection.
