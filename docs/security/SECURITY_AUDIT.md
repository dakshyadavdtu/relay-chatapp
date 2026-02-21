# Security Vulnerabilities & Render Deployment Readiness Audit

**Project:** Integrated frontend + chat backend (Node/Express + WebSocket + React/Vite)  
**Scope:** Full project — backend (`backend/`), frontend (`myfrontend/frontend/`), CI, config  
**Date:** February 2026  
**Purpose:** (i) Comprehensive list of all security vulnerabilities; (ii) Deployment readiness for Render.  
**Stored in:** `docs/security/SECURITY_AUDIT.md`

---

## Executive Summary

| Area | Summary |
|------|--------|
| **Vulnerabilities** | 1 Critical (export XSS — verify only), 3 High, 5 Medium, 7 Low; plus 1 low npm advisory (qs). |
| **Render readiness** | Backend and frontend are deployable with documented gaps: no `render.yaml`, env docs, ephemeral uploads, CI frontend/deploy steps. |

---

# PART I — COMPREHENSIVE VULNERABILITY AUDIT

## 1. Backend Vulnerabilities

### 1.1 HIGH: CORS / Origin guard configuration clarity

**Location:** `backend/config/origins.js`, `backend/http/middleware/originGuard.middleware.js`, `backend/.env.example`

**Details:**  
- Origin guard and CORS both use **the same source**: `config/origins.js` reads `CORS_ORIGINS` (comma-separated) or `CORS_ORIGIN` (single). There is no separate `ALLOWED_ORIGINS` in code.
- `.env.example` still mentions `ALLOWED_ORIGINS` as "DEPRECATED/IGNORED". If operators set only `ALLOWED_ORIGINS` expecting it to affect the origin allowlist, it has no effect — requests can be blocked (403 CSRF_BLOCKED) or operators may be confused.

**Risk:**  
Misconfiguration in production: legitimate traffic blocked, or operators using wrong env vars.

**Recommendation:**  
Document clearly that **only** `CORS_ORIGIN` or `CORS_ORIGINS` control both CORS and origin guard. Remove or clearly deprecate `ALLOWED_ORIGINS` in docs. For Render, set `CORS_ORIGIN` (or `CORS_ORIGINS`) to the frontend origin(s).

---

### 1.2 HIGH: JWT in WebSocket URL query string (dev-only; token in logs / Referer)

**Location:**  
Frontend WS URL builder (e.g. when `DEV_TOKEN_MODE` or dev bypass is used), backend WebSocket upgrade handling.

**Details:**  
When dev token mode is used, the access token can be sent in the WebSocket URL query (e.g. `?accessToken=...`). Backend reads it for upgrade.

**Risk:**  
Tokens in URLs are logged by proxies, load balancers, and server logs; can leak via Referer. If `DEV_TOKEN_MODE` is ever enabled in production, tokens would be exposed. Backend already exits at startup if `DEV_TOKEN_MODE=true` in production (`env.validate.js`).

**Recommendation:**  
Keep dev-only; ensure production never sets `DEV_TOKEN_MODE`. Do not log full `request.url` in production; strip query before logging. Prefer cookie or header for WS auth in non-cookie flows.

---

### 1.3 HIGH: Sensitive data in logs (sessions, tokens, user IDs)

**Location:**  
- `backend/websocket/` — logs can include `userId`, `sessionId`, connection identifiers.  
- `backend/http/controllers/export.controller.js` and others — `console.log` with `chatId`, `userId`.  
- Ad-hoc `console.log`/`console.error` with request data in controllers.

**Risk:**  
Session IDs, user IDs, or tokens in logs enable session hijacking or profiling; compliance issues (PII in logs).

**Recommendation:**  
Avoid logging tokens, full session IDs, or PII. Use structured logging with levels; redact or hash identifiers in production. Remove or guard debug logs that include `userId`/`chatId` in production paths.

---

### 1.4 MEDIUM: Dev routes when env enabled (IDOR-style if key weak/leaked)

**Location:** `backend/http/index.js` (lines 99–105), `backend/http/controllers/dev.controller.js`

**Details:**  
`GET /api/dev/debug/auth` and `GET /api/dev/chats/list?asUserId=...` are mounted when `ENABLE_DEV_ROUTES=true` and `DEV_ROUTES_KEY` (or `DEV_SESSION_KEY`) is set. They require header `x-dev-key` to match; otherwise 404. With a weak or leaked key, anyone could impersonate a user by ID.

**Risk:**  
If `NODE_ENV` is not `production` in a deployed environment, or dev key is weak/leaked, attackers can list any user’s chats without proper auth.

**Recommendation:**  
Keep dev routes behind both `ENABLE_DEV_ROUTES` and a strong `DEV_ROUTES_KEY`. Document that production must **never** set `ENABLE_DEV_ROUTES=true`. Optionally allowlist dev routes to localhost only.

---

### 1.5 MEDIUM: Cookie secure flag depends on NODE_ENV

**Location:** `backend/config/cookieConfig.js` (or equivalent)

**Details:**  
`COOKIE_SECURE` is typically `true` when `NODE_ENV === 'production'` unless overridden. Correct by design but fully env-dependent.

**Risk:**  
If production is run without `NODE_ENV=production`, cookies could be sent over HTTP.

**Recommendation:**  
Document that production **must** set `NODE_ENV=production`. Optionally set `COOKIE_SECURE=true` explicitly in production env for defense in depth.

---

### 1.6 MEDIUM: Image upload validation by MIME only (no magic bytes)

**Location:** `backend/http/controllers/uploads.controller.js`

**Details:**  
Allowed types: `image/jpeg`, `image/png`, `image/gif`, `image/webp`; check is based on `file.mimetype` only. No content-based (magic-byte) validation.

**Risk:**  
Spoofed `Content-Type` can allow non-image files (e.g. HTML/SVG) to be stored and served as images, leading to XSS or malware distribution.

**Recommendation:**  
Validate file content (magic bytes) for each allowed type; reject if content does not match declared type. Keep SVG and HTML out of the allowlist (current allowlist has no SVG — keep it that way).

---

### 1.7 MEDIUM: Dependency advisory — qs (DoS)

**Location:** Backend transitive dependency (e.g. via Express)

**Details:**  
`npm audit` reports: `qs` in range 6.7.0–6.14.1 — “arrayLimit bypass in comma parsing allows denial of service” (low severity, CWE-20).

**Risk:**  
Theoretical DoS via crafted query parsing.

**Recommendation:**  
Run `npm audit fix` (or upgrade Express/qs) in `backend/` and re-run tests; resolve any remaining advisories.

---

### 1.8 LOW: Root admin default username

**Location:** `backend/config/constants.js`

**Details:**  
`ROOT_ADMIN_USERNAME` may default to a fixed value (e.g. `'root_admin'`) when env is not set.

**Risk:**  
Information disclosure and predictable admin username in default setups.

**Recommendation:**  
Require `ROOT_ADMIN_USERNAME` (and `ROOT_ADMIN_EMAIL`) in production, or remove default and fail fast if root admin is configured without explicit env.

---

### 1.9 LOW: Metrics and health endpoints

**Location:** `backend/app.js`, `backend/http/middleware/metricsAccess.middleware.js`

**Details:**  
- `GET /metrics`: Protected by `metricsAccessGuard` (secret header in production by default, or open/disabled/admin per env).  
- `GET /health`, `GET /api/health`: Return `{ ok: true }` with no auth (appropriate for load balancers).

**Risk:**  
If metrics mode is misconfigured (e.g. `open` in prod without `ALLOW_PUBLIC_METRICS_IN_PROD`), metrics could be exposed. Health is low risk but must not expose stack or env details if extended.

**Recommendation:**  
Ensure production uses `METRICS_MODE=secret` (default) and sets `METRICS_SECRET`. Keep health minimal; do not return sensitive data in health responses.

---

### 1.10 LOW: Search regex from user input (ReDoS edge case)

**Location:** `backend/storage/message.mongo.js` — `searchMessagesInChats`

**Details:**  
Search query is regex-escaped (`replace(/[.*+?^${}()|[\]\\]/g, '\\$&')`) then used in `new RegExp(escaped, 'i')`. Escaping prevents injection; very long escaped strings could still cause slow regex matching in edge cases.

**Risk:**  
Low; escaping is correct. Possible ReDoS only with very long, complex escaped input.

**Recommendation:**  
Cap search query length (e.g. 200–500 characters) and consider a timeout or length limit on regex execution if needed.

---

### 1.11 LOW: No global HTTP rate limit (only per-route)

**Location:** `backend/http/index.js`, `backend/http/middleware/rateLimit.middleware.js`

**Details:**  
Rate limiters are applied per route (auth, logout, message send, report, admin). There is no global per-IP rate limit on the entire `/api` tree.

**Risk:**  
An attacker can hit many unrated endpoints (e.g. GETs) at high volume and contribute to resource exhaustion.

**Recommendation:**  
Consider a conservative global rate limit (e.g. per IP) in addition to existing route-specific limits, especially for production.

---

## 2. Frontend Vulnerabilities

### 2.1 CRITICAL (verify only): Stored XSS via chat export (PDF/print)

**Location:** `myfrontend/frontend/src/components/settings/SettingsModal.jsx` — `handleExportPDF`

**Details:**  
Export/print flow builds HTML from chat messages. **Current code** uses `document.createElement`, `div.textContent = line`, and `doc.body.appendChild(container)` — i.e. **text content only**, not raw HTML. No `document.write(htmlContent)` or `innerHTML` with unescaped `msg.content` or `msg.senderId` in the audited path.

**Risk:**  
If any code path is added later that uses `innerHTML` or `document.write` with user-controlled message content, that would be stored XSS when the user exports.

**Recommendation:**  
Ensure **all** export/print code paths continue to use `textContent` or a safe HTML escape for message content and senderId. No `innerHTML` or `document.write` with user-controlled data. Prefer a small escape helper for any future HTML insertion. Treat this as a verification finding: current code is safe; keep it that way.

---

### 2.2 MEDIUM: Tokens in sessionStorage (dev token mode)

**Location:** `myfrontend/frontend/src/features/auth/tokenTransport.js`, `myfrontend/frontend/src/http/auth.api.js`

**Details:**  
When `VITE_DEV_TOKEN_MODE=true`, access and refresh tokens are stored in `sessionStorage` and sent via `Authorization: Bearer` and `x-dev-token-mode`.

**Risk:**  
If dev token mode is enabled in a production build by mistake, tokens would be in sessionStorage and readable by any same-origin script (XSS).

**Recommendation:**  
Production builds should fail-fast if `VITE_DEV_TOKEN_MODE=true` when `import.meta.env.PROD === true`. Backend already rejects dev token mode in production.

---

### 2.3 MEDIUM: Sensitive data in localStorage/sessionStorage

**Location:** Multiple files (session switch, UI prefs, resume state, settings, auth events)

**Details:**  
User IDs, conversation IDs, UI preferences, and auth-related events may be stored in localStorage/sessionStorage.

**Risk:**  
Any XSS can read and exfiltrate this data. Main mitigation is preventing XSS and using httpOnly cookies for tokens in production.

**Recommendation:**  
Do not store access/refresh tokens in storage in production. Treat all client storage as readable by same-origin script; minimize sensitive data stored there.

---

### 2.4 LOW: innerHTML in main.jsx (dev-only, static content)

**Location:** `myfrontend/frontend/src/main.jsx`

**Details:**  
When the dev host check fails (e.g. 127.0.0.1 instead of localhost), the app sets `root.innerHTML = ""` and builds a warning div with `div.innerHTML = \`...\``. Content is **static** (no user or server input).

**Risk:**  
Low; dev-only and no user input. Bad pattern to copy elsewhere.

**Recommendation:**  
Prefer `textContent` or React for the warning message to avoid normalizing innerHTML use.

---

### 2.5 LOW: VITE_* env in frontend bundle

**Location:** Use of `import.meta.env.VITE_DEV_TOKEN_MODE`, `VITE_API_BASE_URL`, etc.

**Details:**  
Vite inlines `import.meta.env.*` at build time. Values are visible in the client bundle.

**Risk:**  
No secrets should be in `VITE_*`. Accidentally enabling dev token mode in prod is mitigated by fail-fast on load (if implemented).

**Recommendation:**  
Never put secrets in `VITE_*`. Use strict production build env in CI that does not set dev-only flags.

---

## 3. Positive Security Findings (No Change Required for Listing)

- **JWT verification:** Timing-safe comparison and proper exp/nbf checks.  
- **Password handling:** Bcrypt; not logged; not returned in API.  
- **Auth middleware:** JWT from cookie or (dev) Bearer; role from DB; banned users rejected.  
- **Admin routes:** All `/api/admin/*` use `requireAuth` then `requireAdmin` (or `requireRootAdmin` where required).  
- **Input validation:** Admin/report IDs and conversation IDs validated (length/format) in `backend/utils/adminValidation.js`.  
- **Message content:** Length cap and validation in send handler and WebSocket safety.  
- **Uploads:** Image allowlist (no SVG), size limit 2MB, random filenames; only missing content-based validation.  
- **Origin guard:** CSRF-style protection for state-changing methods; uses same config as CORS (`origins.js`).  
- **Rate limiting:** Auth (login/register/refresh), logout, message send, report, admin actions; WS has per-user and per-message rate limiting.  
- **CSP and headers:** Helmet with CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy.  
- **Metrics:** Protected by `metricsAccessGuard` (secret header in production by default).  
- **Production env:** `env.validate.js` requires in production: NODE_ENV, PORT, JWT_SECRET, DB_URI, REFRESH_PEPPER, COOKIE_DOMAIN, WS_PATH, and at least one of CORS_ORIGIN/CORS_ORIGINS.  
- **Body size limit:** `HTTP_BODY_LIMIT` (default `256kb`) applied to `express.json` and `express.urlencoded` in `http/index.js`.

---

## 4. Remediation Priority

1. **Critical:** Confirm export/print uses only safe insertion (textContent/escape); no new innerHTML/document.write on user content.  
2. **High:** Align CORS/origin docs (single source: CORS_ORIGIN/CORS_ORIGINS); ensure WS token never in URL in production and URL not logged; reduce/redact sensitive logging.  
3. **Medium:** Harden uploads with magic-byte validation; run `npm audit fix`; ensure dev routes and dev flags are never enabled in production; cookie secure doc.  
4. **Low:** Harden metrics/health if extended; root admin defaults; replace main.jsx innerHTML with textContent; cap search query length; consider global rate limit.

---

# PART II — RENDER DEPLOYMENT READINESS

## 1. Summary

| Area | Ready | Gaps |
|------|--------|-----|
| GitHub CI | Partially | No Render deploy job; no frontend build/lint in CI |
| GitHub repo & secrets | Partially | No Render-specific secrets docs; ensure no credentials in history |
| Render backend | Not configured | No render.yaml / Render Blueprint; env and build steps need documentation |
| Render frontend (static) | Not configured | No Render static site or build command documented |
| Env & secrets | Partially | METRICS_SECRET, CORS_ORIGIN/CORS_ORIGINS must be documented for Render |
| Health & WebSocket | Documented | Health and WS path need to match Render’s proxy (e.g. /ws) |

---

## 2. GitHub

### 2.1 CI workflow (`.github/workflows/ci.yml`)

| Item | Status | Notes |
|------|--------|-------|
| Sensitive files check | Done | Fails if `users.json` or `backend/storage/_data/` are tracked. |
| Secret scan (Gitleaks + rg) | Done | Blocks MongoDB URIs with credentials and AWS key patterns. |
| Backend tests | Done | Runs on Node 20 with Mongo service; uses safe placeholders for env. |
| Frontend build | Missing | No job to build `myfrontend/frontend` (e.g. `npm run build`). |
| Frontend lint/tests | Missing | No lint or unit tests for frontend in CI. |
| Deploy to Render | Missing | No job to trigger Render deploy (e.g. via Render API or Git branch push to Render-connected repo). |

**Recommendations:**

- Add a CI job to build the frontend (e.g. `cd myfrontend/frontend && npm ci && npm run build`) so breakages are caught.
- Optionally add frontend lint and tests.
- If Render is used: either connect Render to the repo (auto-deploy on push) or add a deploy step (e.g. Render Deploy API) and document the chosen approach.

### 2.2 Repository and secrets

- `.gitignore`: Covers `**/storage/_data/`, `**/.env`, `**/node_modules/`, etc.
- Pre-commit hooks (e.g. `scripts/pre-commit-secrets.sh`) recommended; not required for CI.
- **Do not commit** `.env` or real `DB_URI`/`JWT_SECRET`; use GitHub secrets for any deploy keys.
- If using Render Git-backed deploy: no GitHub deploy secret needed; if using Render API from CI, document required secrets and permissions.

---

## 3. Render Backend

### 3.1 Configuration

**Current state:** No `render.yaml` (Render Blueprint) was found. Deployment to Render is manual or configured only in the Render dashboard.

| Item | Status | Notes |
|------|--------|-------|
| render.yaml / Blueprint | Missing | No declarative Render config in repo. |
| Build command | To be set in Render | e.g. `cd backend && npm ci` (no build step required for this backend). |
| Start command | To be set in Render | e.g. `cd backend && NODE_ENV=production node server.js` or `npm run start:prod`. |
| Root directory | To be set | Monorepo: set service root to `backend` or repo root with commands that `cd backend`. |
| Node version | Document | Render typically uses Node 20; match `engines` in `backend/package.json` if set. |

**Recommendations:**

- Add a `render.yaml` under the repo root **or** document the exact Build Command and Start Command in `docs/RENDER_DEPLOYMENT.md`.
- Example start: `NODE_ENV=production node server.js` from `backend/` directory.

### 3.2 Environment variables (Render backend)

All production-required env vars must be set in Render’s Environment for the backend service. Do **not** commit values; use Render’s secret/env UI.

| Variable | Required (prod) | Notes |
|----------|------------------|-------|
| NODE_ENV | Yes | Must be `production`. |
| PORT | Yes | Render sets this automatically; do not override unless needed. |
| JWT_SECRET | Yes | Strong random string; **secret**. |
| DB_URI | Yes | MongoDB Atlas connection string; **secret**. |
| REFRESH_PEPPER | Yes | Non-empty in production; **secret**. |
| COOKIE_DOMAIN | Yes | e.g. `.your-app.onrender.com` or your custom domain. |
| CORS_ORIGIN or CORS_ORIGINS | Yes | Frontend origin(s), e.g. `https://your-frontend.onrender.com` or comma-separated list. |
| WS_PATH | Yes | Usually `/ws`; must match Render’s proxy and frontend WS URL. |
| METRICS_SECRET | Yes (if metrics mode = secret) | When `METRICS_MODE=secret` (default in prod), required for `GET /metrics`. |
| METRICS_MODE | Optional | Default in prod is `secret`; do not set `open` unless intended. |
| METRICS_ENABLE_ADMIN_ROUTE | Optional | If `true`, enables `GET /api/metrics` (admin-only). |
| ROOT_ADMIN_EMAIL / ROOT_ADMIN_PASSWORD | Yes (for bootstrap) | Used at startup to create/update root admin; **secret** for password. |

**Do not set in production:**

- `DEV_TOKEN_MODE` — must not be `true` (backend exits at startup).  
- `ENABLE_DEV_ROUTES` — should not be `true`.  
- `ALLOW_LOCAL_DB` — not for production.

### 3.3 Health checks and WebSocket

| Item | Status | Notes |
|------|--------|-------|
| Health endpoint | Exists | `GET /health` and `GET /api/health` return `{ ok: true }`. Use one as Render “Health Check Path”. |
| WebSocket | Supported | Backend uses `WS_PATH` (e.g. `/ws`). Render supports WebSockets; use “Web Service”; frontend must connect to same host and path (e.g. `wss://<backend>.onrender.com/ws`). |
| Sticky sessions | Optional | Document if multiple instances are used and whether sticky sessions are required (Render supports them). |

**Recommendations:**

- In Render dashboard: set Health Check Path to `/health` or `/api/health`.
- Document: “Frontend must set VITE_WS_URL (or equivalent) to `wss://<backend-host>/ws`.”

### 3.4 Persistent storage (uploads)

| Item | Status | Notes |
|------|--------|-------|
| Uploads directory | Ephemeral by default | `backend/storage/_data/uploads` is on the server filesystem. On Render, the filesystem is **ephemeral**; uploads are lost on deploy or restart. |
| Persistent disk | Optional on Render | Render offers Persistent Disks; if uploads must persist, mount a disk and point the app to that path, or use object storage (e.g. S3) and change the app to store files there. |

**Recommendations:**

- Document: “On Render, uploads are not persistent unless a Persistent Disk or external storage (e.g. S3) is used.”
- If using a disk: document the mount path and any env var the app uses for it.

---

## 4. Render Frontend (Static Site)

| Item | Status | Notes |
|------|--------|-------|
| Static site | Not configured | Vite SPA can be deployed as a Render “Static Site”: build command e.g. `cd myfrontend/frontend && npm ci && npm run build`, publish directory `myfrontend/frontend/dist`. |
| Env at build time | Important | `VITE_API_BASE_URL`, `VITE_WS_URL` (or similar) must be set at **build time** so the built JS points to the backend (e.g. `https://<backend>.onrender.com` and `wss://<backend>.onrender.com/ws`). |
| Same service as backend | Possible | Serving the SPA from the Node backend is possible but not the default; document if chosen. |

**Recommendations:**

- Add a `render.yaml` section or doc for a Static Site service: build command, publish directory, and required env vars.
- Ensure production build never sets `VITE_DEV_TOKEN_MODE=true`.

---

## 5. Cross-cutting deployment checklist

| # | Item | GitHub | Render |
|---|------|--------|--------|
| 1 | No credentials in repo or history | CI + pre-commit | Use only env in Render dashboard |
| 2 | `users.json` and `storage/_data` not tracked | .gitignore + CI | Not shipped in build |
| 3 | `/metrics` protected in production | N/A | Set METRICS_SECRET; do not set METRICS_MODE=open |
| 4 | REFRESH_PEPPER required in prod | env.validate.js | Set in Render env |
| 5 | All /api/admin/* require auth + admin | Code | N/A |
| 6 | Dev routes/flags disabled in prod | Docs/CI | Do not set ENABLE_DEV_ROUTES, DEV_TOKEN_MODE |
| 7 | Upload hardening (no SVG, size, random name) | Code | N/A |
| 8 | Rate limiting (login, refresh, uploads, WS) | Code | N/A |
| 9 | Health check path | N/A | Set to /health or /api/health |
| 10 | WebSocket path and URL | Docs | WS_PATH=/ws; frontend wss URL correct |
| 11 | CORS and origin guard | Docs | CORS_ORIGIN or CORS_ORIGINS set to frontend origin(s) |

---

## 6. Recommended next steps (Render)

1. **Document Render explicitly:** Add `docs/RENDER_DEPLOYMENT.md` with service type, build/start commands, root directory, health path, and link to env list.  
2. **Add render.yaml (optional):** Define backend (and optionally frontend static site) in `render.yaml` so the repo is self-describing for Render.  
3. **Document env for Render:** In `docs/RENDER_ENV.md` or similar, list every variable with required/optional and “do not set in prod”.  
4. **CI:** Add frontend build (and optionally lint/tests); add deploy step or document “Render auto-deploy from branch X”.  
5. **Secrets:** Confirm no production secrets in repo or history; rotate any that might have been committed.  
6. **CORS/origin:** Document that only `CORS_ORIGIN` or `CORS_ORIGINS` control both CORS and origin guard for Render.

---

*End of Security Vulnerabilities & Render Deployment Readiness Audit.*
