# Phase 1: Message rate verification (instrumentation only)

## 1. Frontend TEMP debug logs added

- **`myfrontend/frontend/src/features/admin/adapters/useAdminDashboard.js`**  
  After successful `fetchAdminDashboard()`, added:
  - `console.log("[TEMP useAdminDashboard] raw data from fetchAdminDashboard():", data);`
  - Logs the raw object returned (e.g. `onlineUsers`, `messagesPerSecond`, `latencyAvg`, `suspiciousFlags`, …).

- **`myfrontend/frontend/src/features/admin/adapters/useAdminDashboardTimeseries.js`**  
  After successful `fetchAdminDashboardTimeseries()`, added:
  - `console.log("[TEMP useAdminDashboardTimeseries] raw data from fetchAdminDashboardTimeseries():", d);`
  - Logs the raw object (e.g. `windowSeconds`, `bucketSeconds`, `points` with `time`, `messages`, `connections`).

**These logs must be removed in Phase 4.**

---

## 2. Backend return shapes (admin.controller.js)

### GET /api/admin/dashboard — `getDashboard()`

- **Location:** `backend/http/controllers/admin.controller.js` (getDashboard, ~194–221).
- **Response (success):** `sendSuccess(res, data)` with:
  - `onlineUsers`: number (connections.totalConnections ?? 0)
  - **`messagesPerSecond`**: number — from `events.messagesPerSecond ?? 0` (snapshot comes from `observability.getSnapshot()`; `events.messagesPerSecond` is set in `observability/snapshot.js` from the messages aggregator, which can return decimals and rounds to 2 decimals in `observability/aggregators/messages.js`).
  - `latencyAvg`: number
  - `suspiciousFlags`: number
  - `adminsCount`, `regularUsersCount`: numbers

So **`messagesPerSecond` is a number and can be a decimal** (e.g. 0.05). No integer coercion in getDashboard.

### GET /api/admin/dashboard/timeseries — `getDashboardTimeseries()`

- **Location:** `backend/http/controllers/admin.controller.js` (getDashboardTimeseries, ~229–257).
- **Response (success):** `sendSuccess(res, { windowSeconds, bucketSeconds, points })`.
- **`points`:** array of:
  - `time`: ISO string
  - **`messages`**: number — from `Math.round(m * 100) / 100` (2-decimal), so can be e.g. 0.05.
  - `connections`: number (integer).

So **both dashboard and timeseries return numeric message rates that can be fractional.**

---

## 3. Curl commands (run with backend on PORT)

Backend is **cookie-based auth** (JWT in cookie, typically `token`). Without a valid cookie, admin routes return **401** or **403**.

### Option A: Copy cookie from browser

1. Log in to the app as an admin user.
2. DevTools → Application → Cookies → select origin → copy the `token` cookie value.
3. Replace `<PASTE_TOKEN_HERE>` below.

```bash
# Backend must be running (e.g. PORT=8000). Replace 8000 if your backend uses another port.

# Dashboard (cards)
curl -i -b "token=<PASTE_TOKEN_HERE>" "http://localhost:8000/api/admin/dashboard"

# Timeseries (chart)
curl -i -b "token=<PASTE_TOKEN_HERE>" "http://localhost:8000/api/admin/dashboard/timeseries?windowSeconds=3600&bucketSeconds=60"
```

### Option B: Cookie file

1. Export cookie (e.g. from browser or after login):
   - Create `cookie.txt` with a line:  
     `localhost	FALSE	/	FALSE	0	token	<YOUR_JWT_VALUE>`
2. Or after a login request, save the `Set-Cookie` value and use it in a file as above (format: Netscape cookie file).
3. Run:

```bash
curl -i -b cookie.txt "http://localhost:8000/api/admin/dashboard"
curl -i -b cookie.txt "http://localhost:8000/api/admin/dashboard/timeseries?windowSeconds=3600&bucketSeconds=60"
```

### If you have no cookie (expect 401/403)

```bash
curl -i "http://localhost:8000/api/admin/dashboard"
curl -i "http://localhost:8000/api/admin/dashboard/timeseries?windowSeconds=3600&bucketSeconds=60"
```

Use the same port your backend actually uses (default dev is 8000).

---

## 4. Conclusion (fill after running)

- **If backend returns `messagesPerSecond` or `points[].messages` as non-zero decimals (e.g. 0.05) but the UI shows 0**  
  → **UI scale/format issue** (e.g. display rounding or wrong field).

- **If backend always returns 0 for message rates even while messages are being sent**  
  → **Persistence/metrics wiring issue** (aggregator, snapshot, or buffer not receiving or computing the rate).

Do not implement fixes in Phase 1; only instrument and verify, then document which of the two cases above applies (and any nuance) here.
