# Render deployment

Exact steps for deploying this app on Render **without Docker**: backend as a **Web Service**, frontend as a **Static Site**. Health path, WebSocket path, and env vars are documented below.

---

## 1. Backend — Render Web Service

- **Root directory:** Set Render "Root Directory" to **`backend`** (so `server.js` and `package.json` are the app root).
- **Build command:** Leave empty or use `npm install --omit=dev`. App runs from source; no compile step.
- **Start command:** **`node server.js`** (or `npm start`).
- **Health check path:** **`/health`** — returns `200` and `{ "ok": true }`. (Also `/api/health`; use `/health` for Render.)
- **WebSocket path:** **`/ws`** by default; override with env **`WS_PATH`** (e.g. `/ws`). Must match frontend `VITE_WS_PATH` / `VITE_WS_URL` if split deploy.

### Required environment variables (backend)

| Variable | Description | Secret |
|----------|-------------|--------|
| `NODE_ENV` | `production` | No |
| `PORT` | Set by Render; optional override | No |
| `JWT_SECRET` | JWT signing secret (32+ chars) | **Yes** |
| `DB_URI` | MongoDB Atlas SRV connection string | **Yes** |
| `REFRESH_PEPPER` | Pepper for refresh token hashing | **Yes** |
| `COOKIE_DOMAIN` | Cookie domain (see Cookie notes below) | No |
| `WS_PATH` | WebSocket path, e.g. `/ws` (must match frontend) | No |
| `CORS_ORIGIN` or `CORS_ORIGINS` | At least one: frontend origin(s) | No |
| `METRICS_SECRET` | Required in prod when metrics mode is `secret`; header `x-metrics-key` | **Yes** |

Optional: `METRICS_MODE`, `HTTP_BODY_LIMIT`, `JWT_COOKIE_NAME`.  
**Do not set on Render (dev-only):** `DEV_TOKEN_MODE`, `ENABLE_DEV_ROUTES`, `DEV_ROUTES_KEY`, `DEV_SESSION_KEY`, `ALLOW_LOCAL_DB`.

---

## 2. Frontend — Render Static Site

- **Root directory:** Set Render "Root Directory" to **`myfrontend/frontend`**.
- **Build command:** **`npm install && npm run build`**.
- **Publish directory:** **`dist`** (output of the build).

### Build-time environment variables (frontend)

For **same-origin** deploy (backend serves frontend or same domain): none required.

For **split deploy** (Static Site + Web Service on different Render URLs):

| Variable | Description |
|----------|-------------|
| `VITE_API_BASE_URL` | Backend origin, e.g. `https://your-backend.onrender.com` (no trailing slash). Used for API and to derive WS URL if `VITE_WS_URL` is not set. |
| `VITE_WS_URL` | (Optional) Full WebSocket URL, e.g. `wss://your-backend.onrender.com/ws`. If unset, derived from `VITE_API_BASE_URL` + path. |
| `VITE_WS_PATH` | (Optional) WebSocket path; default `/ws`. Only if backend uses a path other than `/ws`. |

Optional: `VITE_ENABLE_WS` (default `true`).  
**Never set in production build:** `VITE_DEV_TOKEN_MODE`.

---

## 3. Cookie / CORS

- **CORS:** Backend uses only **`CORS_ORIGIN`** or **`CORS_ORIGINS`** (via `config/origins.js`). `ALLOWED_ORIGINS` is deprecated and ignored.
- **Cookie:** In production, set **`COOKIE_DOMAIN`** to the exact backend hostname (e.g. `your-backend.onrender.com`) for host-only cookie. For split deploy with a custom domain (e.g. `app.example.com` and `api.example.com`), set `COOKIE_DOMAIN=.example.com`. **Do not set `COOKIE_DOMAIN=.onrender.com`** (insecure).

---

## 4. Success criteria

- Backend starts with production env; `/health` returns 200.
- WebSocket upgrades only on the configured `WS_PATH` (e.g. `/ws`).
- Frontend build with `VITE_API_BASE_URL` set produces a bundle that calls the backend and connects WS to the backend (wss in production when origin is https).
