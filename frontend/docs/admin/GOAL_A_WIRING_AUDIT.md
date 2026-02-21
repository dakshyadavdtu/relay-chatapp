# Goal A: Admin Dashboard & Users Wiring Audit

Identifies which Dashboard and Users UI elements use hardcoded dummy data vs backend-driven data. Use this for surgical wiring changes.

---

## 1. Dummy Sources (to replace)

| Source | File:Line | What It Fakes |
|--------|-----------|---------------|
| `trafficData` | [DashboardPage.jsx](../../src/pages/admin/DashboardPage.jsx) (chart data) | Time-bucketed `messages` and `connections` for the AreaChart. **Replace with:** `GET /api/admin/dashboard/timeseries` |
| `activityFeed` | [DashboardPage.jsx](../../src/pages/admin/DashboardPage.jsx) (System Activity panel) | Fake events (report, ban, flag, spike, failure). **Replace with:** `GET /api/admin/dashboard/activity` |
| `sessions` | [AdminUsersPage.jsx](../../src/pages/admin/AdminUsersPage.jsx) (Active Sessions list) | Fake sessions (device, ip, location). **Replace with:** `GET /api/admin/users/:id/sessions` |

**Current state:** Dashboard and Users pages already use adapters (`useAdminDashboardSeries`, `useAdminActivity`, `useAdminUserSessions`) that call backend. Chart uses `seriesPoints` from `/api/admin/dashboard/series`; activity uses `activityEvents` from `/api/admin/activity`; sessions use `fetchAdminUserSessions` → `/api/admin/users/:id/sessions`. This audit defines the **stable contract** for the three data shapes so chart/activity/sessions are fully backend-driven (no fake constants).

---

## 2. Real Sources (already wired)

| Endpoint | Purpose |
|----------|---------|
| `GET /api/admin/dashboard` | Cards: onlineUsers, messagesPerSecond, latencyAvg, suspiciousFlags, adminsCount, regularUsersCount |
| `GET /api/admin/dashboard/series` | Chart points (ts, label, messagesPerSecondAvg, connectionsAvg). **Contract alternative:** `GET /api/admin/dashboard/timeseries` with shape below. |
| `GET /api/admin/dashboard/stats` | Extended stats: messagesPerSecondPeak, messagesPerSecondP95, latencyMaxMs, latencyAvgP95, suspiciousFlagsDeltaLastHour |
| `GET /api/admin/activity` | Activity events (type, title, detail, ts, severity). **Contract alternative:** `GET /api/admin/dashboard/activity` with shape below. |
| `GET /api/admin/users` | User directory + search/pagination |
| `GET /api/admin/users/:id/sessions` | Per-user sessions. Response must include `userId` and sessions with `id`, `device`, `ip`, `location`, `isCurrent`, `lastSeen`. |

---

## 3. Needed Endpoints (exact contract)

### 3.1 GET /api/admin/dashboard/timeseries

**Replaces:** chart dummy / or augments existing series.

**Query:** `windowSeconds=86400&bucketSeconds=3600` (defaults allowed).

**Response shape (stable):**
```json
{
  "success": true,
  "data": {
    "windowSeconds": 86400,
    "bucketSeconds": 3600,
    "points": [
      { "time": "<ISO string or epoch ms>", "messages": 0, "connections": 0 }
    ]
  }
}
```

**Rules:** points length bounded (maxBuckets = 96); time ISO or epoch ms; messages/connections integers ≥ 0. No WS dependency.

---

### 3.2 GET /api/admin/dashboard/activity

**Replaces:** activity feed dummy.

**Query:** `limit=25&windowSeconds=86400` (limit max 50).

**Response shape (stable):**
```json
{
  "success": true,
  "data": {
    "windowSeconds": 86400,
    "items": [
      { "id": "...", "type": "...", "title": "...", "detail": "...", "createdAt": "<ISO>" }
    ]
  }
}
```

**Rules:** items from real sources (audit log / server events) or empty array; createdAt ISO.

---

### 3.3 GET /api/admin/users/:id/sessions

**Replaces:** hardcoded sessions list.

**Query:** `limit=10` (limit max 20).

**Response shape (what UI needs):**
```json
{
  "success": true,
  "data": {
    "userId": "...",
    "sessions": [
      { "id": "...", "device": "...", "ip": "...", "location": null, "isCurrent": true, "lastSeen": "<ISO or ms>" }
    ]
  }
}
```

**Rules:** If no session store, return `sessions: []`. location can be null; device can be "Unknown".

---

## 4. Summary

- **Dummy sources:** trafficData (chart), activityFeed (activity panel), sessions (Active Sessions). Replace with the three endpoints above.
- **Real sources:** GET /api/admin/dashboard, GET /api/admin/users, and existing series/stats/activity/sessions endpoints.
- **What must be replaced:** Chart data → timeseries; Activity panel → dashboard/activity; Active Sessions → users/:id/sessions with response shape including userId and isCurrent/lastSeen.

---

## 5. Phase A7 — Goal A done checklist (implementation complete)

- [x] `rg -n "trafficData|activityFeed|sessions = \["` in admin pages finds **no** dummy constants (only comments/docs).
- [x] Admin dashboard cards still work (GET /api/admin/dashboard).
- [x] Admin users list still works (GET /api/admin/users).
- [x] Chart uses GET /api/admin/dashboard/timeseries (`useAdminDashboardTimeseries`).
- [x] Activity panel uses GET /api/admin/dashboard/activity (`useAdminDashboardActivity`).
- [x] Active Sessions use GET /api/admin/users/:id/sessions with normalized `current`/`lastSeen`.
- [x] No WebSocket dependency for Goal A.
