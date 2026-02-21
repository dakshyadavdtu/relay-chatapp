# WebSocket handshake and failure modes (why Browser B may not show connection_established)

## 1. Client protocol: what is sent first and where token is attached

### Token attachment (auth at upgrade time)

- **Primary:** Cookie. The client uses **same-origin** URL (`ws://${window.location.host}/ws`). The browser automatically sends the `Cookie` header on the WebSocket HTTP upgrade request. Backend reads `JWT_COOKIE_NAME` (default `token`) from `request.headers.cookie`.
- **Optional (dev only):** If `DEV_TOKEN_MODE === 'true'` on the backend and the frontend is in dev token mode, `getWsUrl()` in `myfrontend/frontend/src/config/ws.js` appends `?accessToken=...` to the URL. Backend then reads token from `new URL(request.url).searchParams.get('accessToken')` when cookie is missing.
- **Not in first message:** Auth is done on the **HTTP upgrade** only. The first WebSocket **message** is HELLO; it does **not** carry the token. So: token = Cookie (or query in dev token mode); HELLO is only for protocol version.

### First message sent by client

- **Order:** After `new WebSocket(url)`, the client waits for `ws.onopen`. In `onopen` it sends **HELLO** first (and only then later RESUME, PRESENCE_PING, etc.).
- **Code:** `myfrontend/frontend/src/transport/wsClient.js` lines 161–176: `ws.onopen = () => { ... ws.send(JSON.stringify(HELLO)); }` with `HELLO = { type: "HELLO", version: 1 }`.
- So: **first message = HELLO**. RESUME is sent after HELLO_ACK; PRESENCE_PING is sent periodically after ready.

---

## 2. Backend WS auth path (wsServer.js)

### Where sessionId / userId are resolved

1. **Upgrade handler** `handleUpgrade` (wsServer.js ~349):
   - Parse `pathname` from `request.url`.
   - **Token:** From `request.headers.cookie` via `getCookie(cookieHeader, JWT_COOKIE_NAME)`; if none and `DEV_TOKEN_MODE === 'true'`, from `?accessToken=` in URL.
   - **JWT:** `tokenService.verifyAccess(token)` → payload.
   - **userId** = `payload.userId`, **sessionId** = `payload.sid`, **userRole** = `payload.role || 'USER'`.
   - **Session check:** `authSessionStore.getSession(sessionId)` → must exist and not revoked, and `session.userId === userId`; optional ban check via `userStore.isBanned(userId)`.
   - If all pass: `wss.handleUpgrade(request, socket, head, (ws) => { ... })`. In the callback: `ws.userId = userId`, `ws.sessionId = sessionId`, `connectionManager.register(userId, ws, sessionId)`, then `wss.emit('connection', ws, request, userId, session.role || userRole)`.

2. **Connection handler** (wss.on('connection')):
   - Receives `(ws, request, userId, userRole)` and calls `setupConnection(ws, request, userId, userRole)`.
   - **setupConnection** uses `sessionId = ws.sessionId` (set in upgrade callback), calls `connectionManager.register(userId, ws, sessionId)` again, runs `recovery.rehydrateOnReconnect(ws, userId, userRole)`, attaches `ws.on('message', ...)`, then logs **connection_established** and sends `CONNECTION_ESTABLISHED` to the client.

So: **userId/sessionId are resolved entirely during the upgrade** (before any WebSocket frame). HELLO is processed later and does not affect whether the connection is “registered” or “connection_established” is logged.

### What happens on auth failure

All auth failures happen in **handleUpgrade** (before the WebSocket is fully accepted). The backend calls **rejectUpgrade(socket, statusCode, message)**, which:
- Writes an HTTP response line: `HTTP/1.1 ${statusCode} ${message}` and `Connection: close`.
- Calls `socket.destroy()`.

So the connection is **not** upgraded; the client sees a failed upgrade (no WebSocket open). There is **no silent drop**: each failure path logs before calling `rejectUpgrade`. Summary:

| Condition | Log (component, event) | HTTP status | Close |
|-----------|------------------------|------------|--------|
| No token | `WebSocketServer` / `upgrade_rejected_no_token` | 401 | socket.destroy() |
| Invalid/expired token | `WebSocketServer` / `upgrade_rejected_invalid_token` | 401 | socket.destroy() |
| No userId in payload | `WebSocketServer` / `upgrade_rejected_no_user_id` | 401 | socket.destroy() |
| No sessionId (sid) in payload | `WebSocketServer` / `upgrade_rejected_no_sid` | 401 | socket.destroy() |
| Session missing/revoked | `WebSocketServer` / `upgrade_rejected_session` | 401 | socket.destroy() |
| Session userId mismatch | `WebSocketServer` / `upgrade_rejected_session` | 401 | socket.destroy() |
| User banned | `WebSocketServer` / `upgrade_rejected_banned` | 403 | socket.destroy() |
| Session lookup throws | `WebSocketServer` / `upgrade_session_lookup_error` | 503 | socket.destroy() |
| Server shutting down | `WebSocketServer` / `upgrade_rejected_shutdown` | 503 | socket.destroy() |
| Max connections reached | `WebSocketServer` / `upgrade_rejected_max_connections` | 503 | socket.destroy() |

After upgrade (inside setupConnection), two more failure paths exist; they close the socket with a WebSocket close (not HTTP):

- **setup_no_session:** `ws.sessionId` missing (should not happen if upgrade callback ran) → `logger.error('WebSocketServer', 'setup_no_session', { userId })`, `ws.close(1008, 'Session required')`.
- **Rehydration failure:** `recovery.rehydrateOnReconnect` returns false → `ws.close(4005, 'Context rehydration failed')` — no `connection_established` log.

---

## 3. Client-side suppression (why B might never appear in backend logs)

- **Token missing ⇒ don’t connect**  
  The client does **not** check for a token before calling `connect()`. It always calls `new WebSocket(url)`; the cookie is sent by the browser if same-origin.  
  **But:** `wsClient.connect()` is only invoked from `ChatAdapterContext.jsx` when:
  - `isAuthenticated === true`
  - `authLoading === false`
  - `import.meta.env.VITE_ENABLE_WS !== "false"`

  If Browser B never has a valid auth state (e.g. no cookie, or cookie not sent because B is on a different origin or incognito with no login), the effect may never call `wsClient.connect()`. Then **no upgrade request is sent from B** → no backend log at all (no upgrade_rejected, no connection_established).

- **WS errors ⇒ retry to wrong URL**  
  URL is built from `window.location` in `getWsUrl()`. Same tab always gets the same URL. Wrong URL would only happen if B loads the app from a different origin/port (e.g. file:// or another dev port). Then B could be sending the upgrade to the wrong host/port and we’d see no log on the expected backend.

- **WS open but never sends HELLO**  
  **connection_established** is logged in **setupConnection**, which runs right after the upgrade callback, **before** any client message is processed. So even if B never sends HELLO, the backend would still log **connection_established** for B once the upgrade and setupConnection succeed. So “B never sends HELLO” does **not** explain missing **connection_established**; it would only affect later protocol (e.g. no HELLO_ACK, client might get ERROR/close 1008 later).

---

## 4. Full sequence diagram

```
Frontend (Browser A/B)                    Backend (Node)
─────────────────────                    ───────────────

connect(wsPath="/ws")
  getWsUrl("/ws") → ws://origin/ws
  [Cookie sent by browser on same-origin]
  new WebSocket(url)
        │
        │  HTTP GET /ws + Upgrade
        │  Cookie: token=<jwt>
        ───────────────────────────────►  httpServer.on('upgrade')
                                           pathname === '/ws' ?
                                              │ no → socket.destroy()
                                              │      [debug: ws_upgrade_path_mismatch]
                                              │ yes
                                              ▼
                                           handleUpgrade(wss, request, socket, head)
                                             token = cookie or ?accessToken=
                                             if !token → rejectUpgrade(401), return
                                             payload = verifyAccess(token)
                                             if !payload → rejectUpgrade(401), return
                                             userId = payload.userId, sessionId = payload.sid
                                             if !userId → rejectUpgrade(401), return
                                             if !sessionId → rejectUpgrade(401), return
                                             authSessionStore.getSession(sessionId)
                                               if !session || revoked → rejectUpgrade(401), return
                                               if session.userId !== userId → rejectUpgrade(401), return
                                               [optional] if banned → rejectUpgrade(403), return
                                             wss.handleUpgrade(..., (ws) => {
                                               ws.userId, ws.sessionId = ...
                                               connectionManager.register(userId, ws, sessionId)
                                               wss.emit('connection', ws, request, userId, userRole)
                                             })
        │                                    │
        │  WebSocket upgrade accepted        ▼
        │◄────────────────────────────────  wss.on('connection') → setupConnection(ws, request, userId, userRole)
        │                                    sessionId = ws.sessionId
        │                                    if !sessionId → close(1008), return
        │                                    connectionManager.register(userId, ws, sessionId)
        │                                    rehydrateOnReconnect(ws, ...)
        │                                    if !ok → close(4005), return
        │                                    ws.on('message', ...)
        │                                    logger.info('WebSocketServer', 'connection_established', { userId, ... })
        │                                    safeSend(CONNECTION_ESTABLISHED)
        │
  ws.onopen
  ws.send(JSON.stringify(HELLO))
        │
        │  HELLO { type: "HELLO", version: 1 }
        ───────────────────────────────►  message handler → router → helloHandler
                                           HELLO_ACK (and set protocol version, etc.)
        ◄───────────────────────────────  HELLO_ACK
  setStatus("connected"), ready = true
  [later: RESUME, PRESENCE_PING, ...]
```

---

## 5. Exact failure modes where B never appears in logs

- **B never sends an upgrade request**
  - Effect never runs `connect()`: B not “authenticated” in app (`isAuthenticated` false), or `VITE_ENABLE_WS === "false"`, or `authLoading` never becomes false.
  - Or B never loads the chat route / adapter that subscribes and calls `connect()`.

- **B’s upgrade never reaches the backend**
  - B uses wrong origin/port (e.g. different Vite port or file://), so upgrade goes to another server or nowhere.
  - Proxy in front of the backend drops or misroutes B’s upgrade (e.g. only one connection per user at proxy).

- **B’s upgrade hits the wrong path**
  - If B’s URL path is not `/ws` (e.g. typo or different app build), `pathname === path` fails in `backend/websocket/index.js` → `socket.destroy()`. In production there is no warn/error, only debug `ws_upgrade_path_mismatch` in dev.

- **B’s upgrade is rejected (B will appear in logs as rejected)**
  - No cookie / no token → `upgrade_rejected_no_token`.
  - Invalid/expired token → `upgrade_rejected_invalid_token`.
  - No userId / no sid → `upgrade_rejected_no_user_id` / `upgrade_rejected_no_sid`.
  - Session revoked or mismatch → `upgrade_rejected_session`.
  - Banned → `upgrade_rejected_banned`.
  - Session lookup error → `upgrade_session_lookup_error`.
  - Shutdown / max connections → `upgrade_rejected_shutdown` / `upgrade_rejected_max_connections`.

- **B’s upgrade accepted but setupConnection fails before the log**
  - `setup_no_session` (ws.sessionId missing) → error log, close 1008.
  - Rehydration failure → close 4005, **no** `connection_established` log.
  - setupConnection throws → `setup_connection_error` log, close 1011.

So “B never appears in logs” is only plausible when:
1. B never calls `connect()` (auth/gate/enable/route), or  
2. B’s upgrade never reaches the backend (wrong host/port/proxy), or  
3. B’s upgrade is to the wrong path (path mismatch → socket.destroy(), no warn in prod).

---

## 6. Logs to grep in the terminal

Backend uses a structured logger: `[timestamp] [LEVEL] [component] event {data}`. Useful greps:

**Connection established (B should show here if upgrade and setup succeeded):**
```bash
grep "connection_established"   # or
grep "WebSocketServer.*connection_established"
```

**Auth / upgrade rejection (B might show here if upgrade reached backend but was rejected):**
```bash
grep "upgrade_rejected_no_token"
grep "upgrade_rejected_invalid_token"
grep "upgrade_rejected_no_user_id"
grep "upgrade_rejected_no_sid"
grep "upgrade_rejected_session"
grep "upgrade_rejected_banned"
grep "upgrade_session_lookup_error"
grep "upgrade_rejected_shutdown"
grep "upgrade_rejected_max_connections"
```

**Path mismatch (only in non-production; prod = silent destroy):**
```bash
grep "ws_upgrade_path_mismatch"
```

**After upgrade, before connection_established:**
```bash
grep "setup_no_session"
grep "setup_connection_error"
```

**Upgrade received (dev only, shows path and cookie presence):**
```bash
grep "ws_upgrade"
grep "ws_upgrade_token"
grep "ws_upgrade_resolved"
```

**Single combined grep (recommended):**
```bash
grep -E "connection_established|upgrade_rejected|setup_no_session|setup_connection_error|ws_upgrade_path_mismatch|ws_upgrade"
```

**Note:** This instrumentation was removed. Debug mode flags (WS_DEBUG_MODE, PresenceTrace, WS_CONN_TRACE, WS_CLIENT_TRACE) are no longer available. Use the grep above or normal server logs.

---

## 7. Connection verification (instrumentation removed)

This instrumentation was removed. Debug mode flags (WS_CONN_TRACE, WS_CLIENT_TRACE, etc.) are no longer available.

Use the grep in section 6 or normal server logs to verify connections per browser.

---

## 8. Summary table

| Topic | Detail |
|-------|--------|
| Client sends first | **HELLO** (in `onopen`). Token is **not** in first message. |
| Token attachment | **Cookie** (same-origin); or **?accessToken=** in dev if `DEV_TOKEN_MODE` and dev token mode frontend. |
| userId/sessionId resolved | In **handleUpgrade** from JWT payload and session store; before any WS message. |
| connection_established | Logged in **setupConnection** after register + rehydration, before HELLO is processed. |
| Auth failure | All in handleUpgrade: **rejectUpgrade(statusCode)** + log + socket.destroy(); no silent drop. |
| B not in logs | Likely: B never calls connect(), or B’s upgrade goes to wrong host/port/path (path mismatch silent in prod). |
| Grep | `connection_established`, `upgrade_rejected_*`, `setup_no_session`, `setup_connection_error`, `ws_upgrade*`. |
