# Live sessions filter (liveOnly=1) — implementation notes

## Config source for LIVE_WINDOW_MS

| Item | File | Symbol / default | Units |
|------|------|------------------|--------|
| Heartbeat interval | `config/constants.js` | `HEARTBEAT.interval` = `process.env.WS_HEARTBEAT_INTERVAL \|\| '30000'` | ms |
| Heartbeat timeout | `config/constants.js` | `HEARTBEAT.timeout` = `process.env.WS_HEARTBEAT_TIMEOUT \|\| '60000'` | ms |
| Validation | `config/env.validate.js` | `WS_HEARTBEAT_INTERVAL`, `WS_HEARTBEAT_TIMEOUT` in [1, 86400000] | ms |
| ConnectionManager | `websocket/connection/connectionManager.js` | `HEARTBEAT_INTERVAL_MS = 30000` (hardcoded) | ms |
| Heartbeat check | `websocket/connection/heartbeat.js` | Uses `config.HEARTBEAT.interval`, `config.HEARTBEAT.timeout` | ms |
| Session touch throttle | `auth/sessionStore.mongo.js` | `TOUCH_THROTTLE_MS` = `process.env.SESSION_TOUCH_THROTTLE_MS \|\| '60000'` | ms |

## Derived live window formula

- **liveWindowMs = HEARTBEAT.timeout** (from `config/constants.js`).
- Default: **60000 ms** (60 seconds). Same as the WS “connection considered dead” threshold.
- A session is **live** iff `(nowMs - lastSeenAtMs) <= liveWindowMs`.
- `lastSeenAt` is updated by:
  - **HTTP:** `http/middleware/requireAuth.js` → `sessionStore.touchSession(sessionId)` (throttled).
  - **WS upgrade:** `websocket/connection/wsServer.js` (on upgrade) → `authSessionStore.touchSession(sessionId)`.
  - **WS heartbeat (Phase 4):** `websocket/connection/heartbeat.js` → on each pong, `authSessionStore.touchSession(ws.sessionId)` (store-throttled). Keeps idle tabs live.

## Endpoints

- **GET /api/sessions/active** — `sessions.controller.js:getActiveSessions`. When `liveOnly=1`, filters `list` with `isLiveSession(s.lastSeenAt, now, liveWindowMs)` before mapping. Response shape unchanged.
- **GET /api/admin/users/:id/sessions** — `admin.controller.js:getUserSessions`. When `liveOnly=1`, uses `activeOnly: true` and filters by `isLiveSession`; limit applied after filter.

## Manual test plan

1. Create 3 sessions (e.g. log in from 3 browsers/tabs or after logout/login).
2. Optionally set one session’s `lastSeenAt` to very old in DB (or wait > liveWindowMs without touching that session).
3. **Without liveOnly:** `GET /api/sessions/active` → expect N sessions (e.g. 3).
4. **With liveOnly:** `GET /api/sessions/active?liveOnly=1` → expect only sessions with recent `lastSeenAt` (e.g. 1 if only current tab is active).
5. Admin: `GET /api/admin/users/:id/sessions?liveOnly=1` → only live, non-revoked sessions; limit applied after filter.
