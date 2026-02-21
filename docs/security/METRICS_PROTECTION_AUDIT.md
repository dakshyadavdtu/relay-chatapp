# Phase 0: /metrics wiring and protection audit

**Goal:** Confirm current `/metrics` wiring and choose a protection strategy consistent with this repo’s auth model. **No code changes in this phase.**

---

## 1. `/metrics` mount (outside `/api`)

**File:** `backend/app.js`  
**Lines:** 54–59

```javascript
const metrics = require('./observability/metrics');
app.get('/metrics', (req, res) => {
  res.status(200).json({
    counters: metrics.getMetrics(),
    timestamp: Date.now(),
  });
});
```

- Mounted on the root Express `app`, **not** on the `/api` router.
- Path is **`GET /metrics`** (not `/api/metrics`).
- No middleware applied; handler is the only logic.

---

## 2. HTTP auth stack lives under `/api` only

**File:** `backend/http/index.js`

- **Lines 39, 74–75:** `authMiddleware` and `requireAuth` are required and applied to `httpRouter`:
  - `const { authMiddleware, requireAuth } = require('./middleware/auth.middleware');`
  - `httpRouter.use(authMiddleware);`
  - `requireAuth` used on specific routes (e.g. `/chat/send` at line 82).
- **Line 62:** `httpRouter` is created with `express.Router()`.
- **Line 62 in app.js:** That router is mounted at `/api`: `app.use('/api', httpRouter)`.

So all auth (JWT/cookies, `req.user`) applies only to routes under `/api`. **`GET /metrics` is not under `/api` and has no auth.**

---

## 3. Admin-role middleware

**File:** `backend/http/middleware/requireRole.js`  
**Lines:** 48–51, 53–56

- `requireAdmin` is defined and exported:
  - `function requireAdmin(req, res, next) { return requireRole(ROLES.ADMIN)(req, res, next); }`
  - `module.exports = { requireRole, requireAdmin };`
- It depends on `req.user` (set by `authMiddleware` under `/api`), so it fits the existing auth model.

---

## 4. Metrics registry and response shape

**File:** `backend/observability/metrics.js`

- **Lines 44–46:** `getMetrics()` returns a shallow copy of counters: `return { ...counters };`
- **Lines 19–27:** Counters object has the expected keys (e.g. `messages_persisted_total`, `messages_delivered_total`, etc.).

**Response shape (from app.js 56–58):**

```json
{
  "counters": { "<name>": number, ... },
  "timestamp": 1234567890123
}
```

This matches the contract used in `backend/tests/metrics/metrics.test.js` (e.g. lines 53–55, 72–74).

---

## 5. Current behavior: dev vs prod

- **No** `NODE_ENV` or environment check around `/metrics` in `app.js` or `backend/http/index.js`.
- **Dev and prod:** `GET /metrics` is **publicly reachable**, unauthenticated, same behavior in both.
- **Reverse proxy:** No special handling for `/metrics` in the repo; any proxy would forward it like any other path unless configured otherwise.

---

## 6. Requirements for “Protect /metrics”

- **Production:** `/metrics` must **not** be publicly reachable.
- **Automated scraping (e.g. Prometheus):** Must work **without** a browser session (no cookie-based login).
- **Reverse proxy:** Solution must be robust when the app is behind a proxy (e.g. correct status codes, no reliance on proxy-unfriendly auth).

---

## 7. Recommendation

**Implement “secret header” protection by default in production, with optional “admin-cookie” mode for manual debugging.**

1. **Secret header (primary, prod-friendly)**  
   - Require a fixed secret in a header (e.g. `X-Metrics-Secret` or `Authorization: Bearer <METRICS_SECRET>`) for `GET /metrics`.
   - Secret from env (e.g. `METRICS_SECRET`); in production, require it to be set and non-empty.
   - Prometheus (or any scraper) sends the header; no browser or cookie needed.
   - Works well behind a reverse proxy; proxy can strip or overwrite the header if desired.

2. **Optional admin-cookie mode (for manual debugging)**  
   - If a flag (e.g. `METRICS_ALLOW_ADMIN_COOKIE=true`) is set, also allow access when the request is under `/api`-style auth and `requireAdmin` passes — e.g. by mounting a second route under `/api` (e.g. `GET /api/metrics`) with `authMiddleware` + `requireAdmin`, returning the same `{ counters, timestamp }` shape.
   - Keeps a single source of truth for the payload (`observability/metrics.js` + same handler logic) while allowing browser access for admins without configuring the secret in the browser.

3. **Production behavior**  
   - Root `GET /metrics`: require secret header; if missing or wrong → 401 (or 404 to hide existence).
   - In prod, do **not** rely only on admin-cookie for the main `/metrics` path, so that the default is “scraper with secret only” and no accidental public exposure.

4. **Dev behavior**  
   - Either allow `/metrics` without protection when `NODE_ENV !== 'production'`, or require the same secret header (with a dev default) so behavior is consistent and testable.

**Exact files/lines referenced:**

| Finding | File | Lines |
|--------|------|-------|
| `/metrics` route | `backend/app.js` | 54–59 |
| Auth on router only | `backend/http/index.js` | 39, 74–75; mount in app.js 62 |
| `requireAdmin` | `backend/http/middleware/requireRole.js` | 48–51, 53–56 |
| Metrics registry + shape | `backend/observability/metrics.js` | 44–46; app.js 56–58 |

---

*Audit complete. No code changes made (Phase 0).*
