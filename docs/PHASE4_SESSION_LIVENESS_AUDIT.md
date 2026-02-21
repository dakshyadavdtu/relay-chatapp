# Phase 4 — Session liveness correctness audit

## Goal

Ensure `liveOnly` filtering reflects reality: sessions with an open tab stay "live" and are not randomly hidden. This depends entirely on `lastSeenAt` accuracy.

---

## Step 1 — Touch paths (verified)

### A) HTTP path

**File:** `backend/http/middleware/requireAuth.js`

- **Confirmed:** For every authenticated request, after session lookup and revoke check, `sessionStore.touchSession(sessionId)` is called (line 48). Fire-and-forget: `.catch(() => {})`.
- **Throttle:** Not in middleware; throttle is **inside** `sessionStore.mongo.js`:
  - `touchSession()` reads `session.lastSeenAt`; if `(now - lastSeenAt) < TOUCH_THROTTLE_MS` it returns without writing (lines 94–98).
  - `TOUCH_THROTTLE_MS` = `process.env.SESSION_TOUCH_THROTTLE_MS || '60000'` (60s default).

**Conclusion:** HTTP path touches session on every authenticated request; DB write at most once per 60s per session.

### B) WebSocket path (before fix)

**File:** `backend/websocket/connection/wsServer.js`

- **Confirmed:** `authSessionStore.touchSession(sessionId)` is called **once** in `handleUpgrade`, inside the upgrade callback after session validation (line 475), when the WebSocket is established. No touch on heartbeat/pong.

**Conclusion:** WS path only updated `lastSeenAt` at connection time. An **idle tab** (no HTTP requests, only WS connected) would never get another touch, so after `LIVE_WINDOW_MS` (60s) the session would drop out of the live list even though the tab is still open.

---

## Step 2 — Heartbeat behavior

**File:** `backend/websocket/connection/heartbeat.js`

- **Interval:** `HEARTBEAT_INTERVAL` = `config.HEARTBEAT.interval` → **30000 ms** (30s). From `config/constants.js`: `WS_HEARTBEAT_INTERVAL || '30000'`.
- **Timeout:** `HEARTBEAT_TIMEOUT` = `config.HEARTBEAT.timeout` → **60000 ms** (60s). Used in config/logging; actual “dead” detection is: each interval the server sets `alive = false`, pings; next interval if still not alive (no pong), connection is terminated. So connection is considered dead after **one missed pong** (~30s without response).
- **Critical finding:** Heartbeat runs every 30s and marks connections alive on pong, but it did **not** call `touchSession`. So an idle tab’s `lastSeenAt` was only set at upgrade; after 60s the session would no longer be “live” in the API even though the WS was still connected.

---

## Step 3 — Fix applied

**File:** `backend/websocket/connection/heartbeat.js`

- **Change:** On each **pong**, call `authSessionStore.touchSession(ws.sessionId)` when `ws.sessionId` is set.
- **Throttle:** No new throttle in heartbeat. The **store** already throttles: `sessionStore.mongo.js` `touchSession()` skips the DB write if `(now - lastSeenAt) < TOUCH_THROTTLE_MS` (60s). So we effectively touch at most once per 60s per session, which is at most once per two heartbeat intervals (30s × 2).
- **Rules satisfied:** Touch only when client proves liveness (pong); reuse existing store throttle; no DB write on every ping.

**Code:** In `initConnection(ws)`, in the `ws.on('pong', ...)` handler, after `markAlive(ws, true)`, add:

```js
if (ws.sessionId) {
  authSessionStore.touchSession(ws.sessionId).catch(() => {});
}
```

Require `authSessionStore` at top of heartbeat.js (same store as wsServer: `require('../../auth/sessionStore')`).

---

## Step 4 — Validation

**Test:**

1. Open one tab, log in, leave it idle (no clicks/navigation) for > 60s.
2. Refresh the Settings → Devices page (or call `GET /api/sessions/active?liveOnly=1`).

**Expected (after fix):** The session still appears as live (one device).

**If it disappears:** Touch path is still insufficient (e.g. throttle too aggressive, or touch not invoked on pong).

---

## Config reference

| Source | Symbol | Default | Units |
|--------|--------|---------|--------|
| `config/constants.js` | `HEARTBEAT.interval` | 30000 | ms |
| `config/constants.js` | `HEARTBEAT.timeout` | 60000 | ms |
| `auth/sessionStore.mongo.js` | `TOUCH_THROTTLE_MS` | 60000 | ms |
| `utils/sessionLive.js` | `liveWindowMs` (from config) | `HEARTBEAT.timeout` | ms |
