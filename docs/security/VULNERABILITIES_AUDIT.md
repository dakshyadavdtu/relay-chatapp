# Security Vulnerabilities Audit

**Project:** Integrated frontend + chat backend (Node/Express + React/Vite)  
**Scope:** Backend (`backend/`), frontend (`myfrontend/frontend/`)  
**Date:** February 2026  
**Purpose:** Single list of all identified security vulnerabilities for remediation.

---

## Summary

| Severity | Count | Categories |
|----------|--------|------------|
| Critical | 1 | Stored XSS (export flow) |
| High     | 4 | Refresh pepper, CORS/origin mismatch, token in WS URL (dev), missing body limit |
| Medium   | 5 | Dev routes, cookie secure env-dependent, logging, upload MIME-only, dependency (qs) |
| Low      | 6 | Root admin default, metrics/health, innerHTML, token storage, env in bundle, ReDoS edge case |

---

## 1. Backend Vulnerabilities

### 1.1 HIGH: REFRESH_PEPPER not in production env validation list

**Location:** `backend/config/env.validate.js` (required list at line 51), `backend/config/constants.js` (lines 57–63)

**Details:**  
`REFRESH_PEPPER` is enforced in `constants.js` (throws if production and empty). It is **not** in the explicit production required list in `env.validate.js` (`NODE_ENV`, `PORT`, `JWT_SECRET`, `DB_URI`, `COOKIE_DOMAIN`, `WS_PATH`). So env validation can pass without it; failure happens only when constants load (first use of token service).

**Risk:**  
Deployments may pass CI/env checks but fail at runtime on first login/refresh; also increases chance of deploying without REFRESH_PEPPER if constants are loaded late.

**Recommendation:**  
Add `REFRESH_PEPPER` to the production required list in `env.validate.js` and document in `.env.example` and deployment docs.

---

### 1.2 HIGH: ALLOWED_ORIGINS vs CORS_ORIGIN mismatch (CSRF / origin guard)

**Location:** `backend/http/middleware/originGuard.middleware.js`, `backend/config/env.validate.js`, `backend/config/origins.js`

**Details:**  
- Origin guard uses `ALLOWED_ORIGINS` (comma-separated). If unset, falls back to dev defaults.  
- Production env validation requires `CORS_ORIGIN` (or `CORS_ORIGINS`) but does not require `ALLOWED_ORIGINS`.  
- If only `CORS_ORIGIN` is set and `ALLOWED_ORIGINS` is not, origin allowlist may be empty or inconsistent; legitimate requests can get 403 (CSRF_BLOCKED) or config can be weak.

**Risk:**  
Misconfiguration in production: either broken legitimate traffic or operators guessing env vars; potential for lockout or weak origin checks.

**Recommendation:**  
Align naming: use the same env source for both CORS and origin guard (e.g. parse `CORS_ORIGIN`/`CORS_ORIGINS` in origin guard), or require and document `ALLOWED_ORIGINS` for production.

---

### 1.3 HIGH: JWT in WebSocket URL query string (dev-only; token in logs / Referer)

**Location:**  
Frontend: `myfrontend/frontend/src/config/ws.js` (or equivalent WS URL builder)  
Backend: `backend/websocket/connection/wsServer.js`

**Details:**  
When `DEV_TOKEN_MODE` is true, the frontend can send the access token in the WebSocket URL query (e.g. `?accessToken=...`). Backend reads it for upgrade.

**Risk:**  
Tokens in URLs are logged by proxies, load balancers, and server logs; can leak via Referer. If `DEV_TOKEN_MODE` is ever enabled in production, tokens would be exposed.

**Recommendation:**  
Keep dev-only; ensure production never sets `DEV_TOKEN_MODE`. Do not log full `request.url` in production; strip query before logging. Prefer cookie or header for WS auth in any non-cookie flow.

---

### 1.4 HIGH: No JSON body size limit (DoS)

**Location:** `backend/http/index.js` (lines 68–69)

**Details:**  
`express.json()` and `express.urlencoded({ extended: false })` are used without a `limit` option.

**Risk:**  
Very large JSON or form bodies can exhaust server memory (DoS).

**Recommendation:**  
Add a limit, e.g. `express.json({ limit: '256kb' })` and `express.urlencoded({ extended: false, limit: '256kb' })` (tune per API needs).

---

### 1.5 MEDIUM: Dev routes mounted when env enabled (no auth without key)

**Location:** `backend/http/index.js` (lines 98–104), `backend/http/controllers/dev.controller.js`

**Details:**  
`GET /api/dev/debug/auth` and `GET /api/dev/chats/list?asUserId=...` are mounted when `ENABLE_DEV_ROUTES=true` and `DEV_ROUTES_KEY` (or `DEV_SESSION_KEY`) is set. They require header `x-dev-key` to match; otherwise 404. In non-production, with a weak or leaked key, anyone could impersonate a user by ID (IDOR-style).

**Risk:**  
If `NODE_ENV` is not `production` in a deployed environment, or dev key is weak/leaked, attackers can list any user’s chats without proper auth.

**Recommendation:**  
Keep dev routes behind both `ENABLE_DEV_ROUTES` and a strong `DEV_ROUTES_KEY`. Document that production must never set `ENABLE_DEV_ROUTES=true`. Optionally allowlist dev routes to localhost only.

---

### 1.6 MEDIUM: Cookie secure flag depends on NODE_ENV

**Location:** `backend/config/cookieConfig.js`

**Details:**  
`COOKIE_SECURE` is `true` when `NODE_ENV === 'production'` unless overridden. Correct by design but env-dependent.

**Risk:**  
If production is run without `NODE_ENV=production`, cookies could be sent over HTTP.

**Recommendation:**  
Document that production must set `NODE_ENV=production`; optionally set `COOKIE_SECURE=true` explicitly in production env.

---

### 1.7 MEDIUM: Sensitive data in logs (sessions, tokens, user IDs)

**Location:**  
- `backend/websocket/connection/wsServer.js`: logs can include `userId`, `sessionId`, connection identifiers.  
- `backend/http/controllers/export.controller.js`: `console.log` with `chatId`, `userId`.  
- Other controllers: ad-hoc `console.log`/`console.error` with request data.

**Risk:**  
Session IDs, user IDs, or tokens in logs can be used for session hijacking or profiling; also compliance issues.

**Recommendation:**  
Avoid logging tokens, full session IDs, or PII. Use structured logging with levels; redact or hash identifiers in production. Remove or guard debug logs that include `userId`/`chatId` in production paths.

---

### 1.8 MEDIUM: Image upload validation by MIME only (no magic bytes)

**Location:** `backend/http/controllers/uploads.controller.js`

**Details:**  
Allowed types are `image/jpeg`, `image/png`, `image/gif`, `image/webp`; check is based on `file.mimetype` only. No content-based (magic-byte) validation.

**Risk:**  
Spoofed `Content-Type` can allow non-image files (e.g. HTML/SVG) to be stored and served as images, leading to XSS or malware distribution.

**Recommendation:**  
Validate file content (magic bytes) for each allowed type; reject if content does not match declared type. Keep SVG and HTML out of allowlist (current allowlist has no SVG; keep it that way).

---

### 1.9 MEDIUM: Dependency advisory (qs)

**Location:** Backend transitive dependency (e.g. via Express)

**Details:**  
`npm audit` reports: `qs` in range 6.7.0–6.14.1 — “arrayLimit bypass in comma parsing allows denial of service” (low severity, CWE-20).

**Risk:**  
Theoretical DoS via crafted query parsing.

**Recommendation:**  
Run `npm audit fix` (or upgrade Express/qs) in `backend/` and re-run tests; resolve any remaining advisories.

---

### 1.10 LOW: Root admin default username

**Location:** `backend/config/constants.js`

**Details:**  
`ROOT_ADMIN_USERNAME` defaults to a fixed value (e.g. `'root_admin'`) when env is not set.

**Risk:**  
Information disclosure and predictable admin username in default setups.

**Recommendation:**  
Require `ROOT_ADMIN_USERNAME` (and `ROOT_ADMIN_EMAIL`) in production, or remove default and fail fast if root admin is configured without explicit env.

---

### 1.11 LOW: Metrics and health endpoints

**Location:** `backend/app.js`

**Details:**  
- `GET /metrics`: Now protected by `metricsAccessGuard` (secret header in production, or open/disabled/admin per env).  
- `GET /health`, `GET /api/health`: Return `{ ok: true }` with no auth (typical for load balancers).

**Risk:**  
If metrics mode is misconfigured (e.g. `open` in prod without `ALLOW_PUBLIC_METRICS_IN_PROD`), metrics could be exposed. Health is low risk but should not expose stack or env details if extended.

**Recommendation:**  
Ensure production uses `METRICS_MODE=secret` (default) and sets `METRICS_SECRET`. Keep health minimal; do not return sensitive data in health responses.

---

### 1.12 LOW: Search regex built from user input (ReDoS edge case)

**Location:** `backend/storage/message.mongo.js` (searchMessagesInChats)

**Details:**  
Search query is regex-escaped (`replace(/[.*+?^${}()|[\]\\]/g, '\\$&')`) then used in `new RegExp(escaped, 'i')`. Escaping prevents injection but very long escaped strings could still cause slow regex matching in edge cases.

**Risk:**  
Low; escaping is correct. Possible ReDoS only with very long, complex escaped input.

**Recommendation:**  
Cap search query length (e.g. 200–500 chars) and consider a timeout or length limit on regex execution if needed.

---

## 2. Frontend Vulnerabilities

### 2.1 CRITICAL: Stored XSS via chat export (PDF/print) — verify current code

**Location:** `myfrontend/frontend/src/components/settings/SettingsModal.jsx`

**Details:**  
Export/print flow builds HTML from chat messages. **Current code** uses `document.createElement`, `div.textContent = line`, and `doc.body.appendChild(container)` — i.e. text content, not raw HTML. If any code path still used `document.write(htmlContent)` or `innerHTML` with unescaped `msg.content` or `msg.senderId`, that would be stored XSS when the user exports.

**Risk:**  
If unescaped user content is ever written into the export document, malicious message content could execute in the export window (stored XSS with user interaction).

**Recommendation:**  
Ensure **all** export/print code paths use `textContent` or a safe HTML escape for message content and senderId. No `innerHTML` or `document.write` with user-controlled data. Prefer a small escape helper for any future HTML insertion.

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

**Location:** Multiple files (e.g. `sessionSwitch.js`, `uiPrefs.store.js`, `resume.state.js`, settings, auth events)

**Details:**  
User IDs, conversation IDs, UI preferences, and auth-related events may be stored in localStorage/sessionStorage.

**Risk:**  
Any XSS can read and exfiltrate this data. Main mitigation is preventing XSS and using httpOnly cookies for tokens in production.

**Recommendation:**  
Do not store access/refresh tokens in storage in production. Treat all client storage as readable by same-origin script; minimize sensitive data stored there.

---

### 2.4 LOW: innerHTML / document.write in main.jsx (dev-only)

**Location:** `myfrontend/frontend/src/main.jsx`

**Details:**  
When the dev host check fails (e.g. 127.0.0.1 instead of localhost), the app sets `root.innerHTML = ""` and builds a warning div with `div.innerHTML = \`...\``. Content is static (no user or server input).

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
No secrets should be in `VITE_*`. Accidentally enabling dev token mode in prod is mitigated by fail-fast on load.

**Recommendation:**  
Never put secrets in `VITE_*`. Use strict production build env in CI that does not set dev-only flags.

---

## 3. Positive Findings (No Change Required for Listing)

- **JWT verification:** Timing-safe comparison and proper exp/nbf checks.  
- **Password handling:** Bcrypt; not logged; not returned in API.  
- **Auth middleware:** JWT from cookie or (dev) Bearer; role from DB; banned users rejected.  
- **Admin routes:** All `/api/admin/*` use `requireAuth` then `requireAdmin` (or `requireRootAdmin` where required).  
- **Input validation:** Admin/report IDs and conversation IDs validated (length/format) in `backend/utils/adminValidation.js`.  
- **Message content:** Length cap and validation in send handler and WebSocket safety.  
- **Uploads:** Image allowlist (no SVG), size limit 2MB, random filenames; only missing content-based validation.  
- **Origin guard:** CSRF-style protection for state-changing methods.  
- **Rate limiting:** Auth (login/register/refresh), logout, message send, report, admin actions; WS has per-user and per-message rate limiting.  
- **CSP and headers:** Helmet with CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy.  
- **Metrics:** Protected by `metricsAccessGuard` (secret header in production by default).  
- **REFRESH_PEPPER:** Enforced in production in `constants.js` (throws if empty); should also be in env.validate required list.

---

## 4. Remediation Priority

1. **Critical:** Confirm export/print uses only safe insertion (textContent/escape); fix any remaining innerHTML/document.write on user content.  
2. **High:** Add JSON body size limit; add REFRESH_PEPPER to production env validation; align CORS/origin guard env; ensure WS token never in URL in production and URL not logged.  
3. **Medium:** Harden uploads with magic-byte validation; run `npm audit fix`; reduce/redact sensitive logging; ensure dev routes and dev flags are never enabled in production.  
4. **Low:** Harden metrics/health if exposed; root admin defaults; replace main.jsx innerHTML with textContent; cap search query length if needed.

---

*End of vulnerabilities audit. Apply fixes in code and re-validate with tests and a short security review.*
