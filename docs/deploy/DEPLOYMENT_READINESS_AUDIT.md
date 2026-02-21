# Deployment Readiness Audit: GitHub + Render

**Project:** Integrated frontend + chat backend  
**Targets:** GitHub (CI, repo, secrets), Render (backend + optional frontend)  
**Date:** February 2026  
**Purpose:** List all items that affect deployment readiness for GitHub and Render.

---

## Summary

| Area | Ready | Gaps |
|------|--------|-----|
| GitHub CI | Partially | No Render deploy job; no frontend build/lint in CI |
| GitHub repo & secrets | Partially | No Render-specific secrets docs; ensure no credentials in history |
| Render backend | Not configured | No render.yaml / Render Blueprint; env and build steps need documentation |
| Render frontend (static) | Not configured | No Render static site or build command documented |
| Env & secrets | Partially | REFRESH_PEPPER, METRICS_SECRET, and CORS_ORIGIN/CORS_ORIGINS (single source) documented for Render |
| Health & WebSocket | Documented | Health and WS path need to match Render’s proxy (e.g. /ws) |

---

## 1. GitHub

### 1.1 CI workflow (`.github/workflows/ci.yml`)

| Item | Status | Notes |
|------|--------|-------|
| Sensitive files check | Done | Fails if `users.json` or `backend/storage/_data/` are tracked. |
| Secret scan (Gitleaks + rg) | Done | Blocks MongoDB URIs with credentials and AWS key patterns. |
| Backend tests | Done | Runs on Node 20 with Mongo service; uses `DB_URI`, `JWT_SECRET`, etc. from workflow env (safe placeholders). |
| Frontend build | Missing | No job to build `myfrontend/frontend` (e.g. `npm run build`). |
| Frontend lint/tests | Missing | No lint or unit tests for frontend in CI. |
| Deploy to Render | Missing | No job to trigger Render deploy (e.g. via Render API or Git branch push to Render-connected repo). |
| Artifact upload | N/A | If added, must exclude `backend/storage/_data/**` (comment already in workflow). |

**Recommendations:**

- Add a CI job to build the frontend (e.g. `cd myfrontend/frontend && npm ci && npm run build`) so breakages are caught.
- Optionally add frontend lint (e.g. `npm run lint`) and tests.
- If Render is used: either connect Render to the repo (auto-deploy on push) or add a deploy step (e.g. Render Deploy API) and document the chosen approach.

---

### 1.2 Repository and secrets

| Item | Status | Notes |
|------|--------|-------|
| .gitignore | Done | `**/storage/_data/`, `**/storage/uploads/`, `**/.env`, `**/.env.*`, `**/node_modules/`. |
| backend/.gitignore | Done | `storage/_data/`, `storage/_data/**`, `storage/_data/users.json`, `storage/_data/uploads/`, etc. |
| Pre-commit hooks | Optional | `scripts/install-git-hooks.sh` and `scripts/pre-commit-secrets.sh` block MongoDB URIs and sensitive paths; not required for CI but recommended. |
| No credentials in repo | Verified by CI | Gitleaks and rg checks; ensure no real `DB_URI`, `JWT_SECRET`, or AWS keys in history. |
| GitHub secrets for Render | Not documented | If CI deploys to Render, document which GitHub secrets (e.g. RENDER_DEPLOY_KEY, RENDER_SERVICE_ID) to create and how they are used. |

**Recommendations:**

- Document in README or `docs/DEPLOYMENT.md`: “Do not commit .env or real DB_URI/JWT_SECRET; use GitHub secrets for any deploy keys.”
- If using Render Git-backed deploy: no GitHub deploy secret needed; if using Render API from CI, document the required secrets and permissions.

---

### 1.3 Branch and release strategy

| Item | Status | Notes |
|------|--------|-------|
| Default branch | Assumed main | Confirm which branch Render (or other deploy) uses. |
| Tags/releases | Not audited | Optional: document if releases are tagged and whether Render deploys from tags. |

---

## 2. Render

### 2.1 Render configuration (backend)

**Current state:** No `render.yaml` (or equivalent Render Blueprint) was found in the repo. Deployment to Render is therefore manual or configured only in the Render dashboard.

| Item | Status | Notes |
|------|--------|-------|
| render.yaml / Blueprint | Missing | No declarative Render config in repo. |
| Build command | To be set in Render | Should be: `cd backend && npm ci && npm run build` (if a build script exists) or `cd backend && npm ci`. |
| Start command | To be set in Render | e.g. `cd backend && node server.js` or `npm run start:prod` with `NODE_ENV=production`. |
| Root directory | To be set | If repo is monorepo, set root to repo root and use `backend` as service root, or set root to `backend`. |
| Node version | Document | Render typically uses Node 20; match `engines` in backend/package.json if set. |

**Recommendations:**

- Add a `render.yaml` (or Render Blueprint) under the repo root or document the exact “Build Command” and “Start Command” in `docs/RENDER_DEPLOYMENT.md`.
- Example start: `NODE_ENV=production node server.js` (from `backend/` directory).

---

### 2.2 Environment variables (Render backend)

All production-required env vars must be set in Render’s “Environment” for the backend service. Do **not** commit values; use Render’s secret/env UI.

| Variable | Required (prod) | Notes |
|----------|------------------|-------|
| NODE_ENV | Yes | Must be `production`. |
| PORT | Yes | Render sets this automatically; do not override unless needed. |
| JWT_SECRET | Yes | Strong random string; secret. |
| DB_URI | Yes | MongoDB Atlas connection string; secret. |
| COOKIE_DOMAIN | Yes | e.g. `.your-app.onrender.com` or your custom domain. |
| CORS_ORIGIN or CORS_ORIGINS | Yes | Use **CORS_ORIGIN** (single) or **CORS_ORIGINS** (comma-separated). Used for **both** CORS and OriginGuard. No path/query/hash; trailing slash tolerated but not recommended. Example: `https://<frontend>.onrender.com` or comma-separated. Do **not** set ALLOWED_ORIGINS (ignored). |
| WS_PATH | Yes | Usually `/ws`; must match Render’s proxy and frontend WS URL. |
| REFRESH_PEPPER | Yes | Non-empty in production; secret. |
| METRICS_SECRET | Yes (if metrics mode = secret) | When `METRICS_MODE=secret` (default in prod), required for `GET /metrics`. |
| METRICS_MODE | Optional | Default in prod is `secret`; do not set `open` unless intended. |
| METRICS_ENABLE_ADMIN_ROUTE | Optional | If `true`, enables `GET /api/metrics` (admin-only). |

**Render examples (CORS):** `CORS_ORIGIN=https://<frontend>.onrender.com` or `CORS_ORIGINS=https://<frontend>.onrender.com,https://<custom-domain>`. Rule: no path, no query, no hash; trailing slash tolerated but not recommended.

**Verification (after deploy):** POST with frontend Origin; expect not 403 and CORS headers:

```bash
curl -s -o /dev/null -w "%{http_code}" -X POST "https://<backend>.onrender.com/api/login" \
  -H "Origin: https://<frontend>.onrender.com" -H "Content-Type: application/json" -d '{}'
# Expect 200 or 401 (not 403). See docs/config/ENV_TEMPLATE.md for full checklist.
```

**Observed bug (fixed):** Trailing slash in config (e.g. `https://app.onrender.com/`) while the browser sends `https://app.onrender.com` used to cause 403 CSRF_BLOCKED. Origins are now canonicalized with `URL.origin` (see `docs/ORIGIN_403_PROOF.md`).

**Do not set in production:**

- `DEV_TOKEN_MODE` — must not be `true` (backend exits at startup).  
- `ENABLE_DEV_ROUTES` — should not be `true` (or omit).  
- `ALLOW_LOCAL_DB` — not for production.  
- `ALLOWED_ORIGINS` — ignored; use CORS_ORIGIN or CORS_ORIGINS only.  
- `VITE_*` — frontend only; backend ignores.

**Recommendations:**

- Create `docs/RENDER_ENV.md` or a section in `docs/config/ENV_TEMPLATE.md` listing every Render env var with “Required in prod”, “Secret”, and “Do not set in prod”.
- Emphasize: REFRESH_PEPPER, METRICS_SECRET, and CORS_ORIGIN/CORS_ORIGINS (single source for CORS + OriginGuard) must be set correctly or the app will fail or be insecure.

---

### 2.3 Render: health checks and WebSocket

| Item | Status | Notes |
|------|--------|-------|
| Health endpoint | Exists | `GET /health` and `GET /api/health` return `{ ok: true }`. Render can use one of these for “Health Check Path”. |
| WebSocket | Supported | Backend uses `WS_PATH` (e.g. `/ws`). Render supports WebSockets; ensure the service is “Web Service” and that the frontend connects to the same host and path (e.g. `wss://<backend>.onrender.com/ws`). |
| Sticky sessions | Optional | If the app assumes one WS per backend instance, document whether multiple instances are used and if sticky sessions are required (Render supports sticky sessions). |

**Recommendations:**

- In Render dashboard: set Health Check Path to `/health` or `/api/health`.
- Document in deployment docs: “Frontend must set VITE_WS_URL (or equivalent) to `wss://<backend-host>/ws`.”

---

### 2.4 Render: persistent storage (uploads)

| Item | Status | Notes |
|------|--------|-------|
| Uploads directory | Ephemeral by default | `backend/storage/_data/uploads` is on the server filesystem. On Render, the filesystem is ephemeral; uploads are lost on deploy or restart. |
| Persistent disk | Optional on Render | Render offers “Persistent Disks”; if uploads must persist, mount a disk and set `UPLOADS_DIR` (or equivalent) to that path, or use object storage (e.g. S3) and change the app to store files there. |

**Recommendations:**

- Document: “On Render, uploads are not persistent unless a Persistent Disk or external storage (e.g. S3) is used.”
- If using a disk: document the mount path and any env var the app uses for it.

---

### 2.5 Render: frontend (static site or separate service)

| Item | Status | Notes |
|------|--------|-------|
| Static site | Not configured | If the frontend is a Vite SPA, it can be deployed as a Render “Static Site”: build command e.g. `cd myfrontend/frontend && npm ci && npm run build`, publish directory `myfrontend/frontend/dist`. |
| Env at build time | Important | `VITE_API_BASE_URL`, `VITE_WS_URL` (or similar) must be set at build time so the built JS points to the backend URL (e.g. `https://<backend>.onrender.com` and `wss://<backend>.onrender.com/ws`). |
| Same service as backend | Not recommended | Serving the SPA from the Node backend is possible but not the default in this repo; document if chosen. |

**Recommendations:**

- Add a `render.yaml` section or doc for a “Static Site” service: build command, publish directory, and required env vars (e.g. `VITE_API_BASE_URL`, `VITE_WS_URL`).
- Ensure production build never sets `VITE_DEV_TOKEN_MODE=true`.

---

## 3. Cross-cutting deployment checklist

| # | Item | GitHub | Render |
|---|------|--------|--------|
| 1 | No credentials in repo or history | CI + pre-commit | Use only env in Render dashboard |
| 2 | `users.json` and `storage/_data` not tracked | .gitignore + CI | Not shipped in build (no such files in repo) |
| 3 | `/metrics` protected in production | N/A | Set METRICS_SECRET; do not set METRICS_MODE=open |
| 4 | JSON body size limit | Code change in backend | N/A |
| 5 | REFRESH_PEPPER required in prod | Code/docs | Set in Render env |
| 6 | All /api/admin/* require auth + admin | Code | N/A |
| 7 | Dev routes/flags disabled in prod | Docs/CI | Do not set ENABLE_DEV_ROUTES, DEV_TOKEN_MODE |
| 8 | Upload hardening (no SVG, size, random name) | Code | N/A |
| 9 | Rate limiting (login, refresh, uploads, WS) | Code | N/A |
| 10 | Health check path | N/A | Set to /health or /api/health |
| 11 | WebSocket path and URL | Docs | WS_PATH=/ws; frontend wss URL correct |
| 12 | CORS and origin guard | Docs | CORS_ORIGIN or CORS_ORIGINS set (single source for CORS + OriginGuard); no ALLOWED_ORIGINS |

---

## 4. Recommended next steps

1. **Document Render explicitly:** Add `docs/RENDER_DEPLOYMENT.md` (or extend existing deployment doc) with: service type, build/start commands, root directory, health path, and link to env list.  
2. **Add render.yaml (optional):** Define backend (and optionally frontend static site) in `render.yaml` so the repo is self-describing for Render.  
3. **Document env for Render:** In `docs/RENDER_ENV.md` or `docs/config/ENV_TEMPLATE.md`, list every variable for Render with required/optional and “do not set in prod”.  
4. **CI:** Add frontend build (and optionally lint/tests); add deploy step or document “Render auto-deploy from branch X”.  
5. **Secrets:** Confirm no production secrets in repo or history; rotate any that might have been committed.  
6. **CORS/origin:** Document that only CORS_ORIGIN or CORS_ORIGINS control both CORS and OriginGuard for Render; do not set ALLOWED_ORIGINS (ignored). See `docs/config/ENV_TEMPLATE.md` for Render examples, verification curl, and trailing-slash canonicalization fix.

---

*End of deployment readiness audit for GitHub + Render.*
