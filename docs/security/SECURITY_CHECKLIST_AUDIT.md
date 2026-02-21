# Security Checklist Audit (14 Items)

**Project:** Integrated frontend + chat backend  
**Date:** February 2026  
**Purpose:** Audit the project against the 14 specified security and deployment items; record status and any gaps.

---

## Overview

| # | Item | Status | Notes |
|---|------|--------|-------|
| 1 | Remove hardcoded DB credentials; rotate DB password | Done / Action | No hardcoded creds in repo; rotate if ever leaked |
| 2 | Remove storage/_data/users.json and uploads from repo; .gitignore | Done | Already gitignored; CI blocks tracking |
| 3 | Protect /metrics (auth, secret header, or internal-only) | Done | metricsAccessGuard (secret header in prod) |
| 4 | Add JSON body size limit to Express | Not done | express.json() has no limit |
| 5 | Add REFRESH_PEPPER to production env validation | Partial | constants.js throws; not in env.validate required list |
| 6 | All /api/admin/* requireAuth + requireAdmin, no bypass | Done | router.use(requireAuth); requireAdmin on each route |
| 7 | Fully disable dev routes/flags in production | Done | Env guards; document Render must not set them |
| 8 | Upload hardening (no SVG, allowlist, size, random name) | Done | No SVG; allowlist; 2MB; random filename. No magic bytes |
| 9 | Rate limiting: login, refresh, uploads, WS connect | Partial | Login/refresh limited; uploads not; WS has in-app rate limit |
| 10 | Validate image magic bytes (content-based) | Not done | MIME only |
| 11 | npm audit fix and resolve backend advisories | Action | One low (qs); fix available |
| 12 | Security headers / CSP tightening | Done | Helmet, CSP, X-Frame-Options, etc. |
| 13 | Remove or isolate legacy AWS/Nginx configs | Done | Moved to infra/legacy/ and docs/legacy/aws/ |
| 14 | Avoid logging sensitive identifiers | Partial | Some userId/sessionId in logs; export controller console.log |

---

## 1. Remove hardcoded DB credentials from repo and rotate the database password

**Status: Done (no hardcoded creds) / Action if ever leaked**

**Findings:**

- **Repo:** No hardcoded MongoDB connection strings with real credentials in the audited codebase. Scripts and docs use placeholders (e.g. `mongodb+srv://<USER>:<PASSWORD>@<HOST>/<DB>`) or `DB_URI` from env.
- **CI:** `.github/workflows/ci.yml` runs Gitleaks and ripgrep to block commits containing `mongodb+srv://...` with credentials and AWS keys.
- **Pre-commit:** `scripts/pre-commit-secrets.sh` blocks MongoDB URIs with real-looking credentials; `scripts/install-git-hooks.sh` installs the hook.

**Gaps:**

- If credentials were ever committed in the past, they may still exist in Git history. Use `docs/runbooks/SECRETS_HISTORY_PURGE.md` and rotate the MongoDB password after purging.

**Recommendation:**

- Keep using only `DB_URI` from environment. If history was ever exposed, rotate the database password (see `docs/runbooks/MONGO_ROTATION_RUNBOOK.md`).

---

## 2. Remove storage/_data/users.json (and uploads) from repo and add to .gitignore

**Status: Done**

**Findings:**

- **.gitignore (root):** `**/storage/_data/`, `**/storage/uploads/`.
- **backend/.gitignore:** `storage/_data/`, `storage/_data/**`, `storage/_data/users.json`, `storage/_data/users.json.bak`, `storage/_data/uploads/`, `storage/_data/*.json`, `storage/uploads/`.
- **CI:** `.github/workflows/ci.yml` job “sensitive-files” fails if `users.json` (or `.bak`) or any file under `backend/storage/_data/` is tracked, or if `backend/storage/_data/` exists in the workspace.
- **.dockerignore:** Excludes `backend/storage/_data` and `backend/storage/_data/**`.

**Gaps:**

- None. Ensure no one force-adds or commits these paths.

**Recommendation:**

- No change required. Rely on CI and pre-commit to keep these out of the repo.

---

## 3. Protect /metrics (require auth, secret header, or internal-only)

**Status: Done**

**Findings:**

- **Guard:** `backend/http/middleware/metricsAccess.middleware.js` implements `metricsAccessGuard`.
- **Modes:** `open` (allow), `disabled` (404), `secret` (requires header `x-metrics-key` with constant-time compare), `admin` (root `/metrics` returns 403; use `GET /api/metrics` with admin auth when `METRICS_ENABLE_ADMIN_ROUTE=true`).
- **Default in production:** `METRICS_MODE` defaults to `secret`; `METRICS_SECRET` is required (env.validate.js exits if missing when mode is secret).
- **Mount:** `backend/app.js`: `app.get('/metrics', metricsAccessGuard, handleMetrics)`.

**Gaps:**

- None for this item.

**Recommendation:**

- In production, leave `METRICS_MODE=secret` (default) and set `METRICS_SECRET` in Render/env. Optionally set `METRICS_ENABLE_ADMIN_ROUTE=true` for browser access via `/api/metrics` (admin-only).

---

## 4. Add JSON body size limit to Express (express.json({ limit: ... }))

**Status: Not done**

**Findings:**

- **Current:** `backend/http/index.js` (lines 68–69):  
  `httpRouter.use(express.json());`  
  `httpRouter.use(express.urlencoded({ extended: false }));`  
  No `limit` option on either.

**Gaps:**

- Large JSON or form bodies can cause high memory use and DoS.

**Recommendation:**

- Add a limit, e.g.:  
  `express.json({ limit: '256kb' })`  
  `express.urlencoded({ extended: false, limit: '256kb' })`  
  Tune per API needs; consider stricter limits for auth routes if desired.

---

## 5. Add REFRESH_PEPPER to production env validation (fail fast if missing)

**Status: Partial**

**Findings:**

- **constants.js:** When `NODE_ENV === 'production'` and `REFRESH_PEPPER` is empty, `constants.js` throws at load time (“REFRESH_PEPPER is required in prod and non-empty”). So production does fail fast if the constant is used.
- **env.validate.js:** The production required list (line 51) is: `NODE_ENV`, `PORT`, `JWT_SECRET`, `DB_URI`, `COOKIE_DOMAIN`, `WS_PATH`. `REFRESH_PEPPER` is **not** in this list. Validation runs before the app starts; constants are loaded when required, so failure could occur later in startup.

**Gaps:**

- Env validation can pass without `REFRESH_PEPPER`; fail-fast is only when the config module is first required. For consistent “fail at startup if any prod secret is missing”, REFRESH_PEPPER should be in the explicit production required list.

**Recommendation:**

- Add `REFRESH_PEPPER` to the production required array in `backend/config/env.validate.js` (in the same block that checks `NODE_ENV`, `PORT`, `JWT_SECRET`, etc.) and document it in `.env.example` and deployment docs.

---

## 6. Ensure all /api/admin/* routes are strictly requireAuth + requireAdmin (no bypass)

**Status: Done**

**Findings:**

- **Mount:** `backend/http/routes/admin.routes.js` is mounted under `/api` as `/admin` (so all routes are `/api/admin/*`).
- **Middleware order:** `router.use(requireAuth)` first (line 19); then each route adds `requireAdmin` (or `requireRootAdmin` for role change). No route is reachable without auth; no “admin by query param” or bypass.
- **Verification:** All GET/POST routes in admin.routes.js use either `requireAdmin` or `requireRootAdmin`; no route omits role check.

**Gaps:**

- None.

**Recommendation:**

- No change required. Keep any new admin routes behind `requireAuth` and `requireAdmin` (or `requireRootAdmin`).

---

## 7. Fully disable all dev routes / dev flags in production (Render env must not enable them)

**Status: Done (code) / Document for Render**

**Findings:**

- **DEV_TOKEN_MODE:** If `NODE_ENV=production` and `DEV_TOKEN_MODE=true`, `backend/config/env.validate.js` calls `process.exit(1)` at startup.
- **Dev routes:** `/api/dev/debug/auth` and `/api/dev/chats/list` are only mounted when `ENABLE_DEV_ROUTES === 'true'` **and** `devController.getDevRoutesKey()` is truthy (i.e. `DEV_ROUTES_KEY` or `DEV_SESSION_KEY` set). They also require `x-dev-key` header; wrong key → 404.
- **Production:** As long as `NODE_ENV=production` and Render does not set `ENABLE_DEV_ROUTES`, `DEV_TOKEN_MODE`, or dev keys, dev routes and dev token mode are disabled.

**Gaps:**

- Render (and any other host) must be explicitly told not to set these. No central “production checklist” in repo that names Render.

**Recommendation:**

- In deployment docs (e.g. `docs/deploy/RENDER.md` or `docs/deploy/DEPLOYMENT_READINESS_AUDIT.md`), list: “Do not set in production: ENABLE_DEV_ROUTES, DEV_TOKEN_MODE, DEV_ROUTES_KEY, DEV_SESSION_KEY, VITE_DEV_TOKEN_MODE (frontend).”

---

## 8. Apply basic upload hardening (no SVG, strict image allowlist, size limit, random filename)

**Status: Done (except content-based validation)**

**Findings:**

- **No SVG:** `backend/http/controllers/uploads.controller.js` uses `ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']`. SVG is not allowed.
- **Strict allowlist:** Only the above four MIME types are accepted.
- **Size limit:** 2MB (`MAX_SIZE_BYTES = 2 * 1024 * 1024`) in both uploads.controller.js and uploads.routes.js (multer `limits.fileSize`).
- **Random filename:** `randomFilename(ext)` generates a random name; extension is derived from validated MIME (jpg/png/gif/webp). No user-controlled filename.

**Gaps:**

- Validation is MIME-only; no magic-byte (content-based) check. Covered in item 10.

**Recommendation:**

- Keep current allowlist and size; add magic-byte validation (item 10).

---

## 9. Add rate limiting to login / refresh / uploads / WS connect

**Status: Partial**

**Findings:**

- **Login / register / refresh:** `backend/http/routes/auth.routes.js` uses `authLimiter` on `POST /register`, `POST /login`, and `POST /auth/refresh`. Limits are configurable (e.g. RATE_LIMIT_AUTH_MAX, RATE_LIMIT_AUTH_WINDOW_MS).
- **Uploads:** `backend/http/routes/uploads.routes.js` has no rate limiter; only `requireAuth` and multer.
- **WS connect:** There is no HTTP-level rate limit on the WebSocket upgrade request. The WebSocket layer has per-user and per-message rate limiting (e.g. `socketSafety.js`, `rateLimitStore`) after connection; connection attempts themselves are not rate-limited at the server entry point.

**Gaps:**

- Uploads: no rate limit (abuse by authenticated user possible).
- WS connect: no rate limit on upgrade (many connections from one IP possible).

**Recommendation:**

- Add an upload rate limiter (e.g. per-user or per-IP) on `POST /api/uploads/image`.
- Consider a global or per-IP rate limit on the WebSocket upgrade path (e.g. in front of the WS server or in the HTTP server that handles the upgrade) to limit connection storms.

---

## 10. Validate image magic bytes (content-based validation, not only MIME)

**Status: Not done**

**Findings:**

- **Current:** `backend/http/controllers/uploads.controller.js` checks only `file.mimetype` against `ALLOWED_MIMES`. No read of file content to verify magic bytes.

**Gaps:**

- A client can send a non-image file (e.g. HTML, SVG, script) with a spoofed `Content-Type: image/png` and have it stored and served.

**Recommendation:**

- After multer, read the first few bytes of the uploaded file and validate against known image magic numbers (JPEG, PNG, GIF, WebP). Reject if content does not match the declared MIME. Keep MIME allowlist as a first check; magic bytes as the authority.

---

## 11. Run npm audit fix and resolve backend dependency advisories

**Status: Action required**

**Findings:**

- **npm audit (backend):** One vulnerability reported: transitive `qs` in range 6.7.0–6.14.1 — “arrayLimit bypass in comma parsing allows denial of service” (low severity). `fixAvailable: true`.

**Gaps:**

- Advisory not yet resolved.

**Recommendation:**

- Run `npm audit fix` (or `npm update qs` / upgrade parent) in `backend/`, then re-run `npm audit` and full test suite. Resolve any remaining advisories before production.

---

## 12. Add proper security headers / CSP tightening

**Status: Done**

**Findings:**

- **backend/app.js:** Helmet is used with:  
  - `contentSecurityPolicy` (default-src 'self'; connect-src includes self, ws, wss, and allowed origins).  
  - `xFrameOptions: { action: 'deny' }`.  
  - `xContentTypeOptions: true`.  
  - `referrerPolicy: { policy: 'strict-origin-when-cross-origin' }`.  
- **CORS:** Set via `corsMiddleware` from `backend/http/middleware/cors.middleware.js` using allowed origins.

**Gaps:**

- None for this item. CSP could be tightened further (e.g. script-src, form-action) if the app adds more dynamic content; current setup is reasonable for the stack.

**Recommendation:**

- No change required for the checklist. Optional: document CSP and CORS in a security section of the README or docs.

---

## 13. Remove or isolate legacy AWS/Nginx configs (cleanup for professionalism)

**Status: Pending**

**Findings:**

- **Present in repo:**  
  - `infra/legacy/nginx/` (e.g. `chat-backend.conf`), `infra/legacy/nginx/README.md`.  
  - `docs/legacy/aws/AWS_DEPLOYMENT.md`, `docs/legacy/aws/AWS_DEPLOYMENT_NOTES.md`, and other AWS/EC2-related docs.  
  - `infra/legacy/systemd/` (e.g. `chat-backend.service`).  
- These are useful for self-hosted or EC2 deployments but can be confusing if the primary deploy target is Render.

**Gaps:**

- No clear “this is for legacy/self-hosted only” or “Render uses its own proxy” so contributors might think Nginx/AWS are required for Render.

**Recommendation:**

- Either: (a) Move legacy configs to a subfolder (e.g. `backend/infra/legacy/` or `docs/deployment/self-hosted/`) and add a short README that they are for non-Render deployments; or (b) Remove them if the team only uses Render. Prefer isolate over delete if anyone still uses EC2/Nginx.

---

## 14. Avoid logging sensitive identifiers (sessions, tokens, user IDs)

**Status: Partial**

**Findings:**

- **WebSocket:** `backend/websocket/connection/wsServer.js` logs events that can include `userId`, `sessionId`, connection IDs (e.g. in `recordWsAuthRejected`, `logger.warn`, `logger.error`, `logger.info`, `logger.debug`). Some are necessary for debugging but can be sensitive in production.
- **HTTP:** `backend/http/controllers/export.controller.js` has `console.log('[export] ...', { chatId, userId })`. Other controllers may log request params or user identifiers.
- **Auth:** No logging of raw tokens or passwords observed; env.validate and constants do not log secret values.

**Gaps:**

- userId, sessionId, and similar identifiers in logs can support session hijacking or profiling; may also conflict with privacy/compliance. Export controller logs chatId/userId on every export.

**Recommendation:**

- In production: avoid or redact session IDs and user IDs in logs; use structured logging with a level and redaction for PII. Remove or gate debug logs that include `userId`/`chatId`/`sessionId` so they do not run in production. Consider a logging policy doc (e.g. “do not log tokens, full session IDs, or user IDs in production”).

---

## Summary table (for tracking)

| # | Item | Status | Action |
|---|------|--------|--------|
| 1 | Hardcoded DB credentials; rotate password | Done / Action if leaked | Keep env-only; rotate if history exposed |
| 2 | users.json and uploads out of repo; .gitignore | Done | None |
| 3 | Protect /metrics | Done | None |
| 4 | JSON body size limit | Not done | Add limit to express.json and urlencoded |
| 5 | REFRESH_PEPPER in prod env validation | Partial | Add to required list in env.validate.js |
| 6 | Admin routes requireAuth + requireAdmin | Done | None |
| 7 | Disable dev routes/flags in prod | Done | Document for Render |
| 8 | Upload hardening (no SVG, allowlist, size, random name) | Done | None (magic bytes in #10) |
| 9 | Rate limit login/refresh/uploads/WS connect | Partial | Add upload limiter; consider WS upgrade limiter |
| 10 | Image magic bytes validation | Not done | Implement content-based check |
| 11 | npm audit fix; resolve advisories | Action | Run npm audit fix in backend |
| 12 | Security headers / CSP | Done | None |
| 13 | Remove or isolate AWS/Nginx configs | Pending | Move to legacy folder or document |
| 14 | Avoid logging sensitive identifiers | Partial | Redact/remove userId, sessionId, chatId in prod |

---

*End of security checklist audit.*
