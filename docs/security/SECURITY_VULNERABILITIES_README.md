# Security Vulnerabilities Audit Report

**Scope:** Frontend (`myfrontend/frontend`) and Backend (`backend`) only.  
**Date:** Audit-only; no code was modified.  
**Purpose:** Document all identified security vulnerabilities and configuration risks for remediation.

---

## Summary

| Category | Count | Severity overview |
|----------|--------|-------------------|
| High | 3 | Token exposure, XSS, config mismatch |
| Medium | 6 | Auth bypass risk, logging, defaults |
| Low / Informational | 8 | Hardcoded defaults, info disclosure |

---

## 1. Backend Vulnerabilities

### 1.1 HIGH: Refresh token pepper empty in production (weakens token security)

**Location:** `backend/config/constants.js`, `backend/auth/tokenService.js`

**Details:**  
`REFRESH_PEPPER` is read from `process.env.REFRESH_PEPPER` and defaults to `''`. It is used to hash refresh tokens before storage (`sha256(token + REFRESH_PEPPER)`). Production env validation does **not** require `REFRESH_PEPPER` (only `JWT_SECRET`, `DB_URI`, `COOKIE_DOMAIN`, `CORS_ORIGIN`, `WS_PATH`, etc.).

**Risk:**  
If the refresh-token store is ever compromised, an empty pepper makes it easier to brute-force or correlate tokens. In production, a strong random pepper should be required.

**Recommendation:**  
- Add `REFRESH_PEPPER` to the list of required env vars in production in `backend/config/env.validate.js`, or at least validate length/entropy when set.  
- Document in deployment docs that `REFRESH_PEPPER` must be set in production.

---

### 1.2 HIGH: ALLOWED_ORIGINS vs CORS_ORIGIN mismatch (CSRF / origin guard misconfiguration)

**Location:** `backend/http/middleware/originGuard.middleware.js`, `backend/config/env.validate.js`

**Details:**  
- **Origin guard** uses `process.env.ALLOWED_ORIGINS` (comma-separated). If unset, it falls back to dev-only defaults (`http://localhost:5173`, `http://127.0.0.1:5173`).  
- **Production env validation** requires `CORS_ORIGIN` but does **not** require or mention `ALLOWED_ORIGINS`.

**Risk:**  
In production, if only `CORS_ORIGIN` is set and `ALLOWED_ORIGINS` is not, `parseAllowedOrigins()` returns an empty array. Then:  
- Any request with an `Origin` header will fail the allowlist check and get 403 (CSRF_BLOCKED).  
- Legitimate same-site requests from the real frontend origin would be blocked unless that origin is in `ALLOWED_ORIGINS`.  
Result: either production is broken for real users, or operators set `ALLOWED_ORIGINS` without clear docs, increasing misconfiguration and potential lockout/weak config.

**Recommendation:**  
- Align naming and contract: either use `CORS_ORIGIN` in the origin guard (and parse it as comma-separated), or require `ALLOWED_ORIGINS` in production and document both.  
- Ensure production deployment docs list the exact env vars needed for origin checking.

---

### 1.3 MEDIUM: JWT in WebSocket URL query string (token in logs / Referer)

**Location:**  
- Frontend: `myfrontend/frontend/src/config/ws.js`  
- Backend: `backend/websocket/connection/wsServer.js`

**Details:**  
When `DEV_TOKEN_MODE` is true, the frontend builds the WebSocket URL with `?accessToken=${encodeURIComponent(accessToken)}`. The backend reads the token from the query string for upgrade.

**Risk:**  
- Access tokens in URL can be logged by proxies, load balancers, or server logs (e.g. `request.url`).  
- They can leak via Referer if the user follows a link from the app.  
- This is intended for dev only, but if `DEV_TOKEN_MODE` is ever enabled in production by mistake, tokens would be exposed.

**Recommendation / Status:**  
- Dev-only; backend fails at startup if `NODE_ENV=production` and `DEV_TOKEN_MODE=true`. Production WS upgrade rejects any request with `?accessToken` in URL.  
- Ensure production never sets `DEV_TOKEN_MODE` and that no production logging logs full `request.url` (or strip query before logging).  
- Prefer passing the token in a header or cookie for WebSocket auth in any future non-cookie flow.

---

### 1.4 MEDIUM: Dev routes mounted by environment only (no auth)

**Location:** `backend/http/index.js`, `backend/http/controllers/dev.controller.js`

**Details:**  
- `GET /api/dev/debug/auth` and `GET /api/dev/chats/list?asUserId=...` are mounted only when `process.env.NODE_ENV !== 'production'`.  
- They return 404 in production.  
- In non-production, they require **no authentication**. `getChatListAsUser` sets `req.user = { userId: req.query.asUserId }` and calls `chatController.getChats`, effectively impersonating any user by ID.

**Risk:**  
If `NODE_ENV` is ever unset or set to something other than `production` in a deployed environment, anyone can call `/api/dev/chats/list?asUserId=<any-user-id>` and list that user’s chats without authentication (IDOR-style auth bypass).

**Recommendation:**  
- Keep dev routes strictly behind `NODE_ENV === 'production'` check and document that production must set `NODE_ENV=production`.  
- Optionally add an explicit allowlist (e.g. only localhost) for dev routes even in development.

---

### 1.5 MEDIUM: Console.log of WS auth failures (sensitive trace data)

**Location:** `backend/websocket/connection/wsServer.js` (multiple lines)

**Details:**  
This instrumentation was removed. Debug mode flags (WS_CONN_TRACE, WS_DEBUG_MODE, PresenceTrace) are no longer available. Connection/auth failure tracing is not gated by these flags in current code.

**Risk:**  
N/A for removed instrumentation. For any future debug logging, avoid logging session IDs or token values in production.

**Recommendation:**  
- In production, use a structured logger with a log level and avoid logging session IDs (or redact them) unless necessary for security incident response.

---

### 1.6 MEDIUM: Cookie secure default in production (correct but env-dependent)

**Location:** `backend/config/cookieConfig.js`

**Details:**  
`COOKIE_SECURE` is `true` when `NODE_ENV === 'production'` unless explicitly set to `'false'` via env. This is correct. `COOKIE_SAME_SITE` defaults to `'Lax'`.

**Risk:**  
If production is ever run with `NODE_ENV` not set to `production`, cookies could be sent over HTTP (secure=false), weakening auth. Low probability but worth documenting.

**Recommendation:**  
- In production deployment, always set `NODE_ENV=production` and optionally set `COOKIE_SECURE=true` and `COOKIE_SAME_SITE=Lax` (or `Strict`) explicitly so behavior does not depend solely on `NODE_ENV`.

---

### 1.7 LOW: Root admin default username hardcoded

**Location:** `backend/config/constants.js`

**Details:**  
`ROOT_ADMIN_USERNAME` defaults to a fixed value (e.g. `'root_admin'`) when `process.env.ROOT_ADMIN_USERNAME` is not set.

**Risk:**  
Information disclosure and predictable admin username in default/config-less setups. Attackers may target this username for brute-force or social engineering.

**Recommendation:**  
- Require `ROOT_ADMIN_USERNAME` (and `ROOT_ADMIN_EMAIL`) in production, or remove default and fail fast if root admin is configured without explicit env.

---

### 1.8 LOW: Metrics endpoint unauthenticated

**Location:** `backend/app.js` — `GET /metrics` returns JSON counters and timestamp.

**Details:**  
The endpoint is mounted without auth and returns internal counters (e.g. connection counts, rejections).

**Risk:**  
Information disclosure (e.g. traffic patterns, error rates). Usually acceptable for internal monitoring; can be a concern if the app is exposed to the internet and metrics are sensitive.

**Recommendation:**  
- Restrict `/metrics` to localhost or an internal network, or protect with auth / API key / IP allowlist in production.

---

### 1.9 LOW: Health endpoints unauthenticated

**Location:** `backend/app.js` — `GET /health`, `GET /api/health`

**Details:**  
Both return `{ ok: true }` with no auth.

**Risk:**  
Minimal; health checks are typically public. Ensures load balancers and probes can run without credentials.

**Recommendation:**  
No change required; optional: avoid returning stack or env details in error responses if health logic is extended later.

---

## 2. Frontend Vulnerabilities

### 2.1 HIGH: Stored XSS via Chat Export (PDF/print HTML)

**Location:** `myfrontend/frontend/src/components/settings/SettingsModal.jsx`

**Details:**  
In the “Export as PDF” (print) flow, chat messages are taken from `getChatState()` and rendered into an HTML string:

```javascript
const lines = allMessages.map((msg) => {
  const time = new Date(msg.createdAt || msg.timestamp || 0).toLocaleString();
  return `[${time}] ${String(msg.senderId || "").slice(0, 8)}: ${msg.content || ""}`;
});
// ...
${lines.map((l) => `<div class="msg">${l}</div>`).join("")}
```

This HTML is written to a new window via `printWindow.document.write(htmlContent)`. Message `content` and `senderId` are **not** escaped for HTML.

**Risk:**  
If an attacker can cause malicious message content (or senderId) to be stored and later exported (e.g. `<script>...</script>`, `<img onerror="...">`), that content will be executed in the context of the export window when the user clicks “Export as PDF”. This is stored XSS with user interaction (clicking export).

**Recommendation:**  
- Escape all user-controlled data before inserting into HTML (e.g. encode `&`, `<`, `>`, `"`, `'`).  
- Prefer a small escaping helper or a safe template so that `lines` are always treated as text, not HTML.

---

### 2.2 MEDIUM: Tokens in sessionStorage (dev token mode)

**Location:** `myfrontend/frontend/src/features/auth/tokenTransport.js`, `myfrontend/frontend/src/http/auth.api.js`

**Details:**  
When `VITE_DEV_TOKEN_MODE=true`, access and refresh tokens are stored in `sessionStorage` and sent via `Authorization: Bearer` and `x-dev-token-mode`. This is documented as dev-only.

**Risk:**  
- If dev token mode is ever enabled in a production build (e.g. by mistake in build env), tokens would be in sessionStorage and vulnerable to XSS: any script running on the page could read them.  
- sessionStorage is not sent cross-site but is readable by same-origin JavaScript.

**Recommendation / Status:**  
- Production builds now fail-fast: if `VITE_DEV_TOKEN_MODE=true` when `import.meta.env.PROD === true`, the app throws on load. Backend also fails at startup if `DEV_TOKEN_MODE=true` in production.

---

### 2.3 MEDIUM: Sensitive data in localStorage/sessionStorage

**Location:** Multiple files in `myfrontend/frontend/src`

**Details:**  
- `tokenTransport.js`: dev tokens in sessionStorage (see above).  
- `sessionSwitch.js`: `localStorage.auth_user_id_last_seen` stores last seen user ID.  
- `Sidebar.jsx`, `resume.state.js`, `settings.state.js`, `settings.slice.js`, `uiPrefs.persist.js`, `uiPrefs.hydrate.js`: `lastConversationId`, resume state, settings, UI preferences stored in localStorage.  
- `authEvents.js`: auth event payload (e.g. reason, ts) in localStorage when BroadcastChannel is unavailable.

**Risk:**  
- Any XSS can read localStorage/sessionStorage and exfiltrate tokens (in dev token mode), user IDs, conversation IDs, and preferences.  
- This is inherent to client-side storage; the main mitigation is preventing XSS and restricting token storage to httpOnly cookies in production.

**Recommendation:**  
- Do not store access/refresh tokens in storage in production (already the case when dev token mode is off).  
- Keep only non-sensitive or non-secret data in localStorage/sessionStorage; treat all of it as readable by any same-origin script.

---

### 2.4 LOW: document.write and innerHTML in main.jsx (dev-only)

**Location:** `myfrontend/frontend/src/main.jsx`

**Details:**  
When the dev host check fails (e.g. using 127.0.0.1 instead of localhost), the app sets `root.innerHTML = ""` and builds a warning div with `div.innerHTML = \`...\``. The inserted content is static (no user or server input).

**Risk:**  
Minimal: no user-controlled input; dev-only path. Still, using innerHTML with static strings is a bad pattern to copy elsewhere.

**Recommendation:**  
- Prefer `textContent` or React for the warning message so the codebase does not normalize innerHTML use.

---

### 2.5 LOW: VITE_* env in frontend bundle

**Location:** Various files using `import.meta.env.VITE_DEV_TOKEN_MODE`, `VITE_API_BASE_URL`, etc. (VITE_WS_DEBUG_MODE and similar debug flags were removed.)

**Details:**  
Vite inlines `import.meta.env.*` at build time. Values are visible in the client bundle.

**Risk:**  
- Accidentally setting `VITE_DEV_TOKEN_MODE=true` in production build would enable token-in-storage behavior; the app now fails-fast on load in that case.  
- Other `VITE_*` vars (e.g. API URL, feature flags) are visible to anyone who inspects the bundle; no secrets should be in `VITE_*`.

**Recommendation:**  
- Do not put secrets in any `VITE_*` variable.  
- Use a strict production build env (e.g. in CI) that never sets dev-only flags.

---

## 3. Positive Security Findings (No Change Required)

- **JWT verification:** Uses timing-safe comparison and proper exp/nbf checks (`backend/utils/jwt.js`).  
- **Password handling:** Passwords hashed with bcrypt; not logged; not returned in API (`backend/users/user.service.js`, API contract tests).  
- **Auth middleware:** JWT from cookie or (dev) Bearer; role from DB after token; banned users rejected (`backend/http/middleware/auth.middleware.js`).  
- **Admin authorization:** Admin and root-admin routes protected with `requireAdmin` / `requireRootAdmin`; root user protected from demotion/ban (`backend/auth/rootProtection.js`, admin routes).  
- **Input validation:** Admin/report IDs and conversation IDs validated with length and format checks (`backend/utils/adminValidation.js`).  
- **Message content:** Length cap and validation in send message handler and WebSocket safety layer.  
- **Uploads:** Image type and size limits; random filenames; MIME allowlist (`backend/http/controllers/uploads.controller.js`).  
- **Origin guard:** CSRF-style protection for state-changing methods using Origin/Referer allowlist.  
- **Rate limiting:** Auth, report, admin, and message endpoints rate-limited.  
- **CSP and headers:** Helmet with CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy in `backend/app.js`.  
- **Production env:** Required vars validated in production; no silent defaults for JWT_SECRET, DB_URI, etc. (`backend/config/env.validate.js`).

---

## 4. Remediation Priority

1. **High:** Fix REFRESH_PEPPER requirement and ALLOWED_ORIGINS/CORS_ORIGIN alignment; fix XSS in SettingsModal export HTML.  
2. **Medium (addressed):** WS_CONN_TRACE and related instrumentation removed. Dev token mode has production fail-fast (frontend throws on load; backend exits at startup; WS rejects ?accessToken in production).  
3. **Low:** Harden metrics/health if exposed; remove or require root admin defaults; reduce use of innerHTML/document.write where easy.

---

## 5. Document and Scope

- **Audited:** `myfrontend/frontend` (frontend) and `backend` (backend). Other folders were ignored.  
- **No code was modified;** this is an audit-only report.  
- Apply fixes in a separate change and re-validate with tests and a short security review.
