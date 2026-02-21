# Security Vulnerability Analysis & Deployment Readiness Report

**Project:** Integrated frontend + chat backend (Node/Express + React/Vite)  
**Report date:** February 21, 2026  
**Scope:** Backend (`backend/`), frontend (`myfrontend/frontend/`), config, and docs.

---

## Executive summary

The application has a **solid security baseline** (JWT auth, CORS, origin guard, rate limiting, Helmet, env validation, session/refresh flow). Several **vulnerabilities and gaps** must be addressed before production deployment, including **critical**: exposed credentials in repo and unauthenticated `/metrics`. **Verdict: not ready for production** until critical and high items are fixed and deployment checklist is completed.

---

## 1. Vulnerability list (by severity)

### Critical

| # | Vulnerability | Location | Description |
|---|---------------|----------|-------------|
| 1 | **Hardcoded / committed credentials** (remediated) | `backend/verify-realtime-delivery.md`, `backend/scripts/verify-delivery-fix.sh` | Previously: MongoDB connection string with username/password in plain text. **Fixed:** redacted to placeholders; scripts use `DB_URI` from env. See `docs/runbooks/SECRETS_POLICY.md`. |
| 2 | **Sensitive data in repo** | `backend/storage/_data/users.json` | File contains bcrypt password hashes and user records. If this path is tracked or deployed, it exposes credential material. `storage/_data` is not in `.gitignore`. |
| 3 | **Unauthenticated metrics endpoint** | `backend/app.js` | `GET /metrics` returns counters and timestamp to anyone without authentication. In production this can leak operational and usage data and help attackers profile the system. |

### High

| # | Vulnerability | Location | Description |
|---|---------------|----------|-------------|
| 4 | **Missing request body size limit** | `backend/http/index.js` | `express.json()` is used without a `limit` option. Very large JSON bodies can cause high memory usage and DoS. |
| 5 | **Production env contract incomplete** | `backend/config/env.validate.js` vs `backend/config/constants.js` | `REFRESH_PEPPER` is required in production (constants.js throws if empty) but is not listed in the production required list in `env.validate.js`. Risk: deploy with CORS/JWT/DB set but forget REFRESH_PEPPER and get runtime failure on first login/refresh. |
| 6 | **Image upload validation** | `backend/http/controllers/uploads.controller.js` | Allowed types are enforced only by declared `mimetype`. MIME type can be spoofed; no magic-byte (content) validation. A malicious file could be stored as an “image” if the client sends a fake Content-Type. |

### Medium

| # | Vulnerability | Location | Description |
|---|---------------|----------|-------------|
| 7 | **Dependency vulnerability (qs)** | Backend (transitive) | `npm audit` reports: `qs` 6.7.0–6.14.1 — “arrayLimit bypass in comma parsing allows denial of service” (low CVSS but DoS). Fix: run `npm audit fix` in `backend/`. |
| 8 | **Dev-only code paths** | Backend | `DEV_TOKEN_MODE`, `ENABLE_DEV_ROUTES`, `ALLOW_BYPASS_AUTH`, `DEV_SEED_ADMIN` are guarded by env and some by production checks. If any dev env is accidentally set in prod (e.g. `ENABLE_DEV_ROUTES=true` with a weak `DEV_ROUTES_KEY`), attack surface increases. Ensure all dev flags are unset in production. |
| 9 | **Frontend innerHTML usage** | `myfrontend/frontend/src/main.jsx` | `root.innerHTML = ""` and `div.innerHTML = ...` are used for the “wrong host in dev” message. Content is static (no user input). Risk is low; prefer `textContent` or React for consistency and future-proofing. |

### Low / informational

| # | Item | Location | Description |
|---|------|----------|-------------|
| 10 | **Cookie domain in .env.example** | `backend/.env.example` | `ROOT_ADMIN_EMAIL` is set to a specific address. Reminder: production should use a dedicated admin email and never commit real credentials. |
| 11 | **CI secrets** | `.github/workflows/ci.yml` | `JWT_SECRET` and DB URI are set in workflow env for tests. Ensure no production secrets are used; current values look like placeholders. |

---

## 2. Deep analysis of selected vulnerabilities

### 2.1 Exposed credentials (Critical)

- **Where (remediated):**  
  - `backend/verify-realtime-delivery.md` and `backend/scripts/verify-delivery-fix.sh` previously contained a hardcoded MongoDB URI. **Fixed:** docs use `$DB_URI`; script requires `DB_URI` env and uses no inline credentials.
- **Impact:** Full read/write access to the MongoDB database; account takeover, data exfiltration, or destruction.
- **Remediation:**  
  1. Remove or redact all connection strings from docs and scripts. Use placeholders like `mongodb+srv://USER:PASSWORD@HOST/DB` and document that real values come from env (e.g. `DB_URI`).  
  2. Rotate the MongoDB user password immediately (Atlas UI or API).  
  3. Ensure `DB_URI` is only set via environment (e.g. EC2/PM2) and never committed.

### 2.2 Sensitive data in repo (Critical)

- **Where:** `backend/storage/_data/users.json` contains user records with `passwordHash`, `username`, `role`, etc.
- **Impact:** If this file is committed or deployed, hashes can be targeted for offline cracking; user list and roles are exposed.
- **Remediation:**  
  1. Add `storage/_data/`, `storage/_data/uploads/`, and any path that holds users.json or uploads to `backend/.gitignore`.  
  2. If the file was ever committed, remove it from history (e.g. `git filter-branch` / BFG) and rotate passwords for affected users.  
  3. In production, use only MongoDB (or another remote store); do not rely on file-backed user store.

### 2.3 Unauthenticated /metrics (Critical)

- **Where:** `backend/app.js` mounts `GET /metrics` before the HTTP router; no auth.
- **Impact:** Counters and timestamps can be scraped to infer traffic, errors, and system behavior; useful for reconnaissance and abuse.
- **Remediation:**  
  1. Require authentication (e.g. admin or a dedicated metrics role) or a shared secret (e.g. query param or header validated server-side).  
  2. Alternatively, expose metrics only on a separate internal port or network not reachable from the internet.

### 2.4 Request body size (High)

- **Where:** `backend/http/index.js`: `httpRouter.use(express.json());` with no `limit`.
- **Impact:** A client can send a huge JSON body; Node buffers it in memory and may run out of memory (DoS).
- **Remediation:** Set a reasonable limit, e.g. `express.json({ limit: '256kb' });` (adjust per API needs). Consider a stricter limit for auth endpoints.

### 2.5 REFRESH_PEPPER not in production checklist (High)

- **Where:** `config/constants.js` throws in production if `REFRESH_PEPPER` is empty; `config/env.validate.js` does not list `REFRESH_PEPPER` among required production variables.
- **Impact:** Deployments may pass env validation but fail at runtime when the first login or refresh runs, causing confusion and downtime.
- **Remediation:** Add `REFRESH_PEPPER` to the production required list in `env.validate.js` and document it in `.env.example` and deployment docs (e.g. PROD_MODE_CHECK.md, DEPLOYMENT_ASSUMPTIONS.md).

### 2.6 Image upload MIME spoofing (High)

- **Where:** `backend/http/controllers/uploads.controller.js` allows `image/jpeg`, `image/png`, `image/gif`, `image/webp` based on `file.mimetype` only.
- **Impact:** An attacker can send a non-image file with a spoofed `Content-Type` and have it saved and later served (e.g. as an “image” in the UI or via direct URL). Could lead to XSS if the browser interprets the file (e.g. SVG/HTML served as image) or to malware distribution.
- **Remediation:** Validate file content (magic bytes) for allowed image types and reject mismatches. Optionally restrict extensions and store with a safe extension derived from validated type.

---

## 3. What is in good shape

- **Authentication & sessions:** JWT in HTTP-only cookies, refresh token rotation, session store, ban checks.  
- **Authorization:** Role-based access (USER/ADMIN), root admin protection, `requireAuth` and role middleware.  
- **CORS & CSRF:** CORS middleware and origin/referer guard for state-changing methods.  
- **Security headers:** Helmet with CSP, X-Frame-Options, X-Content-Type-Options, referrer policy.  
- **Rate limiting:** Auth, logout, message, report, and admin action limiters.  
- **Env validation:** Production required vars (except REFRESH_PEPPER) and DEV_TOKEN_MODE block in prod.  
- **Secrets:** JWT and refresh pepper from env; no hardcoded secrets in application code (only in docs/scripts as above).  
- **Password handling:** Bcrypt, no plaintext storage, password not returned in API.  
- **Input validation:** Zod and custom validation; pagination and query params bounded.  
- **WebSocket:** Rate limiting, backpressure, payload size limit, heartbeat.  
- **Frontend:** No `dangerouslySetInnerHTML` on user content; XSS guidance in docs.

---

## 4. Deployment readiness verdict

**Not ready for production** until:

1. All **critical** and **high** issues above are addressed.  
2. The **deployment checklist** in Section 5 is completed.  
3. No credentials or sensitive files remain in the repo or deployment artifacts.

---

## 5. What’s missing for deployment

### 5.1 Security (must fix before prod)

- [ ] **Remove or redact** all MongoDB (or other) credentials from `backend/verify-realtime-delivery.md` and `backend/scripts/verify-delivery-fix.sh`; rotate the exposed DB password.
- [ ] **Stop tracking sensitive data:** add `storage/_data/`, `storage/_data/uploads/`, and any local user/upload paths to `backend/.gitignore`; ensure `users.json` and uploads are never committed.
- [ ] **Protect `/metrics`:** add auth or a shared secret, or expose metrics only on an internal interface.
- [ ] **Add JSON body limit:** e.g. `express.json({ limit: '256kb' })` in `backend/http/index.js`.
- [ ] **Document and enforce REFRESH_PEPPER:** add to production required list in `env.validate.js` and to deployment/docs (e.g. `.env.example`, PROD_MODE_CHECK.md).
- [ ] **Harden image uploads:** validate image content (magic bytes) and reject spoofed MIME types.
- [ ] **Run `npm audit fix`** in `backend/` and re-run tests; address any remaining advisories.

### 5.2 Environment & configuration

- [ ] Set **production env** (e.g. on EC2/PM2 or your platform):  
  `NODE_ENV=production`, `PORT`, `JWT_SECRET`, `DB_URI`, `REFRESH_PEPPER`, `COOKIE_DOMAIN`, `CORS_ORIGIN` or `CORS_ORIGINS`, `WS_PATH`.  
  Optionally: `ROOT_ADMIN_EMAIL`, `ROOT_ADMIN_PASSWORD` for bootstrap; SMTP for password reset.
- [ ] Ensure **no dev flags** in prod: `ENABLE_DEV_ROUTES`, `ALLOW_BYPASS_AUTH`, `DEV_TOKEN_MODE`, `DEV_SEED_ADMIN` unset or false.
- [ ] **CORS:** Set `CORS_ORIGIN` (or `CORS_ORIGINS`) to the exact frontend origin(s) (e.g. `https://app.example.com`).
- [ ] **Cookies:** SameSite=None, Secure=true, and correct `COOKIE_DOMAIN` for your domain (e.g. `.example.com`).

### 5.3 Infrastructure & ops

- [ ] **TLS:** Terminate HTTPS at reverse proxy (e.g. NGINX); backend can run HTTP behind it (per DEPLOYMENT_ASSUMPTIONS.md).
- [ ] **WebSocket:** Proxy `wss://` to backend `WS_PATH`; set proxy timeouts (e.g. read/send) greater than `WS_HEARTBEAT_TIMEOUT`.
- [ ] **Redis:** If used (e.g. for bus), configure `REDIS_URL` or `REDIS_HOST`/`REDIS_PORT`/`REDIS_PASSWORD` and ensure Redis is not publicly reachable.
- [ ] **MongoDB:** Use Atlas (or equivalent) with `mongodb+srv://`; restrict network access (IP allowlist/VPC); strong password and no credentials in repo.

### 5.4 Frontend

- [ ] Build with production API/WS URLs (e.g. env at build time: `VITE_API_URL`, `VITE_WS_URL`).
- [ ] Ensure **no dev-only** env (e.g. `VITE_DEV_BYPASS_AUTH`, `VITE_DEV_TOKEN_MODE`) in production build.
- [ ] Serve frontend over HTTPS and from the same origin (or allowed CORS origin) used in backend config.

### 5.5 Verification

- [ ] Run backend tests with production-like env (e.g. `NODE_ENV=production` and required vars) and confirm all pass.
- [ ] Manually test: login, refresh, logout, chat send, admin flows, password reset (if SMTP configured).
- [ ] Confirm `/metrics` is no longer publicly accessible (or is protected as chosen).
- [ ] Confirm no credentials or `users.json` in deployment artifact or image.

---

## 6. Summary table

| Severity  | Count | Status / action |
|-----------|-------|------------------|
| Critical  | 3     | Fix before any production deploy |
| High      | 3     | Fix before production deploy |
| Medium    | 3     | Address and verify before/at deploy |
| Low/Info  | 2     | Document and follow in ops |

**Verdict:** Address critical and high items, complete the deployment checklist, and then re-assess. After that, the project can be considered ready for a controlled production deployment with ongoing monitoring and dependency updates.
