# Render Deployment Pre-Check

Pre-render readiness sweep: audit consistency and minimal code changes for deploy/runtime safety. **No feature work.**

---

## 1. Backend — Render Web Service

### Root directory
- **`backend`** (monorepo root is repo root; set Render "Root Directory" to `backend` so `server.js` and `package.json` are the app root).

### Build command
- **Leave empty** or `npm install --omit=dev` if you use a build step. The app runs from source; no compile step required.

### Start command
- **`node server.js`**  
  (or `npm start`, which runs `node server.js` per `backend/package.json`).

### Health check path
- **`/health`** or **`/api/health`**  
  Both return `200` and `{ "ok": true }`. Use **`/health`** for Render health checks (defined in `backend/app.js` before the `/api` router).

### Required environment variables

| Variable | Description | Secret |
|----------|-------------|--------|
| `NODE_ENV` | `production` | No |
| `PORT` | Set by Render; optional override | No |
| `JWT_SECRET` | JWT signing secret (32+ chars) | **Yes** |
| `DB_URI` | MongoDB Atlas SRV connection string | **Yes** |
| `REFRESH_PEPPER` | Pepper for refresh token hashing | **Yes** |
| `COOKIE_DOMAIN` | Cookie domain (see Cookie notes below) | No |
| `WS_PATH` | WebSocket path, e.g. `/ws` (must match frontend) | No |
| `CORS_ORIGIN` or `CORS_ORIGINS` | At least one: frontend origin(s), e.g. `https://your-frontend.onrender.com` | No |
| `METRICS_SECRET` | Required in prod when metrics mode is `secret` (default); header `x-metrics-key` | **Yes** |

Optional (with safe defaults):

| Variable | Description | Default |
|----------|-------------|---------|
| `METRICS_MODE` | `open` / `secret` / `admin` / `disabled` | Prod: `secret` |
| `HTTP_BODY_LIMIT` | JSON/urlencoded body limit | `256kb` |
| `JWT_COOKIE_NAME` | Cookie name for access token | `token` |

**Do not set on Render (dev-only):** `DEV_TOKEN_MODE`, `ENABLE_DEV_ROUTES`, `DEV_ROUTES_KEY`, `DEV_SESSION_KEY`, `ALLOW_LOCAL_DB`.

---

## 2. Frontend — Render Static Site

### Build command
- **`npm install && npm run build`**  
  Run from the **frontend app root** (see Publish directory below).

### Publish directory
- **`myfrontend/frontend/dist`**  
  Set Render "Root Directory" to **`myfrontend/frontend`** so that build runs in that folder and output is `dist`. Then set "Publish Directory" to **`dist`** (or `myfrontend/frontend/dist` if root is repo root).

### Required build-time environment variables

For **same-origin** deploy (frontend and backend on one Render Web Service, or same domain via proxy): none required.

For **split deploy** (Static Site + Web Service on different Render URLs):

| Variable | Description |
|----------|-------------|
| `VITE_API_BASE_URL` | Backend origin, e.g. `https://your-backend.onrender.com` (no trailing slash). Used for API and to derive WS URL if `VITE_WS_URL` is not set. |
| `VITE_WS_URL` | (Optional) Full WebSocket URL, e.g. `wss://your-backend.onrender.com/ws`. If unset, derived from `VITE_API_BASE_URL` + path. |
| `VITE_WS_PATH` | (Optional) WebSocket path; default `/ws`. Only needed if backend uses a path other than `/ws`. |

Optional (defaults are safe):

| Variable | Description |
|----------|-------------|
| `VITE_ENABLE_WS` | Set to `true` to enable WebSocket in UI | `true` |
| `VITE_BACKEND_PORT` | Dev only (Vite proxy); not used in production build | — |

**Never set in production build:** `VITE_DEV_TOKEN_MODE` (code throws in prod if set). Do not set `VITE_DEV_TOKEN_MODE` in Render env for the frontend build.

---

## 3. Cookie / CORS — “If/Then” notes

### If using httpOnly cookies (current design)

- **CORS:** Backend uses **`config/origins.js`** only (`CORS_ORIGIN` or `CORS_ORIGINS`). **`ALLOWED_ORIGINS` is deprecated and ignored.**  
- **Credentials:** CORS middleware sets `Access-Control-Allow-Credentials: true` when `Origin` is allowed (`backend/http/middleware/cors.middleware.js`).  
- **Cookie settings:** `backend/config/cookieConfig.js`: in production, `Secure` is true, `SameSite` is `Lax` (or from `COOKIE_SAME_SITE`), `Domain` from `COOKIE_DOMAIN`.

### Recommended COOKIE_DOMAIN on Render

- **Do not set `COOKIE_DOMAIN=.onrender.com`.** That would share cookies across all `*.onrender.com` and is insecure.
- **Production requires `COOKIE_DOMAIN`** (env.validate.js); it cannot be omitted.
- **Preferred:**  
  - **Host-only cookie:** Set `COOKIE_DOMAIN` to the **exact backend hostname with no leading dot**, e.g. `your-backend.onrender.com`. Cookie is then scoped to that host only. For split deploy (static site on another host), the browser will not send this cookie to the frontend origin, so login from the frontend will break unless you use one of the options below.
  - **Custom domain (split deploy):** If you use e.g. `app.mycompany.com` (static) and `api.mycompany.com` (backend), set `COOKIE_DOMAIN=.mycompany.com` so the cookie is sent to both.
- **Split deploy on default Render URLs** (e.g. `myapp.onrender.com` and `mybackend.onrender.com`): use either a **single Web Service** (backend serves static + API, same origin) or a **custom domain** with `COOKIE_DOMAIN=.yourdomain.com`.

---

## 4. Code changes made (minimal, required for deploy/safety)

### 4.1 Backend: use `WS_PATH` when attaching WebSocket server

**File:** `backend/server.js`

**Reason:** `env.validate.js` requires `WS_PATH` in production, but the server was not passing it to the WebSocket server, so the upgrade path was always `/ws`. Render (and any proxy) must match the path.

**Change:** Pass `path` from env when attaching the WebSocket server:

```diff
-  const wsCore = attachWebSocketServer(server);
+  const wsPath = process.env.WS_PATH || '/ws';
+  const wsCore = attachWebSocketServer(server, { path: wsPath });
```

### 4.2 Frontend: use `VITE_API_BASE_URL` in browser for split deploy

**File:** `myfrontend/frontend/src/utils/api.js`

**Reason:** In a split deploy (Static Site + Web Service), the browser must send API requests to the backend origin. Previously `getApiBase()` returned `""` in the browser, so API always went same-origin.

**Change:** Use build-time `VITE_API_BASE_URL` / `VITE_API_URL` in all environments when set:

```diff
-export function getApiBase() {
-  if (typeof window !== "undefined") return "";
-  const base = import.meta.env.VITE_API_BASE_URL ?? import.meta.env.VITE_API_URL;
-  return typeof base === "string" ? base.replace(/\/$/, "") : "";
-}
+export function getApiBase() {
+  const base = import.meta.env.VITE_API_BASE_URL ?? import.meta.env.VITE_API_URL;
+  const trimmed = typeof base === "string" ? base.replace(/\/$/, "") : "";
+  if (typeof window !== "undefined") return trimmed;
+  return trimmed;
+}
```

### 4.3 Frontend: WebSocket URL from env for split deploy

**File:** `myfrontend/frontend/src/config/ws.js`

**Reason:** On split deploy, WS must connect to the backend (wss + backend host + path). The client now respects `VITE_WS_URL` or derives WS URL from `VITE_API_BASE_URL` and optional `VITE_WS_PATH`.

**Change:** Use `VITE_WS_URL` when set; otherwise derive from `getApiBase()` + path (or same-origin + path). Path from `VITE_WS_PATH` or `/ws`. Production builds use `wss` when origin is https.

---

## 5. Audit consistency (verified)

- **Export uses textContent only:** `myfrontend/frontend/src/components/settings/SettingsModal.jsx` (e.g. lines 61, 86, 93): export/print use `textContent` for message content; no `innerHTML`/`document.write` for user content.
- **metricsAccessGuard:** `backend/http/middleware/metricsAccess.middleware.js` enforces `x-metrics-key` in production when mode is `secret`; `METRICS_SECRET` required by `config/env.validate.js` in that case.
- **env.validate production list:** Includes `NODE_ENV`, `JWT_SECRET`, `DB_URI`, `REFRESH_PEPPER`, `WS_PATH`, and at least one of `CORS_ORIGIN`/`CORS_ORIGINS`; `COOKIE_DOMAIN` is required in prod (see cookie notes above).
- **Body limit:** `backend/http/index.js` uses `BODY_LIMIT = process.env.HTTP_BODY_LIMIT || '256kb'` for `express.json` and `express.urlencoded` (lines 67–71).
- **Origin guard:** Uses only CORS_ORIGIN/CORS_ORIGINS via `config/origins.js`; ALLOWED_ORIGINS is deprecated/ignored.
- **Dev-only flags:** `DEV_TOKEN_MODE` is blocked in production in `env.validate.js`. Dev routes are only mounted when `ENABLE_DEV_ROUTES=true` and `DEV_ROUTES_KEY` or `DEV_SESSION_KEY` is set; do not set these on Render.
- **WS upgrade logging:** Full request URL is only logged in dev (`isDev` block in `backend/websocket/connection/wsServer.js`); production does not log tokens or full URL with query.

---

## 6. Local verification steps

Run from repo root.

### Backend

1. **Env and start**
   ```bash
   cd backend
   cp .env.example .env
   # Set NODE_ENV=development, PORT=8000, JWT_SECRET=test, DB_URI=..., REFRESH_PEPPER=test, COOKIE_DOMAIN=, CORS_ORIGIN=http://localhost:5173, WS_PATH=/ws (and METRICS_SECRET if NODE_ENV=production)
   npm run dev
   ```
2. **Health**
   ```bash
   curl -s -o /dev/null -w "%{http_code}" http://localhost:8000/health
   curl -s -o /dev/null -w "%{http_code}" http://localhost:8000/api/health
   ```
   **Success:** Both return `200`.
3. **WebSocket path**
   - With `WS_PATH=/ws`, connect to `ws://localhost:8000/ws` (e.g. browser or `wscat`). Connection should upgrade.
   - With `WS_PATH=/custom`, only `ws://localhost:8000/custom` should upgrade; `/ws` should not.
4. **Body limit**
   ```bash
   curl -s -X POST http://localhost:8000/api/login -H "Content-Type: application/json" -d '{"a":"'$(python3 -c 'print("x"*300000)')'"}' -w "%{http_code}"
   ```
   **Success:** `413` or `PAYLOAD_TOO_LARGE` when over limit.

### Frontend

1. **Build (split deploy simulation)**
   ```bash
   cd myfrontend/frontend
   VITE_API_BASE_URL=https://your-backend.onrender.com npm run build
   ```
   **Success:** Build completes; no runtime error from `VITE_DEV_TOKEN_MODE` in prod build.
2. **Dev token mode guard**
   - Production build with `VITE_DEV_TOKEN_MODE=true` should throw at runtime (fail-fast in `tokenTransport.js`). Optional: verify by building with that env and opening the app.

### Full stack (same-origin dev)

1. Backend: `cd backend && npm run dev` (e.g. PORT=8000).
2. Frontend: `cd myfrontend/frontend && npm run dev` (Vite proxy to backend).
3. Open `http://localhost:5173`, log in, open a chat, confirm WebSocket connects and messages send/receive.
4. **Success:** No CORS/credential errors; WS connects; messages work.

---

## 7. What success looks like

- Backend starts with production env (required vars set); `/health` and `/api/health` return 200.
- WebSocket upgrades only on the configured `WS_PATH` (e.g. `/ws`).
- Frontend build with `VITE_API_BASE_URL` set produces a bundle that calls the backend and (when `VITE_WS_URL` or same base is used) connects WS to the backend with wss in production.
- No logging of tokens or full request URLs with query in production WS upgrade path.
- Export/print use only `textContent` for user message content; metrics are protected by secret header in prod; body limit and CORS/origin config match the audit.
