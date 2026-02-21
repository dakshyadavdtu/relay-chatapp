# Session-Expired WebSocket Close — Root Cause Proof

**Evidence:** Logs show steady PING/PRESENCE_PING traffic, then server logs the close with `reason:"session_expired"` and `closeCode:1000`, followed by presence offline. (WS_CONN_TRACE instrumentation was removed; use normal server logs.)

---

## A) Close trigger location

**The server does not decide or send `"session_expired"`.** The **client** closes the WebSocket with that reason. The server only logs the close in its `close` handler.

| Role   | File | Line | Condition / Behavior |
|--------|------|------|----------------------|
| **Client (trigger)** | `myfrontend/frontend/src/lib/http.js` | 46 | Inside `handleSessionExpired(context)`: `wsClient.shutdown('session_expired')`. |
| **Client (close)**  | `myfrontend/frontend/src/transport/wsClient.js` | 479–481 | `shutdown(reason)` sets `closeReason = reason || 'logout'`; then `ws.close(1000, closeReason)` → **1000, "session_expired"**. |
| **Server (log only)** | `backend/websocket/connection/connectionManager.js` | 197–199 | Server logs the close with `closeCode` and `reason` (whatever the **client** sent). (WS_CONN_TRACE instrumentation was removed.) |

**Exact condition that triggers `handleSessionExpired` (and thus `session_expired` close):**

1. **Path 1 (no refresh attempted):**  
   HTTP response `res.status === 401` and **one of**: `pathNorm === REFRESH_PATH`, `pathNorm` is login/register/forgot/reset, `__retried === true`, or `devTokenMode` is true  
   → `http.js` lines 162–172: `handleSessionExpired(logoutContext)` then throw.

2. **Path 2 (refresh attempted and failed):**  
   HTTP response `res.status === 401` → client calls `POST /api/auth/refresh` → `refreshRes.status === 401 || refreshRes.status === 403`  
   → `http.js` lines 200–211: `handleSessionExpired(logoutContext)` then throw.

So the close is always **client-initiated** after an HTTP 401 and (when applicable) a failed refresh. Typical sequence: some HTTP request (e.g. GET `/api/me` or another protected call) returns 401 → client may try refresh → if refresh not attempted or refresh returns 401/403 → `handleSessionExpired()` → `wsClient.shutdown('session_expired')` → client sends `close(1000, 'session_expired')` → server logs the close with that reason.

---

## B) Session expiry source (what is compared at “session invalid” time)

The value that leads to 401 and then to `session_expired` is checked **on HTTP**, not on WebSocket message handling.

| Source | Where checked | File:line | What is compared |
|--------|----------------|-----------|-------------------|
| **Access JWT exp** | Auth middleware (JWT verify) then requireAuth | `backend/utils/jwt.js` 88–91 | `payload.exp && Date.now() >= payload.exp * 1000` → `verifyJwt` returns `null` → 401. |
| **Session revoked** | requireAuth after session lookup | `backend/http/middleware/requireAuth.js` 38–44 | `!session \|\| session.revokedAt` → 401. |
| **Refresh token expiry** | Refresh handler when validating refresh cookie | `backend/auth/sessionStore.mongo.js` 133–134 | `Date.now() > session.refreshExpiresAt` inside `verifyRefreshHash()` → refresh returns 401. |

**WS upgrade:** Token is verified once at upgrade in `backend/websocket/connection/wsServer.js` (tokenService.verifyAccess, then authSessionStore.getSession for existence + !revokedAt). There is **no** re-check of JWT exp or refreshExpiresAt on subsequent WS messages (e.g. PING/PRESENCE_PING). So at WS message time the server does **not** evaluate any expiry; the “session_expired” close comes from the client after an HTTP 401 path.

**Summary:** The expiry that matters for `session_expired` is: **token exp** (JWT) and/or **session.revokedAt** and/or **session.refreshExpiresAt**, all evaluated on **HTTP** (auth middleware, requireAuth, refresh handler). No token exp or refreshExpiresAt is checked on WS message handling.

---

## C) Is expiry extended on WS ping?

**Only `lastSeenAt` is extended on WS activity; token/refresh expiry is not.**

| Updated on WS? | Proof |
|----------------|--------|
| **lastSeenAt** | **Yes.** On each **pong** (heartbeat response): `backend/websocket/connection/heartbeat.js` 54–56: `if (ws.sessionId) { authSessionStore.touchSession(ws.sessionId).catch(() => {}); }`. And at upgrade only: `backend/websocket/connection/wsServer.js` 510: `authSessionStore.touchSession(sessionId).catch(() => {});`. |
| **refreshExpiresAt** | **No.** `touchSession` only does `$set: { lastSeenAt: now }` — `backend/auth/sessionStore.mongo.js` 101–104. |
| **Access JWT** | **No.** No token refresh or re-issue on WS; WS does not call refresh or touch any token expiry. |

So for the purpose of “session_expired” (driven by HTTP 401 / refresh failure): **No** — **expiry is not extended on WS ping/pong.** Only `lastSeenAt` is updated (for liveness/filtering), not the values that cause 401 (JWT exp, refreshExpiresAt).

---

## D) Is expiry extended on HTTP?

**Yes** — both lastSeenAt and the effective “session” validity used for 401/refresh are extended or renewed on HTTP.

| Mechanism | Proof |
|-----------|--------|
| **lastSeenAt** | `backend/http/middleware/requireAuth.js` 47: after session lookup and revoke check, `sessionStore.touchSession(sessionId).catch(() => {});` (throttled in store, e.g. 60s). |
| **Refresh token expiry** | On successful `POST /api/auth/refresh`, `backend/http/controllers/auth.controller.js` calls `sessionStore.rotateRefreshHash(sessionId, hash, newRefreshHash, newExpiresAt)` and sets new cookies with new expiry — so **refreshExpiresAt** is effectively extended. |
| **Access token** | New access JWT is issued on successful refresh (same controller); so access token “expiry” is extended by getting a new token. |

So **expiry is extended on HTTP** (touchSession for lastSeenAt; refresh rotation for refreshExpiresAt and new access token).

---

## Summary table

| Question | Answer | Code proof |
|----------|--------|------------|
| **Who closes with "session_expired"?** | Client | `myfrontend/frontend/src/lib/http.js:46` → `wsClient.shutdown('session_expired')`; `wsClient.js:481` → `ws.close(1000, closeReason)`. |
| **Where is that close logged?** | Server close handler | `backend/websocket/connection/connectionManager.js:199` — logs `reason` and `closeCode` from client. |
| **What expiry is checked for 401?** | JWT exp, session.revokedAt, session.refreshExpiresAt | `backend/utils/jwt.js:89`; `requireAuth.js:38-44`; `sessionStore.mongo.js:134` (in verifyRefreshHash). |
| **Is expiry extended on WS ping?** | **No** (for token/refresh); only lastSeenAt | `heartbeat.js:55-56` calls `touchSession`; `sessionStore.mongo.js:102-104` only sets `lastSeenAt`. |
| **Is expiry extended on HTTP?** | **Yes** | `requireAuth.js:47` touchSession; refresh handler rotates refresh and issues new access token. |

---

## Root cause (why WS drops with “session_expired” despite PING/PRESENCE_PING)

1. Access JWT has a short TTL (e.g. 15 min from `ACCESS_TOKEN_EXPIRES_IN_SECONDS`).
2. WS auth is done only at **upgrade**; the server does not re-validate JWT or refresh token on PING/PRESENCE_PING.
3. **Nothing on WS extends access or refresh token expiry**; only `lastSeenAt` is updated on pong.
4. When any **HTTP** request runs (e.g. GET `/api/me`, or another protected call) after the access token has expired, the server returns 401.
5. Client tries refresh; if refresh fails (e.g. refresh token expired, or session revoked, or cookie missing), client calls `handleSessionExpired()` → `wsClient.shutdown('session_expired')` → client closes WS with code 1000, reason `"session_expired"`.
6. Server sees the close and logs it with reason "session_expired" and closeCode 1000; presence then goes offline.

So the disconnect is **not** caused by the server closing the WS due to expiry; it is caused by the **client** closing the WS after an HTTP 401 + failed refresh. To reduce “session_expired” closes while the user is active on WS only, you would need either to extend token/refresh validity on WS activity (e.g. call refresh or touch a sliding refresh expiry from WS path) or to have the client proactively refresh the access token before it expires (e.g. on a timer or before critical HTTP calls), without requiring an HTTP 401 first.
