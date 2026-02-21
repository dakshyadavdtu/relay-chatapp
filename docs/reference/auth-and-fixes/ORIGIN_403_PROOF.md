# OriginGuard 403 (CSRF_BLOCKED) — Proof: Trailing Slash / Normalization Mismatch

## Summary

OriginGuard can return **403 CSRF_BLOCKED** on Render (or any environment) even when CORS appears correct, because **allowed origins are compared by exact string match**. If `CORS_ORIGINS` (or `CORS_ORIGIN`) includes a value with a **trailing slash** (e.g. `https://myapp.onrender.com/`), startup validation **passes**, but browsers always send the `Origin` header **without** a trailing slash (`https://myapp.onrender.com`). The guard uses `allowedOrigins.includes(origin)`, so the request origin never matches and the request is blocked.

## Exact condition

- **Config side:** `CORS_ORIGINS` or `CORS_ORIGIN` contains at least one origin string that includes a trailing slash or path (e.g. `https://<host>/` or `https://<host>/`).
- **Runtime side:** The request sends an `Origin` header (or a `Referer` that yields an origin via `new URL(referer).origin`) that is the same logical origin but **string-different** (no trailing slash, or normalized form).
- **Validation:** `config/origins.js` → `validateOriginFormat()` treats `pathname === '/'` as valid, so `https://example.com/` **passes** env validation in `env.validate.js`.
- **Comparison:** `isAllowedOrigin(origin)` uses **exact** `allowedOrigins.includes(origin)`. No normalization is applied to either the stored list or the request origin. So `"https://example.com" !== "https://example.com/"` → **blocked**.

## Evidence

1. **Exact match in code**  
   - `backend/config/origins.js`: `isAllowedOrigin()` returns `allowedOrigins.includes(origin)` (and in dev, localhost bypass). No trimming or URL normalization of `origin` or of the allowlist entries.

2. **Validation allows trailing slash**  
   - `validateOriginFormat()` in `origins.js`: `const noPath = u.pathname === '' || u.pathname === '/'` — so `https://host/` is considered valid and can be stored in the allowlist.

3. **Browser / URL API behavior**  
   - The `Origin` header and `URL.prototype.origin` are defined to be scheme + host + port only (no path). So the request always sends e.g. `https://myapp.onrender.com`, never `https://myapp.onrender.com/`.

4. **Deterministic repro**  
   - Run: `node backend/scripts/repro-origin-403.js`  
   - It sets `CORS_ORIGINS='https://myapp.onrender.com/'`, then checks `isAllowedOrigin('https://myapp.onrender.com')` → **false**. So OriginGuard would return 403 for that request.

## Root cause (one-line)

**Allowed origins are stored and compared as raw strings with no normalization; env validation permits a trailing slash, but the browser never sends one, so an exact-string allowlist causes a mismatch and 403.**

## Debug logging (safe, dev-only)

Safe logging is gated and **never** logs cookies, auth headers, or request body. Default off.

- **`DEBUG_ORIGIN_GUARD=true`** — logs for each state-changing request: `requestOrigin`, `decision` (allow/block), and `allowedOriginsCount`. Full allowlist is **not** logged by default.
- **`DEBUG_ORIGIN_GUARD_VERBOSE=true`** — in addition, logs the full `allowedOrigins` list (use only when needed).

Enabled only when explicitly set; safe for production use when diagnosing (no secrets or PII in logs).

## Reproducer commands

**1) Node-only (no server):**

```bash
cd backend && node scripts/repro-origin-403.js
```

Expected: `OK: Origin would be BLOCKED (403 CSRF_BLOCKED). Trailing-slash mismatch reproduced.`

**2) With live server:**

1. Start backend with a trailing slash in CORS, e.g.  
   `CORS_ORIGINS="https://myapp.onrender.com/"` (and other required env).
2. Send a POST with Origin **without** trailing slash:

   ```bash
   curl -s -X POST http://localhost:8000/api/login \
     -H "Origin: https://myapp.onrender.com" \
     -H "Content-Type: application/json" \
     -d '{}'
   ```

3. Expect **403** and response body with `"code": "CSRF_BLOCKED"`.

## Fix applied

Canonical origin normalization is implemented in `backend/config/origins.js`: **canonical origin is `URL.origin`; this eliminates trailing slash mismatch.** All allowlist entries and the incoming request origin are normalized via `normalizeOrigin()` (trim, parse as URL, reject non-http(s)/credentials/path/query/fragment, return `u.origin`). Config value `https://x/` becomes `https://x` internally; `https://x/path` fails fast at validation/normalization.
