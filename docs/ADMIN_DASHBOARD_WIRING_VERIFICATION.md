# Admin Dashboard Wiring Verification

## 1. Backend endpoints

All four admin dashboard endpoints exist and are mounted:

| Endpoint | Handler | Auth |
|----------|---------|------|
| `GET /api/admin/dashboard` | `getDashboard` | requireAuth + requireAdmin |
| `GET /api/admin/dashboard/timeseries` | `getDashboardTimeseries` | requireAuth + requireAdmin |
| `GET /api/admin/dashboard/series` | `getDashboardSeries` (stats) | requireAuth + requireAdmin |
| `GET /api/admin/dashboard/activity` | `getDashboardActivity` | requireAuth + requireAdmin |

Mount chain: `app.use('/api', httpRouter)` in `app.js`, and `httpRouter.use('/admin', adminRoutes)` in `http/index.js`, so admin routes are at `/api/admin/...`.

---

## 2. Which endpoint returns empty data

- **GET /api/admin/dashboard**  
  - **Before fix:** Returned `onlineUsers: 0` (and zeroed connection-related fields) because `connections` aggregator returned early when `state` was `null` (snapshot always passes `null`).  
  - **After fix:** Connections aggregator no longer short-circuits on `null` state; it always reads from `connectionManager`. So dashboard now returns real connection counts when called by an admin.
- **GET /api/admin/dashboard/timeseries**  
  - Returns `points` from `adminDashboardBuffer.getSeries()`. Can be empty if the buffer has not yet accumulated samples (buffer samples every 60s). Not a wiring bug.
- **GET /api/admin/dashboard/series** (stats)  
  - Returns extended stats from `adminDashboardBuffer.getExtendedStats()`. Same as above; can be empty until samples exist.
- **GET /api/admin/dashboard/activity**  
  - Returns events from `adminActivityBuffer.getEvents()`. Can be empty if no report/ban/flag/spike/failure events have been recorded yet. Events are written by the WS dispatcher and reports controller.

So: **no endpoint is incorrectly “empty” after the connections aggregator fix.** Emptiness for timeseries/series/activity is expected until there is traffic and/or admin/report activity.

---

## 3. Auth blocking admin calls

- **Unauthenticated (no token or invalid token):** `requireAuth` → **401**; admin handlers are not run.
- **Authenticated but not admin:** `requireAdmin` uses `req.user.effectiveRole ?? req.user.role`; if role is not ADMIN → **403**.

So: **auth does block admin calls** as intended (401 when not logged in, 403 when not admin).

---

## 4. Admin WebSocket and metrics flow

- **There is no `/ws/admin` endpoint.** The backend exposes a single WebSocket path (e.g. `/ws`). There is no separate admin-only WebSocket URL.
- **Admin dashboard does not require a dedicated admin WebSocket.** Data flow:
  - **adminDashboardBuffer:** Started on load; samples every 60s from `connectionManager`, `messagesAggregator`, `latencyAggregator`, `suspiciousDetector`. No admin WS needed.
  - **adminActivityBuffer:** Receives events from:
    - WS message path: `websocket/protocol/dispatcher.js` (e.g. message-type events),
    - Reports: `http/controllers/reports.controller.js`,
    - Suspicious: `suspicious/suspicious.detector.js`.
- So **metrics flow from main app activity** (main `/ws` traffic, HTTP reports, suspicious detector) into the buffers; the admin UI reads them via the **HTTP** dashboard endpoints above. No separate admin WebSocket connection is used or required.

If you later add a dedicated `ws://localhost:<port>/ws/admin` for live admin-only pushes, that would be a new backend (and optionally frontend) feature; current wiring uses HTTP only for admin dashboard data.

---

## 5. TEST_MODE / mock mode for admin frontend

- Admin dashboard code does **not** use `VITE_TEST_MODE` or mock data. It uses `apiFetch` in `features/admin/api/admin.api.js` and the real admin adapters (`useAdminDashboard`, `useAdminDashboardTimeseries`, etc.). No change was required to “disable” test/mock mode for admin.

---

## 6. Wiring fix applied (no UI changes)

- **File:** `backend/observability/aggregators/connections.js`
- **Change:** Removed the early return `if (!state) return { total: 0 }`. The snapshot (and any other caller) passes `null` for `state`; the aggregator does not use `state` and reads only from `connectionManager`. So we always read from `connectionManager` and return real connection counts.
- No React components or UI layout were modified.

---

## Summary

| Question | Answer |
|----------|--------|
| Which endpoint returns empty data? | Dashboard no longer returns forced-zero connections. Timeseries/series/activity can be empty until buffers and events exist (expected). |
| Does auth block admin calls? | Yes: 401 when unauthenticated, 403 when not admin. |
| Are WebSocket metrics flowing? | There is no `/ws/admin`. Metrics flow from main app (e.g. `/ws` traffic and HTTP/suspicious) into `adminDashboardBuffer` and `adminActivityBuffer`; the admin UI gets them via the HTTP dashboard endpoints. |
