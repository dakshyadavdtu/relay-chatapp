# Phase 2 — Auth & Session Audit (read-only)

This document maps current auth and "session" behavior so Phase 2 is not built on wrong assumptions. **No code was changed.**

---

## 1. Truth table

| Concept | Current reality | Notes |
|--------|------------------|--------|
| **Login** | POST `/api/login` → JWT created, HTTP-only cookie set | `backend/http/controllers/auth.controller.js` (login) |
| **JWT issuance** | Cookie only (no Bearer header). Cookie name: `token` (config: `JWT_COOKIE_NAME`) | `backend/config/constants.js` line 27; auth.controller lines 75–85 |
| **JWT TTL** | `JWT_EXPIRES_IN_SECONDS` env, default **604800** (7 days) | `auth.controller.js` line 44; `utils/jwt.js` signJwt default 7 days |
| **Refresh** | **Does not exist.** No refresh endpoint; no refresh token. Single long-lived JWT. | — |
| **sessionStore (backend)** | **WS-only.** In-memory map: one entry per `userId` with `{ socket, online, protocolVersion, lastSeenMessageId, ... }`. Not device sessions; not token list. | `backend/websocket/state/sessionStore.js` |
| **Revoke sessions** | **Disconnect WS only.** Closes user’s WebSocket(s); does **not** invalidate JWT. User can reconnect with same cookie. | `admin.controller.js` revokeSessions → `connectionManager.remove(userId)` |
| **GET /admin/users/:id/sessions** | **Fake “sessions”.** Returns **active WS connections** for that user (from connectionManager + sessionStore). One row per connection; no real device/session DB. | `admin.controller.js` getUserSessions (connectionManager.getConnections, sessionStore.getSession) |
| **GET /sessions/active** (user’s own) | **Stub.** Returns a single fake session; TODO says “Replace with actual session tracking”. | `backend/http/controllers/sessions.controller.js` getActiveSessions |

---

## 2. HTTP Auth — Endpoints & cookie/token

| Endpoint | Method | Auth | Purpose | File:line |
|----------|--------|------|---------|-----------|
| `/api/login` | POST | None | Validate credentials; create JWT; set HTTP-only cookie | `http/routes/auth.routes.js` 23; `http/controllers/auth.controller.js` 52–101 |
| `/api/register` | POST | None | Register; create JWT; set cookie | `auth.routes.js` 20; `auth.controller.js` 180–227 |
| `/api/logout` | POST | — | Clear cookie only (no server-side token invalidation) | `auth.routes.js` 26; `auth.controller.js` 108–125 |
| `/api/me` | GET | Cookie (requireAuth) | Return current user; **single source of truth** for frontend auth state | `auth.routes.js` 29; `auth.controller.js` 133–171 |
| `/api/sessions/active` | GET | requireAuth | **Stub:** returns one fake session | `http/routes/sessions.routes.js` 21; `sessions.controller.js` 15–34 |
| `/api/sessions/logout` | POST | requireAuth | Delegates to auth.controller.logout (clear cookie) | `sessions.routes.js` 24; `sessions.controller.js` 40–43 |

**Cookie / token details**

- **Cookie name:** `config.JWT_COOKIE_NAME` → default `'token'` (`backend/config/constants.js` line 27).
- **Where set:** `auth.controller.js` — `res.cookie(JWT_COOKIE_NAME, token, cookieOptions)` (lines 85, 213). Options: `httpOnly: true`, `secure` in prod, `sameSite`, `maxAge: JWT_EXPIRES_IN_SECONDS * 1000`.
- **Where read (HTTP):** `auth.middleware.js` — `getCookie(cookieHeader, JWT_COOKIE_NAME)` then `verifyJwt(token)` (lines 69–80). Attaches `req.user = { userId, ...payload }`.
- **JWT creation:** Only in `auth.controller.js` (login, register) and `dev.controller.js` (GET `/api/dev/session`). Signing: `utils/jwt.js` `signJwt(payload, expiresInSeconds)`.

**Refresh**

- No refresh endpoint. No refresh token. Frontend uses same JWT until expiry or logout.

---

## 3. WebSocket auth & HELLO

| Step | Where | What happens | File:line |
|------|--------|----------------|-----------|
| Upgrade reads auth | `handleUpgrade` | Cookie: `getCookie(request.headers.cookie, JWT_COOKIE_NAME)`. Or **dev bypass:** `?dev_user=` in URL when `ALLOW_BYPASS_AUTH=true` and `NODE_ENV !== 'production'`. | `backend/websocket/connection/wsServer.js` 366–387 (bypass), 389–421 (cookie + verifyJwt) |
| userId/role on ws | After upgrade | Bypass: `connectionStore.setSocketUser(ws, bypassUserId)`, `ws.userId = bypassUserId`. Cookie: `restoreSessionFromToken(ws, token)` sets socket user; then `connectionManager.register(boundUserId, ws)` creates/attaches **session** and sets socket user again. | `wsServer.js` 379–385 (bypass), 428–435 (cookie); `connectionManager.js` 90–115 (register → sessionStore.createSession/attachSocket, connectionStore.setSocketUser) |
| Session creation | On register | `sessionStore.createSession(userId, socket)` or `sessionStore.attachSocket(userId, socket)` (reconnect). Session = in-memory per userId (socket, protocolVersion, lastSeenMessageId, …). | `websocket/state/sessionStore.js`; `connectionManager.js` 111–114 |
| HELLO/HELLO_ACK gate | helloHandler | **Requires:** `userId` from socket and `sessionStore.getSession(userId)` exists. If no userId or no session → ERROR + close 1008. Session is created in upgrade callback **before** first message, so HELLO always sees session. | `backend/websocket/protocol/helloHandler.js` 39–61 (handleHello: getUserId(ws), getSession(userId); reject if !userId \|\| !session) |

So: **WS “session” = one in-memory record per userId (current socket + protocol state).** Not “device sessions” or “issued tokens.”

---

## 4. Admin: sessions & revoke

| Endpoint | Method | Meaning today | File:line |
|----------|--------|----------------|-----------|
| GET `/api/admin/users/:id/sessions` | GET | Returns **active WebSocket connections** for that user. Builds list from `connectionManager.getConnections(userId)` and `sessionStore.getSession(userId)` (for lastSeen). One item per connection; `id` is synthetic (`sess_${userId}_${i}`). **Not** a list of real device sessions or tokens. | `admin.routes.js` 30; `admin.controller.js` 309–349 |
| POST `/api/admin/users/:id/revoke-sessions` | POST | **Disconnect WS only.** Calls `connectionManager.remove(targetId)`: closes the user’s socket(s) and runs cleanup. **Does not** invalidate JWT or any token. User can reconnect with same cookie. | `admin.routes.js` 44; `admin.controller.js` 669–692; `connectionManager.js` 247–257 (remove) |

---

## 5. Frontend (auth surface)

| Item | Behavior | File:line |
|------|----------|-----------|
| API calls | `apiFetch(path, options)` — always `credentials: 'include'` (sends cookie). If `ALLOW_BYPASS_AUTH`, adds header `x-dev-user: dev_admin`. | `myfrontend/frontend/src/lib/http.js` 38–55 |
| 401 handling | On 401: `setAuthState({ user: null, ... })`, `wsClient.disconnect()`, redirect to `/login` if not on public path. | `http.js` 13–24, 76–81 |
| Login path | Frontend posts to `/api/login`; backend sets cookie; frontend must call GET `/api/me` to confirm and get user (Phase 6B contract). | — |

---

## 6. What is “fake” vs “real” (for Phase 2)

- **Fake WS “sessions” / current “sessionStore”:**  
  In-memory, one record per userId: current socket + protocol state. No persistence, no device id, no list of issued tokens. **Not** real device sessions.

- **Revoke-sessions today:**  
  Disconnects WebSocket only. No token invalidation, no blacklist. Same JWT remains valid until expiry or explicit logout.

- **GET /admin/users/:id/sessions:**  
  Lists **current WS connections** for that user, not “sessions” in a device/token sense.

- **GET /sessions/active (user’s own):**  
  Stub; returns one fake session. No real session store behind it.

- **Real device sessions (Phase 2):**  
  Would require: a store of issued tokens or session records (e.g. per device), refresh or re-issue semantics, and revoke that invalidates tokens or session records, not just closing the socket.

---

## 7. Files/functions that would need to change for Phase 2

(Reference only; no code changes in this audit.)

| Area | File | Functions / notes |
|------|------|-------------------|
| Login / token lifecycle | `backend/http/controllers/auth.controller.js` | login, register, logout — if adding refresh or session records |
| Session store | New or replace | Replace in-memory WS-only “sessionStore” with real session/device store (e.g. DB or token store) |
| JWT / tokens | `backend/utils/jwt.js` | signJwt used by auth + dev; any refresh or token version would touch here |
| Revoke | `backend/http/controllers/admin.controller.js` | revokeSessions — today only calls connectionManager.remove; would need to invalidate tokens/sessions and optionally still disconnect WS |
| Admin sessions list | `backend/http/controllers/admin.controller.js` | getUserSessions — would need to read from real session/device store instead of connectionManager + sessionStore |
| User’s own sessions | `backend/http/controllers/sessions.controller.js` | getActiveSessions — replace stub with real session list |
| WS upgrade | `backend/websocket/connection/wsServer.js` | handleUpgrade — if tokens are invalidated, verifyJwt still passes until expiry; may need token blacklist or session-id check |
| Frontend | `myfrontend/frontend/src/lib/http.js` | 401 handling and optional refresh flow if backend adds refresh |

---

*End of audit. No code was modified.*
