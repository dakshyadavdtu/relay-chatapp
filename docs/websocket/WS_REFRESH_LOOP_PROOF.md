# WS-Connected Refresh Loop: Where Timers Are Created/Cleared

## Goal

Users with an active WebSocket (PING/PRESENCE_PING) should not be logged out due to access token expiry. The client runs a **single** refresh loop while WS is connected, using the same refresh (and dedupe) as the HTTP layer. We do **not** extend `refreshExpiresAt` on the backend for WS activity.

## Frontend WS Lifecycle (Reference)

| Location | What |
|----------|------|
| `wsClient.js` | `connect()` → new WebSocket, `setStatus("connecting")` |
| `wsClient.js` | `ws.onopen` → send HELLO |
| `wsClient.js` | `ws.onmessage` when `msg.type === "HELLO_ACK"` → `ready = true`, `setStatus("connected")`, `startPingKeepalive()` (PING every 30s), `emit(msg)` |
| `wsClient.js` | `clearPingTimer()` / `startPingKeepalive()` | PING timer (30s) |
| `ChatAdapterContext.jsx` | PRESENCE_PING interval (e.g. 60s) |
| `wsClient.js` | `ws.onclose` → `ready = false`, `ws = null`, `clearPingTimer()`, `setStatus("disconnected")` (then maybe `scheduleReconnect`) |

## Where the Refresh Loop Timer Is Created

**File:** `myfrontend/frontend/src/lib/http.js`

1. **Created:** `scheduleProactiveRefreshFromWs()`  
   - **When:** Called when the client receives **HELLO_ACK** (via `wsClient.subscribe({ handleMessage })` in http.js).  
   - **What:** `stopProactiveRefreshInterval()` (clear any existing loop), then  
     `proactiveRefreshTimerId = setTimeout(runWsRefreshLoop, PROACTIVE_REFRESH_INTERVAL_MS)`  
     (first run in 9 minutes).  
   - **Line (approx):** Where `scheduleProactiveRefreshFromWs` sets `proactiveRefreshTimerId = setTimeout(runWsRefreshLoop, ...)`.

2. **Rescheduled inside the loop:** `runWsRefreshLoop()`  
   - On **200:** `proactiveRefreshTimerId = setTimeout(runWsRefreshLoop, PROACTIVE_REFRESH_INTERVAL_MS)` (next run in 9 min).  
   - On **5xx or network:** `proactiveRefreshTimerId = setTimeout(runWsRefreshLoop, BACKOFF_AFTER_5XX_MS)` (next run in 2 min).  
   - On **401/403:** `handleSessionExpired(...)` and **no** reschedule (loop stops).

## Where the Refresh Loop Timer Is Cleared

**File:** `myfrontend/frontend/src/lib/http.js`

1. **Cleared on session expiry:** `handleSessionExpired()` calls `stopProactiveRefreshInterval()`.  
   - So: refresh returns 401/403 → handleSessionExpired → timer cleared, WS shutdown with `session_expired`.

2. **Cleared on WS close/reconnect:** `wsClient.subscribe({ onStatus })`; when `status === 'disconnected'`, `stopProactiveRefreshInterval()` is called.  
   - So: any close (normal, error, reconnect) leads to `setStatus("disconnected")` in wsClient and then the loop is cleared.  
   - On reconnect, HELLO_ACK runs again and `scheduleProactiveRefreshFromWs()` starts a **new** loop.

## Proof: Only One Refresh Loop Exists

- There is a single module-level timer: `proactiveRefreshTimerId` (one `setTimeout` at a time).  
- Before starting a new loop, `scheduleProactiveRefreshFromWs()` always calls `stopProactiveRefreshInterval()`, which clears `proactiveRefreshTimerId`.  
- So at most one “next run” is ever scheduled (either from the initial schedule or from `runWsRefreshLoop`).  
- When WS disconnects, `onStatus('disconnected')` clears that timer, so no loop runs without a connected WS.

## Proof: Refresh Calls Are Bounded (No Storms)

- **Success (200):** Next refresh is scheduled in **9 minutes** (PROACTIVE_REFRESH_INTERVAL_MS).  
- **Transient (5xx or network):** Next run is in **2 minutes** (BACKOFF_AFTER_5XX_MS); we do **not** logout.  
- **Permanent (401/403):** Loop stops; `handleSessionExpired` is called once and WS is shut down.  
- The same **doRefresh()** used by the HTTP 401 path is used here; it is single-flight (one in-flight refresh, others await). So concurrent triggers (e.g. loop + API 401) do not cause multiple refresh requests.

## Guardrails

- **Do not refresh if already refreshing:** Handled by `doRefresh()` (in-flight promise; concurrent callers await it).  
- **Backoff after 5xx / network:** Next run in 2 min; no logout.  
- **Only logout on 401/403 from refresh:** In `runWsRefreshLoop`, we only call `handleSessionExpired` when `result.status === 401 || result.status === 403`.

## Optional: Pause When Tab Inactive

Not implemented. To add later: in `runWsRefreshLoop`, when scheduling the next run, if `document.visibilityState === 'hidden'`, use a longer delay or skip rescheduling until the tab becomes visible again (e.g. via `document.addEventListener('visibilitychange', ...)`).

## devTokenMode

- `scheduleProactiveRefreshFromWs()` returns immediately if `isDevTokenMode()`; no timer is created.  
- `runWsRefreshLoop()` returns immediately if `isDevTokenMode()` or `!isCookieMode()`.  
- So behavior is unchanged in dev token mode (no WS refresh loop).
