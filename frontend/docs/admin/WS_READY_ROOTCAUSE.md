# WS not ready / reconnect burst / admin 0 — root cause diagnosis

## Summary

The WebSocket never becomes "ready" (client never receives HELLO_ACK), so messages are queued with "Will send when connected," the client reconnects repeatedly (RECONNECT_BURST), and the admin dashboard shows 0 online users. The most likely cause is a **race**: the client sends HELLO in `onopen` immediately, and the server processes HELLO **before** `ws.context` is set in `setupConnection`. The recovery layer then treats the socket as a zombie (no context), closes it with code 4004, so HELLO_ACK is never sent. Fix direction: ensure `ws.context` is set **before** the message handler can process any message (e.g. run rehydration before attaching `ws.on('message')`), or exempt HELLO from zombie detection.

---

## Frontend: readiness and queue

**Readiness gate (what must happen for WS to become "ready"):**

| What | File | Line / function |
|------|------|------------------|
| `ready` set to `true` | `myfrontend/frontend/src/transport/wsClient.js` | ~126, in `onmessage` when `msg.type === "HELLO_ACK"` |
| `isReady()` | `myfrontend/frontend/src/transport/wsClient.js` | 371–372: `return ready && ws?.readyState === WebSocket.OPEN` |

The only path to "ready" is: **connection open → client sends HELLO → server sends HELLO_ACK → client receives HELLO_ACK**.

**Reconnect triggers (what causes reconnect loops):**

| What | File | Line / function |
|------|------|------------------|
| On close | `myfrontend/frontend/src/transport/wsClient.js` | 183–189: `ws.onclose` sets `ready = false`, `ws = null`, then calls `scheduleReconnect(wsPath)` unless `reconnectDisabled` |
| Schedule reconnect | `myfrontend/frontend/src/transport/wsClient.js` | 197–204: `scheduleReconnect(wsPath)` uses `setTimeout(..., backoffMs)` then `connect(wsPath)`; backoff caps at 30s |

Any close (e.g. 4004, 4005, 1008, or network/proxy) triggers reconnect; a burst is just repeated close → reconnect.

**Exact condition that causes "Message queued, will send when connected":**

| What | File | Line / function |
|------|------|------------------|
| Queue + toast | `myfrontend/frontend/src/features/chat/adapters/ChatAdapterContext.jsx` | 622–648: `sendOrQueueMessage`; when `sent` is false, push to `pendingOutboxRef.current` and show toast (646) |
| When send is skipped | `myfrontend/frontend/src/features/chat/adapters/ChatAdapterContext.jsx` | 612–621: `sendRoomMessageViaWs` returns `false` when `!wsClient.isReady()` (or allowMockChat) |
| DM path | Same file | 629–631: DM only sets `sent = wsClient.sendMessage(...)` when `wsClient.isReady()` |

So the queue condition is: **`!wsClient.isReady()`** — either no HELLO_ACK yet or socket not OPEN.

---

## Backend: upgrade and HELLO

**WS upgrade auth:**

| What | File | Line / function |
|------|------|------------------|
| Upgrade handler | `backend/websocket/connection/wsServer.js` | 322–434: `handleUpgrade` |
| Auth | Same | Cookie via `getCookie(cookieHeader, JWT_COOKIE_NAME)`, `tokenService.verifyAccess(token)`, then `authSessionStore.getSession(sessionId)`; if session missing/revoked or userId mismatch → 401 |
| On success | Same | `wss.handleUpgrade(..., (ws) => { ws.userId, ws.sessionId, connectionManager.register(userId, ws, sessionId); wss.emit('connection', ...) })` |

**HELLO / HELLO_ACK:**

| What | File | Line / function |
|------|------|------------------|
| HELLO handler | `backend/websocket/protocol/helloHandler.js` | 41–103: `handleHello(ws, payload, sendResponse, context)` |
| Session check | Same | `userId = connectionManager.getUserId(ws)`, `session = sessionStore.getSessionBySessionId(sessionId)`; if `!userId || !session` → ERROR "Session required" + **close 1008** |
| Version | Same | Version must be integer in `SUPPORTED_VERSIONS` ([1]); else ERROR + close 1008. On success: `return { type: 'HELLO_ACK', version }` |
| Rate limit | `backend/websocket/router.js` | 163: HELLO excluded from router-level rate limiting (`if (type !== MessageType.HELLO && userId)`) |

**What can drop the connection before HELLO_ACK:**

1. **Zombie detection (4004)**  
   - **File:** `backend/websocket/protocol/dispatcher.js` (47–51): at the start of `handleMessage`, `recovery.detectZombieSocket(ws)` runs.  
   - **File:** `backend/websocket/recovery/index.js` (27–31): if `!ws.context` or `!ws.context.capabilities`, returns true → `cleanupZombieSocket(ws)` → close 4004.  
   - Context is set in `backend/websocket/connection/wsServer.js` in `setupConnection` (174–195): **after** `ws.on('message')` is attached, then `recovery.rehydrateOnReconnect(ws, userId, userRole)` is called. So if HELLO is processed before rehydration runs, `ws.context` is missing → zombie → 4004.

2. **Rehydration failure (4005)**  
   - **File:** `backend/websocket/connection/wsServer.js` (195–204): if `!rehydrationSuccess`, server closes with 4005. Causes immediate close and reconnect loop; connection is removed on close so admin sees 0.

3. **Session / userId missing in HELLO (1008)**  
   - **File:** `backend/websocket/protocol/helloHandler.js` (61–67): if `!userId || !session`, send ERROR and close 1008. Can happen if `connectionManager.getUserId(ws)` or `sessionStore.getSessionBySessionId(sessionId)` are wrong (e.g. double-register with different sessionIds).

---

## Most likely failing step

**Primary hypothesis: HELLO is processed before `ws.context` is set (zombie path).**

- Client sends HELLO in `ws.onopen` (`myfrontend/frontend/src/transport/wsClient.js` 101–106) as soon as the WebSocket is open.
- Server attaches `ws.on('message')` in `setupConnection` then runs `rehydrateOnReconnect`. If HELLO is delivered and dispatched **before** rehydration runs (or in a race with it), `detectZombieSocket(ws)` sees `!ws.context` → cleanup with 4004 → no HELLO_ACK → client sees close and reconnects → repeat.
- This explains: "Message queued" (never ready), "reconnect burst" (repeated 4004 close), and "admin 0" (connection removed on close before it is counted as healthy).

**Secondary candidates:** Rehydration failing (4005) or HELLO rejected due to missing session (1008). Both also yield no HELLO_ACK and reconnect; check server logs for close codes 4005 or 1008 if the primary hypothesis is not confirmed.

---

## One log to prove it

**Where:** `backend/websocket/protocol/dispatcher.js`, function `handleMessage`, at the very start — before the existing `recovery.detectZombieSocket(ws)` call.

**What to do:** Parse the incoming `data` only enough to read `type` (e.g. `let type; try { const m = JSON.parse(Buffer.isBuffer(data) ? data.toString('utf8') : data); type = m && m.type; } catch { type = null; }`). Then, **only when `type === 'HELLO'`**, add one log:

```js
logger.info('ws', 'hello_received_context_check', { hasContext: !!ws.context, correlationId: context.correlationId });
```

**Interpretation:** If when the issue occurs you see `hasContext: false` for HELLO, the race is confirmed: HELLO was handled before `ws.context` was set, so zombie detection then closes the connection with 4004.

---

## WS-1 diagnostic (logs added to prove close code + race)

**Logs added (behavior unchanged):**

1. **`backend/websocket/protocol/dispatcher.js`** — At the top of `handleMessage`, before `detectZombieSocket(ws)`: safe JSON parse for `type`; when `type === 'HELLO'`, log `hello_received` with `hasContext`, `hasCaps`, `userId`, `sessionId`, `socketSession` (from `connectionStore.getSocketSession(ws)`).
2. **`backend/websocket/connection/wsServer.js`** — In `ws.on('close', ...)`: log `ws_closed` with `code`, `reason`, `userId`, `sessionId`, `hasContext`.

**How to reproduce:** Run backend and frontend, open `/chat` (logged in), watch backend logs for `hello_received` and `ws_closed`.

**Observed (ws-smoke run, successful handshake):**

- **Observed close code(s):** `1005` (No Status Received — client closed after HELLO_ACK; normal).
- **HELLO log:** `hasContext: true`, `hasCaps: true`. So in this run HELLO was processed after context was set (no zombie race).
- **socketSession vs ws.sessionId:** Mismatch: `socketSession` was `"bypass_<userId>"` while `ws.sessionId` was the real session ID (e.g. `04dade84-5dba-4571-8fa8-d95721abba65`). So `connectionStore` is keyed by the bypass id from the second `connectionManager.register(userId, ws)` call in `setupConnection`, while `ws.sessionId` remains the value set in the upgrade callback.

**To confirm the failing path:** When the issue occurs (browser /chat, messages queued, reconnect burst), check backend logs: if you see **`hello_received` with `hasContext: false`** then **`ws_closed` with `code: 4004`**, the zombie race is confirmed. If you see **`ws_closed` with `code: 4005`** (no or after HELLO), rehydration failed. If you see **`ws_closed` with `code: 1008`** after HELLO, HELLO rejected (session required).

---

## Browser WS fails because cookies are Path=/api, WS is /ws (0W-1)

**Evidence that the browser does not send auth cookies on the WebSocket request when they are scoped to Path=/api:**

### 1) Backend: cookie Path is `/api`

- **File:** `backend/http/controllers/auth.controller.js`
  - Line 49: `const COOKIE_PATH = '/api';`
  - Lines 106–110, 183–187, 295–299: All `cookieOptions` use `path: COOKIE_PATH` when setting `token` (JWT) and `refresh_token`.
- **File:** `backend/config/constants.js`
  - `JWT_COOKIE_NAME` default is `'token'`; `REFRESH_COOKIE_NAME` is `'refresh_token'`.

So the login response sets cookies with **Path=/api**. Per RFC 6265, the browser sends a cookie only when the request path matches the cookie’s Path. The WebSocket request is to **/ws**, which does not match Path=/api, so the browser does **not** send those cookies on the WS upgrade.

### 2) Browser (manual check)

- **Application → Cookies → localhost**  
  After login, confirm `token` and `refresh_token` have **Path** = `/api`.
- **Network → WS → select the `/ws` request → Headers**  
  In the **Request Headers**, the **Cookie** header will **not** include `token=…` (and typically no auth cookies at all for that request).

### 3) Backend dev log when upgrade is rejected (no token)

- **File:** `backend/websocket/connection/wsServer.js`  
  When the upgrade is rejected because no token is present, in dev the server logs:
  - `[ws-upgrade-reject]` with `requestUrl`, `cookieHeaderPresent`, and `cookieContainsJwt`.
- **Interpretation:** If you see `cookieHeaderPresent: false` or `cookieContainsJwt: false` for a request to `/ws`, that confirms the browser did not send the JWT cookie on the WS request — consistent with cookies being Path=/api while the request is to /ws.

### Stop condition / evidence

- Cookies in DevTools show **Path=/api** for `token` and `refresh_token`.
- The **/ws** WebSocket request’s Request Headers show **no** `token=` (or no Cookie header / no auth cookies).
- Optionally: backend dev log `[ws-upgrade-reject]` with `cookieContainsJwt: false` and `requestUrl` containing `/ws` further confirms the cookie path mismatch.
