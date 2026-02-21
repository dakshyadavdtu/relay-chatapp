# Environment Template — Integrated Chat System

> **NEVER COMMIT REAL VALUES**  
> Do not commit `.env` or any file containing real `DB_URI`, `JWT_SECRET`, `REFRESH_PEPPER`, passwords, or API keys. Use `backend/.env.example` as a template; set real values only in local `.env` or server/CI secrets. See `docs/runbooks/SECRETS_POLICY.md`.

**Project layout (integrated repo):**

- **Repo root** — this directory; contains `backend/`, `myfrontend/`, and `docs/`.
- **backend/** — Node.js HTTP + WebSocket server, MongoDB client, auth, observability.
- **myfrontend/frontend/** — React + Vite frontend; proxies `/api` and `/ws` to backend.

No runtime behavior is changed by this document; it only defines the environment contract.

---

## 1. Backend required env vars

Run from **backend/** or set env when starting the backend process.

### MongoDB

| Variable    | Required | Description |
|------------|----------|-------------|
| `DB_URI`   | **Yes**  | MongoDB connection string. **Never commit real values.** Use env or local `.env` only. Example (placeholder): `mongodb+srv://<USER>:<PASSWORD>@<HOST>/<DB>?retryWrites=true&w=majority`. Production: must be `mongodb+srv://` (Atlas). Dev with local DB: set `ALLOW_LOCAL_DB=true`. |
| `DB_NAME`  | No       | Database name. Default: `mychat`. |

### JWT & cookies

| Variable | Required | Description |
|----------|----------|-------------|
| `JWT_SECRET` | **Yes** | Secret for signing/verifying access tokens. Must be non-empty. |
| `JWT_COOKIE_NAME` | No | Cookie name for access token. Default: `token`. |
| `REFRESH_COOKIE_NAME` | No | Cookie name for refresh token. Default: `refresh_token`. |
| `ACCESS_TOKEN_EXPIRES_IN_SECONDS` | No | Access token TTL (seconds). Default: `900` (15 min). |
| `REFRESH_TOKEN_EXPIRES_IN_SECONDS` | No | Refresh token TTL (seconds). Default: `604800` (7 days). |
| `REFRESH_PEPPER` | **Production** | Pepper for hashing refresh tokens. **Required in production** (non-empty). Empty allowed in dev. |
| `COOKIE_DOMAIN` | Production | Cookie domain (e.g. `.example.com`). Unset in dev so cookie is request-host scoped. |
| `COOKIE_SAME_SITE` | No | Cookie SameSite. Default: `Lax`. |

### CORS / origins (single source of truth)

Use **`CORS_ORIGIN`** (single) or **`CORS_ORIGINS`** (comma-separated). This list is used for **both** CORS response headers and OriginGuard (CSRF). There is no separate `ALLOWED_ORIGINS`; do not set it — it is ignored.

| Variable | Required | Description |
|----------|----------|-------------|
| `CORS_ORIGIN` | **Production** (if `CORS_ORIGINS` unset) | Single frontend origin. Example: `https://app.example.com`. |
| `CORS_ORIGINS` | **Production** (alternative to `CORS_ORIGIN`) | Comma-separated frontend origins. Example: `https://app.example.com,https://www.example.com`. Takes priority over `CORS_ORIGIN` when set. |
| Dev default | — | If both unset in dev: `http://localhost:5173`, `http://127.0.0.1:5173`; any localhost/127.0.0.1 origin is allowed. Missing Origin/Referer allowed (e.g. curl). |

### HTTP body limit

| Variable | Required | Description |
|----------|----------|-------------|
| `HTTP_BODY_LIMIT` | No | Max size for JSON and URL-encoded request bodies. Default: `256kb`. Examples: `256kb`, `512kb`, `1mb`. Does **not** affect multipart file uploads (those use multer and their own `fileSize` limit). |

### WebSocket

| Variable | Required | Description |
|----------|----------|-------------|
| `WS_PATH` | **Production** | WebSocket path. Default: `/ws`. |
| `PORT` | No | HTTP/WS server port. Dev default: `8000` (to match Vite proxy). Production default: `3001`. |
| `DEV_TOKEN_MODE` | No | Dev-only. If `true`, backend accepts dev token mode (e.g. token in query for WS). **Must never be enabled in production;** server will fail-fast at startup. |
| `NODE_ENV` | No | `development` or `production`. Affects defaults and validation. |

### Rate limits (WS)

| Variable | Default | Description |
|----------|--------|-------------|
| `WS_RATE_LIMIT_MESSAGES` | `100` | Max messages per window. |
| `WS_RATE_LIMIT_WINDOW_MS` | `60000` | Window in ms (1 min). |
| `WS_RATE_LIMIT_SENSITIVE_ROOM_ACTIONS` | `20` | Cap for sensitive room actions per window. |
| `WS_RATE_LIMIT_WARNING_THRESHOLD` | `0.8` | Warning at 80% of limit. |
| `WS_VIOLATIONS_BEFORE_THROTTLE` | `2` | Violations before throttling. |
| `WS_MAX_VIOLATIONS` | `5` | Violations before connection closure. |

### Admin bootstrap

| Variable | Required | Description |
|----------|----------|-------------|
| `ROOT_ADMIN_EMAIL` | No (but required for root admin) | **Root admin bootstrap:** the only email treated as root admin. Case-insensitive. This user gets `role: ADMIN` on **registration** and `isRootAdmin: true` on login; only this user can promote/revoke ADMIN and is immune to ban. |
| **Root admin email** | **Config** | Set `ROOT_ADMIN_EMAIL=<your-root-admin@example.com>` to enable root admin. Use a dedicated email for your project; never commit real addresses. |
| `DEV_SEED_ADMIN` | No | If `true`, ensures a user `dev_admin` (ADMIN role) exists at startup. Idempotent. For dev only; not root admin. |
| `DEV_SEED_ADMIN_PASSWORD` | No | Password for seeded `dev_admin`. Use a placeholder in docs; never commit real values. |

**Render examples (CORS / origins):**

- Single frontend: `CORS_ORIGIN=https://<frontend>.onrender.com`
- Multiple: `CORS_ORIGINS=https://<frontend>.onrender.com,https://<custom-domain>`
- **Rule:** No path, no query, no hash. Trailing slash is tolerated (canonicalized to origin) but not recommended; use `https://host` not `https://host/`.

**Verification (after deploy):** POST to a state-changing route with the frontend origin; expect **not** `CSRF_BLOCKED` and proper CORS headers:

```bash
curl -s -o /dev/null -w "%{http_code}" -X POST "https://<backend>.onrender.com/api/login" \
  -H "Origin: https://<frontend>.onrender.com" -H "Content-Type: application/json" -d '{}'
# Expect: 200 or 401 (not 403). Response headers should include Access-Control-Allow-Origin when Origin is allowed.
```

**Observed bug (fixed):** A trailing slash in config (e.g. `https://app.onrender.com/`) while the browser sends `https://app.onrender.com` used to cause 403 CSRF_BLOCKED. Origins are now canonicalized with `URL.origin`, so trailing slash no longer causes a mismatch.

**Checklist for Render UI env var setup (backend):**

- [ ] Set `CORS_ORIGIN` or `CORS_ORIGINS` to the frontend origin(s) only — no path, query, or hash (e.g. `https://<frontend>.onrender.com`).
- [ ] Do **not** set `ALLOWED_ORIGINS`; it is ignored. CORS and OriginGuard both use `CORS_ORIGIN` / `CORS_ORIGINS`.
- [ ] After deploy, run the curl verification above; expect 200 or 401 (not 403) and CORS headers when Origin matches.

---

**Root admin mechanism (summary):**

1. Set `ROOT_ADMIN_EMAIL=<your-root-admin@example.com>` in the backend environment.
2. Register a user with **email** matching that value (and any username). The backend assigns `role: ADMIN` and treats this user as root.
3. On login, `auth` middleware sets `req.user.isRootAdmin = true` only when the user's email matches `ROOT_ADMIN_EMAIL`.
4. Root-only routes (e.g. role change, root users list) use `requireRootAdmin`; only this user can promote/demote admins and cannot be banned.

---

## 2. Frontend required env vars

Build-time (Vite). Prefix: `VITE_*`. Set in `myfrontend/frontend/.env` or `.env.local` or when running `npm run dev`.

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_BACKEND_PORT` | No | Backend port for Vite proxy. Must match backend `PORT`. Default: `8000`. |
| `VITE_DEV_TOKEN_MODE` | No | Dev-only. If `true`, use sessionStorage for tokens and send Bearer + `x-dev-token-mode: 1`; no cookies for API. **Must never be enabled in production;** app will fail-fast on load. |
| `VITE_ENABLE_WS` | No | If `false`, WS client does not connect. Unset or `true` to enable WebSocket. |
| `VITE_DEV_BYPASS_AUTH` | No | If `true`, WS URL can include `?dev_user=...` for dev bypass. Set to `false` or unset for real login/cookies. |
| `VITE_USE_MOCK_CHAT` | No | If `true` (dev only), use mock chat data. Ignored in production. |

**Multi-tab auth:** With cookie mode (default), only one account per browser; if another tab logs in as a different user, the first tab shows a "Session switched" banner and redirects to login. With `VITE_DEV_TOKEN_MODE=true`, tokens are stored per-tab (sessionStorage) so each tab can be a different user. See `myfrontend/frontend/docs/AUTH_MULTI_TAB.md`.

**API / WS base:** In dev, the frontend uses the same origin (e.g. `http://localhost:5173`). Vite proxies `/api` and `/ws` to `http://localhost:${VITE_BACKEND_PORT}`. Do not set a separate `VITE_API_URL` or `VITE_WS_URL` in dev so the proxy is used and cookies work.

---

## 3. Development defaults

- **Backend:** `PORT=8000`, `NODE_ENV=development`. `DB_URI` and `JWT_SECRET` must be set (no default). CORS/origin defaults to localhost:5173; any localhost/127.0.0.1 origin allowed. Missing Origin/Referer allowed (e.g. curl).
- **Frontend:** `VITE_BACKEND_PORT=8000`, proxy to `http://localhost:8000` and `ws://localhost:8000`. Use cookie auth (do not set `VITE_DEV_BYPASS_AUTH=true` for baseline smoke).
- **Root admin:** Set `ROOT_ADMIN_EMAIL` to your root admin email and register with that email to get root admin.

---

## 4. Production notes

- **Backend:** `config/env.validate.js` runs at startup. In production (`NODE_ENV=production`), these are **required** and have no silent defaults: `NODE_ENV`, `PORT`, `JWT_SECRET`, `DB_URI`, `REFRESH_PEPPER`, `COOKIE_DOMAIN`, `CORS_ORIGIN` (or `CORS_ORIGINS`), `WS_PATH`. `DB_URI` must be Atlas (`mongodb+srv://`) unless dev + `ALLOW_LOCAL_DB=true`. **Never commit real values;** inject via server env or secret manager.
- **Frontend:** Build with `vite build`; ensure `VITE_BACKEND_PORT` (or your API/WS base) matches the deployed backend. In production, set `CORS_ORIGIN` or `CORS_ORIGINS` on the backend to the frontend origin(s).

---

## 5. Quick reference — root admin

| Item | Value |
|------|--------|
| Root admin email | Set to your dedicated admin email (e.g. `admin@yourdomain.com`) |
| Backend env | `ROOT_ADMIN_EMAIL=<your-root-admin@example.com>` |
| How to become root | Register with that email; backend assigns ADMIN and marks isRootAdmin on login. |
| Where enforced | `backend/config/constants.js` (ROOT_ADMIN_EMAIL), `backend/http/middleware/auth.middleware.js` (isRootAdmin), `backend/services/user.service.js` (initial role on register), `backend/http/controllers/admin.controller.js` (ban immune, role change). |
