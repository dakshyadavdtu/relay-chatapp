# Phase 0 Auth Readiness Audit

Doc-only audit: whether disabling bypass auth breaks login → chat in this repo. All references are file:line.

---

## 1) Endpoint table (path, method, controller fn)

**Sources:** `backend/http/routes/auth.routes.js` (mounted at `/api`, comment line 7); `backend/http/routes/dev.routes.js` (mounted at `/api/dev` only when `isDev` — `backend/http/index.js` lines 86–89).

| Path                | Method | Controller / middleware                                                   |
| ------------------- | ------ | ------------------------------------------------------------------------- |
| `/api/register`     | POST   | `authController.register` — auth.routes.js:19                             |
| `/api/login`        | POST   | `authController.login` — auth.routes.js:22                                |
| `/api/auth/refresh` | POST   | `authController.refresh` — auth.routes.js:25                              |
| `/api/logout`       | POST   | `authController.logout` — auth.routes.js:28                               |
| `/api/me`           | GET    | `requireAuth`, `authController.getMe` — auth.routes.js:30                  |
| `/api/dev/session`  | GET    | `devController.getDevSession` — dev.routes.js:15 (dev only)               |
| `/api/dev/whoami`   | GET    | `requireAuth`, `devController.getDevWhoami` — dev.routes.js:16 (dev only) |

---

## 2) Storage truth: in-memory vs persistent + exact location

**Source:** `backend/storage/user.store.js`.

- **In-memory.** No database; `userById` and `usernameToId` are `Map()` (lines 19–22). Comment lines 5–6: "In-memory store for Phase 6A real user model. Replace with database (PostgreSQL, MongoDB, etc.) for production."
- **Location:** `backend/storage/user.store.js`. `backend/services/user.service.js` uses this store for `create`, `findByUsername`, `findById` (via userStore only).

---

## 3) Bypass truth: which endpoint and which flags/env

**Bypass has two parts:**

1. **Dev session endpoint (mint cookie without password)**
   - **Endpoint:** `GET /api/dev/session` — dev.routes.js:15.
   - **Controller:** `backend/http/controllers/dev.controller.js` `getDevSession` (lines 39–85). Uses `userStore.createDevUser`, then `signJwt({ userId, role })` (no `sid`).
   - **Gates:**
     - Dev routes mounted only when `process.env.NODE_ENV !== 'production'` — backend/http/index.js:86–89.
     - Handler returns 404 in production — dev.controller.js:40–42.
     - Requires `X-DEV-KEY` header matching `process.env.DEV_SESSION_KEY` — dev.controller.js:29–33, 43–44.

2. **HTTP request bypass (skip JWT/session for requests)**
   - **Where:** `backend/http/middleware/auth.middleware.js` lines 49–66.
   - **Logic:** If `NODE_ENV !== 'production'` and `ALLOW_BYPASS_AUTH === 'true'` and `x-dev-user` header is non-empty, set `req.user = { userId, role, fromBypass: true }` and skip cookie/JWT/session.
   - **Backend env:** `ALLOW_BYPASS_AUTH=true` (and `NODE_ENV !== 'production'`). Env only; no flag file.
   - **Frontend:** `myfrontend/frontend/src/config/flags.js` — `ALLOW_BYPASS_AUTH = (VITE_DEV_BYPASS_AUTH === "true") && !IS_PROD`. When true, `myfrontend/frontend/src/lib/http.js` lines 46–48 add `headers['x-dev-user'] = 'dev_admin'` on every `apiFetch`. `myfrontend/frontend/src/components/auth/RequireAuth.jsx` lines 19–21: if `ALLOW_BYPASS_AUTH` then render children without requiring `/api/me`.

**Dev session login (frontend):** `myfrontend/frontend/src/http/auth.api.js` `devSessionLogin` (lines 52–72) calls `GET /api/dev/session?...` with `X-DEV-KEY` (from `VITE_DEV_SESSION_KEY`). Used when "Dev Login" is shown (e.g. when `VITE_ENABLE_DEV_SESSION=true`).

---

## 4) Frontend auth calls (real endpoints vs dev session)

**Sources:** `myfrontend/frontend/src/http/auth.api.js`, `myfrontend/frontend/src/hooks/useAuth.js`, `myfrontend/frontend/src/lib/http.js`.

- **Real auth (no mock):**
  - `getCurrentUser()` → `apiFetch("/api/me")` — auth.api.js:15.
  - `loginUser(data)` → `apiFetch("/api/login", { method: "POST", body: data })` — auth.api.js:28.
  - `registerUser(data)` → `apiFetch("/api/register", { method: "POST", body: data })` — auth.api.js:37.
  - `logoutUser()` → `apiFetch("/api/logout", { method: "POST", body: {} })` — auth.api.js:43.
- **Refresh:** No frontend call to `POST /api/auth/refresh` in the repo (refresh is backend/cookie flow).
- **Dev session:** `devSessionLogin(...)` → `GET /api/dev/session?userId=&role=` with `X-DEV-KEY` — auth.api.js:59–61.
- **Bypass:** When `ALLOW_BYPASS_AUTH` is true, every `apiFetch` adds `x-dev-user: 'dev_admin'` (http.js:46–48), and `RequireAuth` skips the `/api/me` check (RequireAuth.jsx:19–21). Auth init still runs `getCurrentUser()` → `/api/me` once (useAuth.js `runAuthInitOnce`); with bypass, backend responds 200 with synthetic user (auth.controller.js getMe lines 225–235).

---

## 5) Conclusion: If bypass disabled, can user login and reach /chat?

**Yes.** Exact conditions:

- **Bypass disabled** means: frontend `ALLOW_BYPASS_AUTH` is false (e.g. `VITE_DEV_BYPASS_AUTH` not `"true"` or prod build), and/or backend does not set `ALLOW_BYPASS_AUTH=true`. Then no `x-dev-user` bypass in auth middleware.
- **Real login flow:** User submits credentials → frontend calls `POST /api/login` (auth.api.js:28). Backend validates via `userService.validateCredentials` (auth.controller.js:78), creates session in sessionStore, issues access+refresh cookies, returns user. Frontend then calls `GET /api/me` (useAuth.js after loginUserApi); backend `requireAuth` + session check (requireAuth.js + sessionStore) and `getMe` return user. Auth state becomes authenticated; `RequireAuth` allows access to `/chat`.
- **Reach /chat:** Auth state is set from `GET /api/me` (auth.state, useAuth). Protected routes use `RequireAuth`; when bypass is off, it requires `isAuthenticated` (from /api/me). So login → /api/me succeeds → user can reach /chat.
- **Caveat:** User must exist in the **in-memory** user store (registered via `POST /api/register` or pre-seeded). After server restart, in-memory users are lost unless re-registered or re-seeded.
- **Summary:** Disabling bypass does **not** break login→chat for real credentials; it only removes the dev shortcut (header bypass and/or GET /api/dev/session). Bypass is gated by backend `NODE_ENV !== 'production'` and `ALLOW_BYPASS_AUTH=true`, plus frontend `VITE_DEV_BYPASS_AUTH=true` and non-prod build; dev session also requires `DEV_SESSION_KEY` / `VITE_DEV_SESSION_KEY` and (for the dev-login UI) `VITE_ENABLE_DEV_SESSION`.
