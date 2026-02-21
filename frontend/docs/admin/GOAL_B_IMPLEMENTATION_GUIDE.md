# Goal B Implementation Guide

**0. Overview**

This guide is written so a new developer can implement B1–B4 without guessing. It provides exact WebSocket message types and fields, exact admin HTTP endpoints (path, method, body, response), a ranked root-cause list for “WebSocket not ready” with detection steps, STOP CONDITIONS for each of B1–B4, and file:line references for all major claims. All line numbers refer to this repo as of the last doc update.

---

## 1. B1 — WebSocket "NOT READY" Deep-Dive

**Goal:** Fix root cause of "WebSocket not ready" so that HELLO → HELLO_ACK → `wsClient.ready === true` → `isReady()` true → ChatWindow stops showing "WebSocket not ready" toasts.

### B1 root causes (ranked, with detection steps)

| Rank | Cause | Detection steps | Expected evidence |
|------|--------|------------------|-------------------|
| **1** | **Port/proxy mismatch** — Backend not reachable at the port Vite proxies to | 1) Check backend `PORT` (e.g. `.env`). 2) Check frontend `VITE_BACKEND_PORT` (default 8000 in Vite). 3) DevTools → Network → WS: confirm request goes to correct host/port. | WS 101 to wrong host or no HELLO_ACK in Frames; frontend never logs "READY TRUE via HELLO_ACK". **Code:** `backend/config/constants.js` line 16 (PORT); `myfrontend/frontend/vite.config.js` lines 7–9, 18–32 (proxy target). |
| **2** | **Auth not resolved on upgrade** — Backend rejects upgrade or does not set userId | 1) Backend logs: look for upgrade event and userId resolution. 2) Cookie path: same-origin WS so cookie is sent; cookie name from backend. 3) Bypass path: both frontend and backend bypass flags set; URL has `?dev_user=`. | Backend logs show no `ws_upgrade_resolved` or `ws_upgrade_bypass`; or 401 on upgrade. **Code:** `backend/config/constants.js` line 22 (JWT_COOKIE_NAME); `backend/websocket/connection/wsServer.js` lines 365–385 (bypass), 387+ (cookie); `myfrontend/frontend/src/transport/wsClient.js` lines 25–26 (getWsUrl dev_user); `myfrontend/frontend/src/lib/http.js` lines 47–48 (x-dev-user). |
| **3** | **Session missing at HELLO time** — Session created after HELLO is processed | 1) Backend logs: `b1_hello` / `ws_hello` with `sessionExists: false`. 2) WS Frames: HELLO sent, then ERROR "Session required" and close 1008. | Logs: `userIdPresent: true`, `sessionExists: false`. **Code:** `backend/websocket/protocol/helloHandler.js` lines 41–47, 55–59 (if !userId \|\| !session → ERROR + close 1008). Session must exist before message handler runs: `backend/websocket/connection/wsServer.js` line 173 — `connectionManager.register(userId, ws)` in `setupConnection` (line 163) before rehydration. |

### B1 code facts (file:line)

- **Frontend connect gate:** `myfrontend/frontend/src/features/chat/adapters/ChatAdapterContext.jsx` lines 150–155: `allowMockChat()` return; `!isAuthenticated` return; else `wsClient.connect()`.
- **HELLO on open:** `myfrontend/frontend/src/transport/wsClient.js` lines 101–111: `onopen` sends `HELLO` (line 106).
- **ready set on HELLO_ACK:** `myfrontend/frontend/src/transport/wsClient.js` lines 123–128: `msg.type === "HELLO_ACK"` → `ready = true`, `setStatus("connected")`.
- **isReady():** `myfrontend/frontend/src/transport/wsClient.js` lines 365–366.
- **getWsUrl:** `myfrontend/frontend/src/transport/wsClient.js` lines 24–32; appends `?dev_user=dev_admin` when `ALLOW_BYPASS_AUTH` (`myfrontend/frontend/src/config/flags.js` line 9).
- **Backend path / upgrade:** `backend/websocket/index.js` lines 56, 62–66: `path = '/ws'`; upgrade only if `pathname === path`.
- **HELLO_ACK returned:** `backend/websocket/protocol/helloHandler.js` line 92: `return { type: 'HELLO_ACK', version };`.
- **Session check at HELLO:** `backend/websocket/protocol/helloHandler.js` lines 39–59: `getUserId(ws)`, `sessionStore.getSession(userId)`; if `!userId || !session` → ERROR + close 1008.

### B1 checklist (port → auth → session)

1. **B1.1** — Proxy/port: backend PORT matches VITE_BACKEND_PORT; WS Frames show HELLO then HELLO_ACK (or upgrade never reaches backend).
2. **B1.2** — Auth: backend logs show userId resolved on upgrade (token or bypass); no 401 on upgrade.
3. **B1.3** — Session: backend logs show session exists at HELLO time; no ERROR + close 1008 "Not authenticated" from helloHandler.

### B1 handshake logging (DEV-only)

- **Frontend:** `myfrontend/frontend/src/transport/wsClient.js` — handshake logs gated by `import.meta.env.DEV` (e.g. lines 92, 104, 118, 126).
- **Backend:** `backend/websocket/connection/wsServer.js` — upgrade/close logs `logger.debug`, `NODE_ENV !== 'production'`. `backend/websocket/protocol/helloHandler.js` — HELLO/decision logs `logger.debug` (lines 44–50, 56, 61, etc.). Set `WS_LOG_LEVEL=debug` in dev to see them.

---

## 2. B2 — Message-send pipeline

**Goal:** Message send works end-to-end: ChatWindow → correct WS type and fields → server accepts/validates → ACK or receive → UI updates. No invented types; all from backend protocol.

### Send entrypoints (file:line)

- **ChatWindow gates:** `myfrontend/frontend/src/features/chat/ui/ChatWindow.jsx` lines 166–168 (`!isWsReady` → toast "WebSocket not ready"), 161–164 (MAX_CONTENT_LENGTH trim/toast). Lines 189, 197, 206: `sendRoomMessageViaWs` / `sendMessageViaWs`.
- **ChatAdapterContext:** `myfrontend/frontend/src/features/chat/adapters/ChatAdapterContext.jsx` lines 590–597 (`sendRoomMessageViaWs`), 903 (`sendMessageViaWs: wsClient.sendMessage.bind(wsClient)`).
- **wsClient send:** `myfrontend/frontend/src/transport/wsClient.js` lines 216–227 (`send()`), 230–238 (`sendMessage`), 346–354 (`sendRoomMessage`). All require `ws`, `ws.readyState === OPEN`, `ready` (HELLO_ACK received).

### B2 parity (no guessing)

- **MESSAGE_SEND:** Frontend sends `recipientId`, `content`, `clientMessageId` (optional). Backend validates in `backend/websocket/protocol/wsSchemas.js` lines 19–24; router `backend/websocket/router.js` line 273 → `sendMessage.handleMessageSend` (`backend/websocket/handlers/sendMessage.js`). Returns MESSAGE_ACK or MESSAGE_ERROR.
- **ROOM_MESSAGE:** Frontend sends `roomId`, `content`, `clientMessageId?`, `messageType?`. Backend `wsSchemas.js` lines 86–93; router line 319 → `room.handleRoomMessage` (`backend/websocket/handlers/room.js`). Returns ROOM_MESSAGE_RESPONSE.
- **MAX_CONTENT:** 10000 both sides. Frontend `myfrontend/frontend/src/config/wsContract.js`; backend `backend/websocket/protocol/wsSchemas.js` line 11 (MAX_CONTENT), and `backend/websocket/handlers/sendMessage.js` / `backend/websocket/handlers/room.js` content checks.
- **ACK/receive handling:** `ChatAdapterContext.jsx` lines 199–204 (MESSAGE_ACK), 214–215 (MESSAGE_RECEIVE), 388–415 (ROOM_MESSAGE_RESPONSE).

---

## 3. Reference tables

### 3.1 WebSocket message types (backend source of truth)

**Direction:** C = client→server, S = server→client. **Validation:** `backend/websocket/protocol/wsSchemas.js` (payloadSchemas, validatePayload at lines 112–138). **Routing:** `backend/websocket/router.js` (switch at lines 268–332). **Types enum:** `backend/websocket/protocol/types.js`.

| type | Direction | Required fields (inbound) | Validation (schema lines) | Handler (router line) |
|------|-----------|---------------------------|---------------------------|----------------------|
| HELLO | C | type, version (int) | 15–18 | 269 → helloHandler |
| HELLO_ACK | S | type, version | — | — |
| MESSAGE_SEND | C | recipientId, content (1–10000); clientMessageId optional | 19–24 | 273 → sendMessage |
| MESSAGE_ACK | S | — | — | — |
| MESSAGE_READ | C | messageId | 25–28 | 276 → readAck |
| MESSAGE_READ_CONFIRM | C | messageId | 29–32 | 278 → readAck |
| MESSAGE_DELIVERED_CONFIRM | C | messageId | 33–36 | 281 → deliveredAck |
| MESSAGE_REPLAY | C | lastMessageId?, limit? | 37–41 | 284 → reconnect |
| STATE_SYNC | C | lastMessageId?, lastReadMessageId? | 41–45 | 287 → reconnect |
| RESUME | C | lastSeenMessageId? | 46–49 | 290 → reconnect |
| PRESENCE_PING | C | status? (enum) | 50–53 | 293 → presence |
| CLIENT_ACK | C | messageId; ackType? | 55–59 | 296 → readAck |
| PING | C | type | 59–61 | 299 → ping |
| TYPING_START | C | roomId? or targetUserId? | 62–70 | 302, 305 → typing |
| TYPING_STOP | C | roomId? or targetUserId? | 67–70 | 305 → typing |
| ROOM_CREATE | C | roomId; name?, metadata? | 72–77 | 310 → room |
| ROOM_JOIN | C | roomId | 78–80 | 312 → room |
| ROOM_LEAVE | C | roomId | 81–84 | 315 → room |
| ROOM_MESSAGE | C | roomId, content (1–10000); clientMessageId?, messageType? | 86–93 | 318 → room |
| ROOM_INFO | C | roomId | 94–97 | 321 → room |
| ROOM_LIST | C | includeAll? | 98–101 | 324 → room |
| ROOM_MEMBERS | C | roomId | 102–105 | 327 → room |
| ERROR | S | — | — | — |
| MESSAGE_ERROR | S | — | — | — |

**Schema validation failure:** Router returns MESSAGE_ERROR with code `INVALID_PAYLOAD` (`backend/websocket/router.js` lines 97–117). **Send-relevant error codes** (from `backend/utils/errorCodes.js` and handlers): INVALID_PAYLOAD, CONTENT_TOO_LONG, AUTH_REQUIRED, MISSING_ROOM_ID, MISSING_CONTENT, NOT_A_MEMBER, RATE_LIMIT_EXCEEDED, RATE_LIMITED.

### 3.2 Admin HTTP endpoints

**Mount:** `backend/app.js` line 54: `app.use('/api', httpRouter)`. `backend/http/index.js` line 83: `httpRouter.use('/admin', adminRoutes)`. So all admin routes are **`/api/admin/...`**.

**Middleware:** All admin routes use `requireAuth` (`backend/http/routes/admin.routes.js` line 17). Then per-route: `requireAdmin` (`backend/http/middleware/requireRole.js`). POST actions use `adminActionLimiter` (rate limit, `backend/http/middleware/rateLimit.middleware.js`). **Error responses:** 401 when not authenticated; 403 with code `FORBIDDEN` when role insufficient (`requireRole.js` lines 13–18).

| Method | Path | Middleware | Controller (file:line) | Frontend API (file:line) |
|--------|------|------------|------------------------|---------------------------|
| GET | /api/admin/dashboard | requireAdmin | admin.controller.js getDashboard 157 | admin.api.js fetchAdminDashboard 12–15 |
| GET | /api/admin/dashboard/timeseries | requireAdmin | getDashboardTimeseries 192 | fetchAdminDashboardTimeseries 22–30 |
| GET | /api/admin/dashboard/series | requireAdmin | getDashboardSeries 220 | fetchAdminDashboardSeries 37–45 |
| GET | /api/admin/dashboard/stats | requireAdmin | getDashboardStats 236 | fetchAdminDashboardStats 69–72 |
| GET | /api/admin/dashboard/activity | requireAdmin | getDashboardActivity 266 | fetchAdminDashboardActivity 53–61 |
| GET | /api/admin/activity | requireAdmin | getActivity 250 | fetchAdminActivity 78–87 |
| GET | /api/admin/users | requireAdmin | getUsers 357 | fetchAdminUsers 110–120 |
| GET | /api/admin/users/:id/sessions | requireAdmin | getUserSessions 309 | fetchAdminUserSessions 94–104 |
| GET | /api/admin/diagnostics/:userId | requireAdmin | getDiagnostics 443 | fetchAdminDiagnostics 125–129 |
| GET | /api/admin/reports | requireAdmin | getReports 493 | fetchAdminReports 134–137 |
| POST | /api/admin/reports/:id/resolve | requireAdmin, adminActionLimiter | resolveReport 564 | resolveAdminReport 144–149 |
| POST | /api/admin/users/:id/role | requireAdmin, adminActionLimiter | promoteUserToAdmin 41 | setUserRole 164–169 |
| POST | /api/admin/users/:id/warn | requireAdmin, adminActionLimiter | warnUser 589 | adminWarnUser 174–180 |
| POST | /api/admin/users/:id/ban | requireAdmin, adminActionLimiter | banUser 627 | adminBanUser 185–191 |
| POST | /api/admin/users/:id/unban | requireAdmin, adminActionLimiter | unbanUser 699 | adminUnbanUser 196–202 |
| POST | /api/admin/users/:id/revoke-sessions | requireAdmin, adminActionLimiter | revokeSessions 669 | adminRevokeSessions 206–212 |

**Admin controller and routes:** `backend/http/controllers/admin.controller.js`; `backend/http/routes/admin.routes.js` lines 19–48. **Frontend:** All admin HTTP calls go through `myfrontend/frontend/src/features/admin/api/admin.api.js` via `apiFetch` from `myfrontend/frontend/src/lib/http.js`; no duplicate patterns—use the existing fetch wrappers in admin.api.js.

---

## 4. File:Line reference table

| Topic | File | Line(s) |
|-------|------|--------|
| Backend PORT default | backend/config/constants.js | 16 |
| JWT cookie name | backend/config/constants.js | 22 |
| WS path, upgrade check | backend/websocket/index.js | 56, 62–66 |
| Session at HELLO, ERROR + close 1008 | backend/websocket/protocol/helloHandler.js | 41–47, 55–59 |
| HELLO_ACK response | backend/websocket/protocol/helloHandler.js | 92 |
| register(userId, ws) in setupConnection | backend/websocket/connection/wsServer.js | 163, 173 |
| Bypass auth on upgrade | backend/websocket/connection/wsServer.js | 365–385 |
| WS message types enum | backend/websocket/protocol/types.js | 10–37 |
| Inbound payload schemas | backend/websocket/protocol/wsSchemas.js | 14–105, 112–138 |
| Router switch (message types) | backend/websocket/router.js | 268–332 |
| MESSAGE_SEND handler | backend/websocket/handlers/sendMessage.js | 15–89 |
| ROOM_MESSAGE handler | backend/websocket/handlers/room.js | 202–225 |
| Error codes | backend/utils/errorCodes.js | 7–36 |
| Admin routes mount | backend/http/index.js | 83 |
| Admin routes definition | backend/http/routes/admin.routes.js | 19–48 |
| Vite proxy /api and /ws | myfrontend/frontend/vite.config.js | 7–9, 18–32 |
| ALLOW_BYPASS_AUTH | myfrontend/frontend/src/config/flags.js | 9 |
| getWsUrl, dev_user | myfrontend/frontend/src/transport/wsClient.js | 24–32 |
| HELLO on open, ready on HELLO_ACK | myfrontend/frontend/src/transport/wsClient.js | 101–111, 123–128 |
| send(), isReady() | myfrontend/frontend/src/transport/wsClient.js | 216–227, 365–366 |
| sendMessage, sendRoomMessage | myfrontend/frontend/src/transport/wsClient.js | 230–238, 346–354 |
| x-dev-user header | myfrontend/frontend/src/lib/http.js | 47–48 |
| Connect gate, sendRoomMessageViaWs, sendMessageViaWs | myfrontend/frontend/src/features/chat/adapters/ChatAdapterContext.jsx | 150–155, 590–597, 903 |
| MESSAGE_ACK, MESSAGE_RECEIVE, ROOM_MESSAGE_RESPONSE handling | myfrontend/frontend/src/features/chat/adapters/ChatAdapterContext.jsx | 199–204, 214–215, 388–415 |
| ChatWindow send gates, handleSend | myfrontend/frontend/src/features/chat/ui/ChatWindow.jsx | 161–168, 155, 189, 197, 206 |
| Admin API wrappers | myfrontend/frontend/src/features/admin/api/admin.api.js | 12–212 |

---

## 5. B3 — Admin Users; B4 — Reports

**B3 (Admin Users):** Ban, Unban, Warn, Revoke sessions are implemented. Backend: `backend/http/controllers/admin.controller.js` (banUser 627, unbanUser 699, warnUser 589, revokeSessions 669). Frontend: `myfrontend/frontend/src/features/admin/api/admin.api.js` (adminBanUser 185–191, adminUnbanUser 196–202, adminWarnUser 174–180, adminRevokeSessions 206–212). Buttons and loading/toast/refetch are wired in the Admin Users page; reference `admin.api.js` for request/response shape.

**B4 (Reports):** List reports, resolve report. Backend: getReports 493, resolveReport 564. Frontend: fetchAdminReports 134–137, resolveAdminReport 144–149. Warn/Ban from Reports context use the same admin user endpoints as B3.

---

---

## 7. STOP CONDITIONS (B1–B5)

- **B1:** WS handshake completes: HELLO sent → HELLO_ACK received → `wsClient.ready === true`; no "WebSocket not ready" toasts when sending. Evidence: DevTools WS Frames show HELLO then HELLO_ACK; backend logs show session at HELLO time when applicable.
- **B2:** Outbound MESSAGE_SEND / ROOM_MESSAGE with correct fields; inbound MESSAGE_ACK / ROOM_MESSAGE_RESPONSE; message appears in UI and status updates. No invented types; validation and error codes as in §3.1 and backend handlers.
- **B3:** Admin Users Ban/Unban/Warn/Revoke call real endpoints; UI shows loading and result (toast/refetch) per `admin.api.js` contract.
- **B4:** Reports list and resolve use real endpoints; Warn/Ban from reports use same admin user endpoints as B3.

---

## 8. Quick verification and observation log

**Quick WS handshake check:**

1. Start backend and frontend (dev). Open app, go to chat.
2. DevTools → Network → WS → select `/ws` → Frames: outbound `HELLO`, then inbound `HELLO_ACK` with `version`.
3. Console (dev): `[ws] connected` and `[wsClient] READY TRUE via HELLO_ACK`. No "WebSocket not ready" toasts.
4. Optional backend: `WS_LOG_LEVEL=debug`, `NODE_ENV=development` — logs show `ws_upgrade*`, `ws_hello`, `ws_hello_decision` (HELLO_ACK). Session created in `wsServer.setupConnection` via `connectionManager.register` before message handler runs (`backend/websocket/connection/wsServer.js` 163, 173).

**Observation log (fill after running):**

| Item | Value |
|------|--------|
| Computed WS URL (from frontend log) | _e.g. ws://localhost:5173/ws?dev_user=dev_admin_ |
| Backend pathname seen | _e.g. /ws_ |
| Upgrade reached backend? | _yes / no_ |
| Backend logged userId/session for HELLO? | _yes / no; userId=… sessionExists=…_ |
| HELLO_ACK sent or connection closed? | _HELLO_ACK / closed; code=… reason=…_ |

**First failure (pick one):** (A) connect() not called  (B) WS not opened  (C) HELLO not sent  (D) HELLO rejected (auth/path)  (E) HELLO accepted but session missing  (F) HELLO_ACK sent but client not setting ready  (G) other: _describe_

---

## 9. Phase 1 — Messages disappear after refresh (investigation, NO FIXES)

**Goal:** Find exactly why messages disappear after page refresh without changing architecture.

### 9.1 Where message history is supposed to load

| Location | What |
|----------|------|
| **Frontend** | `myfrontend/frontend/src/features/chat/api/chat.api.js` — `getHistory(chatId, { limit, beforeId })` calls **GET /api/chat?chatId=...&limit=...&beforeId=...** (query params). Returns `{ messages, nextCursor, hasMore }` from `json?.data`. |
| **Frontend** | `ChatAdapterContext.jsx` — `loadMessages(conversationId, { limit, beforeId })` calls `getHistoryApi(conversationId, ...)` and then `setMessagesByConversation(prev => ({ ...prev, [conversationId]: normalized }))`. |
| **Frontend** | `ChatWindow.jsx` — When `conversationId` is set **and** `conversationId.startsWith("direct:")`, a `useEffect` runs and calls `loadMessages(conversationId, { limit: 50 })`. So **only DM conversations** trigger HTTP history load; rooms do not. |
| **Backend** | `backend/http/index.js` — `httpRouter.use('/chat', historyRoutes)` so **GET /api/chat** and **GET /api/chat/:conversationId** are history. |
| **Backend** | `backend/http/routes/history.routes.js` — `router.get('/', historyController.getHistory)` (query `chatId`, `limit`, `beforeId`); `router.get('/:conversationId', historyController.getHistoryByPath)` (path becomes `chatId`). |
| **Backend** | `history.controller.js` → `historyService.getHistory(userId, chatId, options)` → `messageStore.getMessagesForRecipient` / `getMessagesForRecipient(otherParticipant)` → **db adapter** (file-backed `backend/storage/message.store.js`). Returns paginated messages for that chat. |

So: **history is loaded only when a DM conversation is selected**, via GET /api/chat?chatId=direct:u1:u2&limit=50. Backend returns whatever is in the persisted message store for that chat.

### 9.2 Possible root causes (observe and tick one)

After **Open chat → send message → refresh page**:

- **(A) History endpoint not called** — After refresh, `conversationId` is null until the user clicks a conversation. So no history request runs until they select the DM again. If they do select it, check console for `[Phase1-debug] loadMessages called` and `[Phase1-debug] history request` / `history response`. If those never appear for the DM, either the conversation was not selected or the effect did not run (e.g. not a `direct:` id).
- **(B) History returns empty** — Backend might return `messages: []` (e.g. chatId format mismatch, or messages not persisted for that chat). Check `[Phase1-debug] history response` → `messageCount`. Check Network tab: GET /api/chat?chatId=... response body. Check backend: messages in `backend/storage/_data/messages.json` and `historyService.getHistory` filtering (e.g. `direct:userId1:userId2` and participant order).
- **(C) History loaded then overwritten** — Something after history load clears or overwrites `messagesByConversation`. **ROOM_LIST_RESPONSE** and **ROOMS_SNAPSHOT** do **not** clear messages (they only set `roomsById`, `roomIds`, `membersByRoomId`). The only code that clears `messagesByConversation` is **resetAllState()**, which is called only on **logout** (Sidebar `handleLogout`). So after refresh, state is lost because the whole app remounts (React state is not persisted). So after refresh, `messagesByConversation` starts as `{}`; history is only re-filled when the user selects a DM and `loadMessages` runs and succeeds.

### 9.3 Conclusion (fill after run)

- **Was history endpoint called after refresh (when you selected the DM)?** _yes / no_
- **Did it return messages?** _yes / no (messageCount: …)_
- **Did WS snapshot clear store after history load?** _no (ROOM_LIST_RESPONSE/ROOMS_SNAPSHOT do not touch messages)_

**Root cause (pick one):** (1) History not called (conversation not re-selected or effect not run for DM). (2) History returns empty (backend/format/ownership). (3) History loaded but something else overwrites (unlikely; see 9.2). (4) Other: _describe_

**Temporary debug logs added (remove later):** ChatWindow mount/unmount; conversation selected + isDirect; loadMessages called + result; getHistory request + response messageCount; ROOMS_SNAPSHOT / ROOM_LIST_RESPONSE (clearsMessages: false). Search for `[Phase1-debug]` to remove.

---

## 10. Multi-tab / single-socket diagnosis (Goal: prove the bug)

**Diagnosis note:** Multi-tab opens multiple sockets using the same `sid` (JWT session id). The server keeps only one active WS per user/session: when a second tab connects with the same `sid`, the server replaces the first tab’s socket (closes it with code 4000 “Replaced by new connection”). That tab then reconnects, which replaces the second tab’s socket in turn. The resulting replace/reconnect loop prevents resync from finishing (session flips between tabs), and repeated connect/resync attempts can hit rate limits.

**How to reproduce:** (1) Login in tab A and open `/chat`. (2) Same account, open `/chat` in tab B. (3) Observe: tab A receives close code 4000 and tab B becomes active; then they flip as A reconnects and replaces B.

**Note:** This instrumentation was removed. Debug mode flags (WS_DEBUG_MODE, etc.) are no longer available. Use normal server logs and the backend files above to diagnose connection/replace behavior.
