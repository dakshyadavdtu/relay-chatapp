# SYSTEM CONTRACTS MASTER

**Phase 0 — Master contract freeze and feature specification.**  
This document is the **single source of truth** for all contracts, identifiers, API shapes, and data flows. No feature implementation in this phase.

---

## SECTION 1 — REPOSITORY INVENTORY (CURRENT SYSTEM)

### 1.1 Backend architecture

| Layer | Location | Purpose |
|-------|----------|---------|
| **Auth / session** | `auth/sessionStore.js` | Device sessions: create, list, touch, revoke, revokeAll, refresh hash rotate/verify. In-memory; sessionId (UUID), userId, role, createdAt, lastSeenAt, revokedAt, userAgent, ip. |
| **Auth tokens** | `auth/tokenService.js` | JWT create/verify; access + refresh cookies. |
| **HTTP** | `http/index.js` | Router mount: auth, password, users, chats, chat/send, chat (history), sessions, reports, uploads, admin, export. Middleware: JSON, originGuard, authMiddleware. |
| **HTTP routes** | `http/routes/*.js` | auth.routes, password.routes, user.routes, chat.routes, history.routes, sessions.routes, reports.routes, uploads.routes, admin.routes, admin.users.routes, export.routes. |
| **HTTP controllers** | `http/controllers/*.js` | auth, user, chat, history, sessions, reports, uploads, admin, export. |
| **WebSocket** | `websocket/index.js` | Attach WS to HTTP server; protocol entry. |
| **WS protocol** | `websocket/protocol/types.js`, `dispatcher.js`, `router.js` | Message type constants; dispatcher parses, delegates to router, records latency; router dispatches to handlers. |
| **WS handlers** | `websocket/handlers/*.js` | sendMessage (DM), room (ROOM_*), reconnect, readAck, helloHandler, presence. |
| **WS connection** | `websocket/connection/connectionManager.js`, `wsServer.js` | register(userId, socket, sessionId); getSocket(userId); remove(userId); removeSession(sessionId). Validates JWT on upgrade; rejects if session revoked. |
| **WS state** | `websocket/state/sessionStore.js`, `connectionStore.js`, `roomManager.js`, etc. | sessionId → { userId, socket }; socket → userId, sessionId; rooms, delivery, typing, presence. |
| **Storage** | `storage/message.store.js`, `storage/message.mongo.js`, `storage/user.store.js`, `storage/reports.store.js`, `storage/warnings.store.js`, `storage/room.store.js` | Messages (file or Mongo by DB_URI), users (file), reports (in-memory), warnings, rooms (file). |
| **DB adapter** | `config/db.js` | If DB_URI set → Mongo; else file. persistMessage, getMessage, getMessagesForRecipient, getMessagesBySender, getMessagesByRoom, getAllHistory, getHistoryPaginated, delivery, delete, clearStore, getMessageCount. |
| **History** | `services/history.service.js` | getHistory(userId, chatId, { limit, beforeId }); validateChatOwnership(chatId, userId); filterMessagesByChatId. Uses messageStore + roomManager. |
| **Observability** | `observability/metrics.js`, `observability/snapshot.js`, `observability/adminDashboardBuffer.js`, `observability/adminActivityBuffer.js`, `observability/aggregators/*.js` | Counters (messages_persisted_total, etc.); snapshot (connections, messages, latency); dashboard ring buffer (messagesPerSecond, connections, latency, suspiciousFlags); activity feed. |
| **Diagnostics** | `diagnostics/userDiagnosticsAggregator.js`, `console.snapshot.js` | Per-user: messageCountWindow, deliveryFailures, reconnectCount, lastActivity. |
| **Suspicious** | `suspicious/suspicious.detector.js` | MESSAGE_BURST (25 in 10s), RECONNECT_BURST (8 in 120s); flags per user; getTotalFlagsCount(). |
| **Admin** | `http/controllers/admin.controller.js`, `http/routes/admin.routes.js` | Dashboard, users, reports, diagnostics, warn, ban, unban, revoke one session, revoke all sessions, role promote (root only). |

### 1.2 Frontend architecture

| Area | Location | Purpose |
|------|----------|---------|
| **Admin** | `features/admin/`, `pages/admin/` | Dashboard, Users, Reports pages; admin.api.js (fetchAdminDashboard, fetchAdminUsers, fetchAdminReports, resolveAdminReport, adminBanUser, adminUnbanUser, adminRevokeSessions, etc.); AdminLayout, requireRole(ADMIN). |
| **Settings / sessions** | `features/settings/api/sessions.api.js`, `pages/settings/DevicesPage.jsx`, `DangerPage.jsx` | getActiveSessions(), logoutSession(body); DevicesPage uses mock revoke; DangerPage has “Log Out All” and “Delete Account” UI but not wired to real endpoints. |
| **Chat** | `features/chat/`, `adapters/ChatAdapterContext.jsx`, `api/chat.api.js`, `api/rooms.ws.js` | Conversation state, loadMessages (history), toBackendChatId, exportChatJson/exportChatPdf; WebSocket send/receive. |
| **Export** | `features/settings_ui/PreferencesPage.jsx`, `features/chat/api/chat.api.js` | Export dialog: JSON/PDF; calls exportChatJson(chatId), exportChatPdf(chatId) with credentials; uses useChatStore for conversationId → backendChatId. |

### 1.3 All existing HTTP endpoints used by frontend

Base path: `/api` (app mounts httpRouter at `/api`).

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | /api/login | — | Login |
| POST | /api/register | — | Register |
| POST | /api/logout | — | Logout (auth controller) |
| POST | /api/auth/refresh | — | Rotate refresh token |
| GET | /api/me | requireAuth | Current user (auth) |
| PATCH | /api/me | requireAuth | Update profile |
| GET | /api/users/me | requireAuth | Current user (user controller) |
| GET | /api/users/:id | requireAuth | User by id |
| GET | /api/chats | requireAuth | Chat list |
| GET | /api/chat | requireAuth | History (query chatId, limit, beforeId) |
| GET | /api/chat/:conversationId | requireAuth | History by path |
| POST | /api/chat/send | requireAuth, messageLimiter | Send message (HTTP; deprecated in favor of WS) |
| GET | /api/sessions/active | requireAuth | Active sessions (stub) |
| POST | /api/sessions/logout | requireAuth | Logout (delegates to auth logout) |
| POST | /api/reports | requireAuth, reportLimiter | Create report |
| POST | /api/uploads/image | requireAuth | Upload image |
| GET | /api/admin/dashboard | requireAuth, requireAdmin | Dashboard aggregates |
| GET | /api/admin/dashboard/timeseries | requireAuth, requireAdmin | Timeseries chart |
| GET | /api/admin/dashboard/series | requireAuth, requireAdmin | Series data |
| GET | /api/admin/dashboard/stats | requireAuth, requireAdmin | Extended stats |
| GET | /api/admin/dashboard/activity | requireAuth, requireAdmin | Activity feed |
| GET | /api/admin/activity | requireAuth, requireAdmin | Activity |
| GET | /api/admin/users | requireAuth, requireAdmin | Users list |
| GET | /api/admin/users/:id/sessions | requireAuth, requireAdmin | User sessions |
| GET | /api/admin/diagnostics/:userId | requireAuth, requireAdmin | User diagnostics |
| GET | /api/admin/reports | requireAuth, requireAdmin | Reports queue |
| POST | /api/admin/reports/:id/resolve | requireAuth, requireAdmin | Resolve report |
| POST | /api/admin/users/:id/role | requireAuth, requireRootAdmin | Set role |
| POST | /api/admin/users/:id/warn | requireAuth, requireAdmin | Warn user |
| POST | /api/admin/users/:id/ban | requireAuth, requireAdmin | Ban user |
| POST | /api/admin/users/:id/unban | requireAuth, requireAdmin | Unban user |
| POST | /api/admin/users/:id/sessions/:sessionId/revoke | requireAuth, requireAdmin | Revoke one session |
| POST | /api/admin/users/:id/revoke-sessions | requireAuth, requireAdmin | Revoke all sessions |
| GET | /api/admin/reports | requireAuth, requireAdmin | Moderation queue (reports) |
| GET | /api/export/chat/:chatId.json | requireAuth | Export chat JSON |
| GET | /api/export/chat/:chatId.pdf | requireAuth | Export chat PDF |

### 1.4 WebSocket message types (in use)

From `websocket/protocol/types.js` and router/handlers:

- **Protocol / auth:** HELLO, HELLO_ACK (implicit), PING, PONG, CLIENT_ACK  
- **DM:** MESSAGE_SEND, MESSAGE_ACK, MESSAGE_NACK, DELIVERY_STATUS, MESSAGE_READ, MESSAGE_READ_CONFIRM, MESSAGE_DELIVERED_CONFIRM, MESSAGE_REPLAY, STATE_SYNC  
- **Resync:** RESUME  
- **Presence:** PRESENCE_PING  
- **Rooms:** ROOM_CREATE, ROOM_JOIN, ROOM_LEAVE, ROOM_MESSAGE, ROOM_INFO, ROOM_LIST, ROOM_MEMBERS, ROOM_UPDATE_META, ROOM_ADD_MEMBERS, ROOM_REMOVE_MEMBER, ROOM_SET_ROLE, ROOM_DELETE  
- **Server → client room:** ROOM_CREATED, ROOM_UPDATED, ROOM_MEMBERS_UPDATED, ROOM_DELETED, ROOMS_SNAPSHOT; ROOM_MESSAGE (broadcast to members); ROOM_MESSAGE_RESPONSE (request ack); ROOM_MESSAGE_ACK (delivery ack)  
- **Typing:** TYPING_START, TYPING_STOP  
- **System:** SYSTEM_CAPABILITIES (role change push)

### 1.5 Stubs, placeholders, incomplete logic

| Item | Location | Current state |
|------|----------|----------------|
| GET /api/sessions/active | sessions.controller.js | Returns stub single session; comment says "Replace with actual session tracking". |
| POST /api/sessions/logout | sessions.controller.js | Delegates to auth.controller.logout; no body (sessionId) support for "log out this device". |
| POST /api/sessions/logout-all | — | **Not implemented.** Frontend DangerPage has "Log Out All" but no endpoint. |
| DevicesPage revoke | frontend DevicesPage.jsx | Uses useMockRevokeDevice; not wired to POST .../sessions/:sessionId/revoke (user-scoped revoke not exposed for self). |
| Delete account | frontend DangerPage.jsx | UI only; confirmation input and "Permanently Delete" close dialog; no DELETE /api/me or equivalent. |
| Report conversationId | reports.store.js, reports.controller.js | Report has targetUserId, messageId, reason, details; **conversationId not stored.** |
| Admin reports list | admin.controller getReports | Maps stored report to UI: id, date, user, priority, reason?, hasMessageContext; no message context fetch. |
| Latency aggregator export | observability/aggregators/latency.js | Exports `_recordLatency`; dispatcher requires `recordLatency` — **name mismatch** (runtime may alias or break). |
| Reports | admin getReports / getReportDetails | Returns moderation queue and report details. |
| Online users definition | admin dashboard | Dashboard uses `connections.totalConnections` (connection count); not unique users. |

---

## SECTION 2 — CANONICAL IDENTIFIERS (FINAL DECISION)

| Identifier | Format | Created by | Stored where | Sent to client | Used for auth |
|------------|--------|------------|--------------|----------------|---------------|
| **userId** | Opaque string (e.g. UUID or storage id) | Auth (register) | user.store (id), sessionStore (userId) | Yes (me, users) | JWT payload, requireAuth |
| **sessionId** | UUID (crypto.randomUUID()) | auth/sessionStore.createSession | sessionStore (sessionsById), JWT payload (sid) | Yes (sessions list, admin) | requireAuth (session not revoked), WS upgrade |
| **connectionId** | `remoteAddress:remotePort` (or logical id) | WS server (socket) | connectionStore (socket→user/session); logger only | Optional (logs/debug) | No |
| **conversationId** | Frontend: `dm-<userId>`, `group-<roomId>`, or raw roomId. Backend canonical: see chatId | Frontend (getConversationId) / backend (chatId) | Frontend state only | Yes (UI) | No |
| **chatId** | **direct:** `direct:<u1>:<u2>` (sorted). **room:** `room:<roomId>` | Backend (toDirectChatId, toRoomChatId) | message store (chatId on messages), history/export | Yes (history, export URL) | validateChatOwnership |
| **roomId** | Opaque string (e.g. server-generated) | roomManager.createRoom | roomManager, room.store | Yes (ROOM_* payloads) | isRoomMember(roomId, userId) |
| **messageId** | Server-generated (e.g. `rm_<ts>_<rand>` for room; per-recipient for room = `rm_<roomMsgId>_<recipientId>`) | message.service, group.service | message store | Yes (ACK, history, export) | No |
| **reportId** | `rpt_` + 12-char hex | reports.store.createReport | reports.store | Yes (admin reports list, resolve) | Admin only |

**Conversation (chatId) rules:**

- **Direct:** `direct:<userA>:<userB>` with sorted lexicographic order so the same pair always yields the same chatId regardless of who sent first.  
  **Reason:** Uniqueness and history key stability.
- **Room:** `room:<roomId>` so that history and export use one key; roomId is the canonical room identifier.  
  **Reason:** Distinguish from direct; consistent with persistence and GET /api/chat?chatId=room:xxx.

---

## SECTION 3 — SESSION MODEL (MULTI-DEVICE)

### What is a session?

A **session** is one device/browser login instance: one record in auth/sessionStore with sessionId, userId, role, createdAt, lastSeenAt, revokedAt, userAgent, ip, refreshHash, refreshExpiresAt. One login creates one session; refresh rotates that session’s refresh token; multiple devices = multiple sessions per userId.

### What makes a session active?

- **Active:** revokedAt === null and (refresh token valid or access token valid).  
- **Inactive:** revokedAt set, or refresh expired and no valid access.

### When lastSeenAt updates

- **touchSession(sessionId):** Called from requireAuth (throttled, e.g. 60s). Updates lastSeenAt.  
- **Login / refresh:** lastSeenAt set/updated at create or rotate.

### sessionId (HTTP) vs connectionId (WS)

- **sessionId:** From auth; stored in sessionStore; placed in JWT (sid). Used for HTTP (requireAuth) and WS upgrade (session must exist and not revoked). One session can have at most one live WebSocket at a time (reconnect rebinds socket to same sessionId).  
- **connectionId:** Optional identifier for a socket (e.g. remoteAddress:remotePort). Used for logging; not used for auth.  
- **Relationship:** One sessionId → zero or one WebSocket. connectionManager tracks by (userId, sessionId); removeSession(sessionId) closes that device’s WS only.

### Lifecycle

| Event | Session store | HTTP | WS |
|-------|----------------|-----|-----|
| **Login** | createSession; storeRefreshHash | Set access + refresh cookies | — |
| **Refresh** | touchSession; rotateRefreshHash | New cookies | — |
| **WS connect** | — | — | Validate JWT, resolve session; register(userId, socket, sessionId) |
| **Revoke one** | revokeSession(sessionId) | — | connectionManager.removeSession(sessionId) |
| **Logout (current)** | auth logout: revokeSession(req.user.sid) | Clear cookies | — |
| **Logout all** | revokeAllSessions(userId) | Clear cookies (if current user) | connectionManager.remove(userId) |

### API contracts (final)

**GET /api/sessions/active**

- **Response (contract):**  
  `{ success: true, data: { sessions: [ { sessionId, userId, createdAt (ISO), lastSeenAt (ISO), userAgent?, ip?, device? (derived), isCurrent?: boolean } ] } }`  
- **Behavior:** Return real sessions from sessionStore.listSessions(userId, { activeOnly: true }). isCurrent: sessionId === req.user.sid.

**POST /api/sessions/logout**

- **Body:** `{}` or `{ sessionId?: string }`.  
- **If sessionId provided and sessionId === req.user.sid:** Revoke that session, clear cookies, 200.  
- **If sessionId provided and belongs to same userId but ≠ current:** Revoke that session only (log out that device), 200.  
- **If no sessionId:** Current session logout (existing behavior: revoke current, clear cookies).

**POST /api/sessions/logout-all**

- **Body:** optional `{}`.  
- **Behavior:** revokeAllSessions(req.user.userId); connectionManager.remove(userId); clear cookies; 200.

**Admin:**

**POST /api/admin/users/:userId/revoke-sessions**

- **Response:** `{ success: true, data: { userId, revoked: true, count } }`.

**GET /api/admin/users/:userId/sessions**

- **Response:** `{ success: true, data: { userId, sessions: [ { id/sessionId, createdAt, lastSeenAt, lastSeen, revokedAt, userAgent, ip, device, isCurrent? } ] } }`.  
- **Behavior:** auth sessionStore.listSessions(userId, { activeOnly: false }), map to above shape.

---

## SECTION 4 — ADMIN PANEL CONTRACT (FROM UI)

### Admin dashboard

- **Online users:** Defined as **connection count** (totalConnections from connectionManager.getConnectionCount()). Not unique users.  
  **Decision:** Document as “active connections”; if “unique users” is required, add a separate aggregate (unique userIds with at least one connection).
- **Admins / Users counts:** From snapshot network.connections.countByRole (admin, user).
- **Messages per second:** From messages aggregator (rolling window); dashboard buffer samples it.
- **Latency avg/max/p95:** From latency aggregator. **Measurement source:** Dispatcher records time from message receive to response (handleIncoming completion). Rolling window (e.g. last 1000 samples).
- **Suspicious flags:** suspiciousDetector.getTotalFlagsCount(). **Logic:** MESSAGE_BURST (25 messages in 10s), RECONNECT_BURST (8 reconnects in 120s). **Decay:** Timestamps trimmed by window; flags remain until implementation defines decay.

**Dashboard API (existing):** GET /api/admin/dashboard returns data: onlineUsers, messagesPerSecond, latencyAvg, suspiciousFlags, adminsCount, regularUsersCount. GET /api/admin/dashboard/stats returns extended: messagesPerSecondPeak, messagesPerSecondP95, latencyMaxMs, latencyAvgP95, suspiciousFlagsDeltaLastHour.

### Admin users

- **List fields:** id, username, status (online/offline), flagged, banned, lastSeen, messages (messageCountWindow), failures (deliveryFailures), reconnects (reconnectCount), violations (null in current code), latency (null in current code), role (Admin/User), email (null in current code).
- **Diagnostics (GET /api/admin/diagnostics/:userId):** userId, snapshot (buildUserSnapshot: diagnostics + connection state), timestamp.
- **Active sessions:** GET /api/admin/users/:id/sessions returns list with sessionId, createdAt, lastSeenAt, revokedAt, userAgent, ip, device.
- **Ban:** POST /api/admin/users/:id/ban — userStore.setBanned; connectionManager.remove(userId). Cannot ban self or another admin.
- **Unban:** POST /api/admin/users/:id/unban — userStore.setUnbanned.
- **Revoke sessions:** POST /api/admin/users/:id/revoke-sessions — revokeAllSessions; connectionManager.remove(userId). POST /api/admin/users/:id/sessions/:sessionId/revoke — revoke one device.

### Reports page

- **Moderation queue:** GET /api/admin/reports — list open reports (newest first, max 200). Each: id, date (formatted), user (target or reporter display), priority (High/Normal), reason?, hasMessageContext, targetUserId.
- **Report priority:** Stored as Normal (or High from store); no automatic calculation defined — can be extended by keywords/severity later.
- **Message context:** hasMessageContext = Boolean(messageId). No message body or conversationId in current store; **message context requirements:** For moderation, optionally include: messageId, conversationId (or chatId), snippet/content, senderId. To be implemented.
- **Moderation actions:** warn (POST .../warn, reason optional), ban (POST .../ban), resolve (POST .../reports/:id/resolve). No “dismiss without action” in contract; resolve covers it.

## SECTION 5 — REPORTING SYSTEM (USER + MESSAGE)

### Report types

- **User report:** targetUserId set; messageId optional.  
- **Message report:** messageId set; targetUserId typically the sender (or room); conversationId recommended for context.

### Fields (stored + API)

- reporterUserId (required)  
- targetUserId (optional)  
- messageId (optional)  
- **conversationId (recommended for message reports)** — not in current store; add for moderation context.  
- reason (required string, max 500)  
- details (optional string, max 2000)  
- priority (Normal/High; optional derivation)  
- status (open | resolved)  
- createdAt (number ms)  
- resolvedAt?, adminId? (resolution metadata)

### Moderation flow

- **open** → **reviewing** (optional intermediate) → **resolved**.  
- Current: open | resolved only. resolveReport(reportId, adminId) sets status = resolved, resolvedAt, adminId.

### Rate limits

- POST /api/reports: 10 requests per hour per user (reportLimiter in rateLimit.middleware).

---

## SECTION 6 — CHAT HISTORY + EXPORT CONTRACT

### History ownership

- **Direct:** User may access history if they are one of the two participants (chatId = direct:u1:u2). validateChatOwnership: parseDirectChatId, participants.includes(userId).  
- **Room:** User may access if they are a member. validateChatOwnership: toRoomId(chatId), roomManager.isRoomMember(roomId, userId).

### Export behavior

- **JSON:** GET /api/export/chat/:chatId.json. Authorization: validateChatOwnership(chatId, userId). Body: `{ ok: true, data: { chatId, exportedAt (ISO), chatType (direct|room), participantsOrMembers, totalMessages, messages: [ { messageId, senderId, content, createdAt, type, state, roomId?, roomMessageId? } ] } }`. Content-Disposition: attachment; filename="chat_<safe>.json".  
- **PDF:** GET /api/export/chat/:chatId.pdf. Same auth. Content: title “Chat Export”, subheader chatId + exportedAt, lines “[YYYY-MM-DD HH:mm] senderLabel: content”. Content-Disposition: attachment; filename="chat_<safe>.pdf".  
- **Ordering:** Oldest first (createdAt ascending) for transcript; API/JSON may use same order.  
- **Timezone:** Server time (ISO) or UTC; document as UTC in contract.  
- **Deleted messages:** Not defined (no soft-delete in current model). If added: either exclude deleted or include with deleted: true.

### Endpoints (canonical)

- **GET /api/export/chat/:chatId.json** — as implemented (chatId URL-encoded).  
- **GET /api/export/chat/:chatId.pdf** — as implemented.  
- **Naming:** Document allows alternate path **GET /api/exports/conversations/:id.json** (and .pdf) as alias only if frontend is updated; current is /api/export/chat/:chatId.(json|pdf).

### Authorization

- RequireAuth + validateChatOwnership(chatId, req.user.userId). 403 if not participant (direct) or not member (room).

---

## SECTION 7 — DELETE ACCOUNT CONTRACT

### Decision (choose one)

- **Option A — Hard delete:** Remove user record; remove or anonymize sessions; delete or anonymize messages where user is sender/recipient; handle reports (anonymize reporter/target); remove from room members; keep admin logs with userId for audit (or redact to “deleted user”).  
- **Option B — Anonymization:** Keep user row with deleted flag; set username/email to “deleted_<id>”; clear sessions; anonymize message senderId/recipientId references; same for reports and room membership.

**Contract choice:** To be decided. Document: “Delete account: hard delete OR anonymization (one must be chosen).”

### What happens to

- **Sessions:** Revoke all; remove from session store (or mark deleted).  
- **WebSocket connections:** connectionManager.remove(userId).  
- **Messages:** Per choice: delete, anonymize, or retain with deleted user id.  
- **Reports:** Reporter/target anonymized or kept for audit.  
- **Room memberships:** Remove from all rooms (leaveRoom or delete membership).  
- **Admin logs:** Retain with userId or “deleted user” placeholder.

### Endpoint

- **DELETE /api/me** (or POST /api/me/delete). RequireAuth. Body: optional `{ confirmation: "DELETE" }`. Response: 200 + clear cookies; 400 if confirmation missing/invalid.

### Frontend confirmation

- DangerPage: user must type “DELETE” (or agreed string); button disabled until match; on submit call DELETE /api/me with credentials; on success clear auth and redirect to login.

---

## SECTION 8 — OBSERVABILITY + METRICS PIPELINE

### What increments

- **online users:** Not a direct counter; dashboard uses **connection count** (getConnectionCount()).  
- **active connections:** Same; one per WebSocket.  
- **message counters:** metrics.increment('messages_persisted_total'), 'messages_delivered_total'; messages aggregator (_trackMessageTimestamp) for messagesPerSecond.  
- **suspicious flags:** suspiciousDetector.recordMessage(userId), recordReconnect(userId); getTotalFlagsCount().  
- **latency:** recordLatency(ms) from dispatcher (time from message receive to handleIncoming completion). **Note:** latency.js exports _recordLatency; dispatcher imports recordLatency — align export name.

### Measurement sources

- **WS hello ack:** Not used for latency (hello is handshake).  
- **Ping/pong:** Heartbeat; not used for latency.  
- **Message ack:** Dispatcher records full request-to-response time (receive → handleIncoming done).

### Rolling windows

- **Dashboard buffer:** DEFAULT_WINDOW_SECONDS = 3600, interval 60s, MAX_POINTS = 60.  
- **Latency:** Last MAX_MEASUREMENTS = 1000 samples.  
- **Suspicious:** MESSAGE_BURST_WINDOW_MS = 10000, RECONNECT_BURST_WINDOW_MS = 120000.

---

## SECTION 9 — FRONTEND ↔ BACKEND CONTRACT CHECK

### Mismatches

1. **GET /api/sessions/active:** Backend returns stub; frontend expects sessions array with sessionId, connectedAt, lastActivity. Backend must return real sessionStore list (sessionId, createdAt, lastSeenAt, etc.).  
2. **POST /api/sessions/logout:** Backend ignores body; frontend may send sessionId for “log out this device”. Backend must accept optional sessionId and revoke that session (if same user).  
3. **Logout all:** No POST /api/sessions/logout-all; DangerPage “Log Out All” not wired.  
4. **DevicesPage:** Uses mock revoke; should call real “revoke this session” — require endpoint for **current user** to revoke one session by sessionId (e.g. POST /api/sessions/logout with body { sessionId } for “other device”).  
5. **Admin user sessions:** Backend returns sessionId, createdAt, lastSeenAt, revokedAt, userAgent, ip, device. Frontend fetchAdminUserSessions expects id, device, ip, location, isCurrent, lastSeen — field names differ (lastSeenAt vs lastSeen, device from userAgent). Align naming.  
6. **Admin revoke one:** Backend has POST /api/admin/users/:id/sessions/:sessionId/revoke. Frontend AdminUsersPage comment says “backend has no per-session revoke” — incorrect; wire UI to this endpoint.  
7. **Delete account:** No backend endpoint; frontend only UI.  
8. **Report conversationId:** Backend does not store conversationId; add for message reports.  
9. **Export path:** Frontend uses /api/export/chat/:chatId.(json|pdf). Doc section 6 mentioned /api/exports/conversations/:id — use current path as canonical.

---

## SECTION 10 — MISSING DECISIONS (MANDATORY)

1. **Delete account:** Hard delete vs anonymization (choose one and document).  
2. **Deleted users and messages:** Should messages from deleted users remain visible (with “deleted user” label) or be removed/hidden?  
3. **Admin tools:** Real backend load monitoring via dashboard metrics; no simulation tools.  
4. **Admin IP address:** Should admin see IP in session list? (Currently stored and returned; confirm for privacy/compliance.)  
5. **Online users metric:** Keep as “connection count” or add “unique users with ≥1 connection” and expose both?  
6. **Report priority:** Keep manual Normal/High or add automatic priority (e.g. by keywords, repeat reporter)?  
7. **Message context for reports:** Include conversationId, message snippet, and senderId in report creation and admin report detail?  
8. **Latency export:** latency.js exports _recordLatency; dispatcher uses recordLatency. Align (e.g. export recordLatency).

---

## SECTION 11 — IMPLEMENTATION READINESS SUMMARY

Checklist: every item must be defined (or explicitly deferred with a decision ticket).

| Area | Ready | Notes |
|------|--------|--------|
| **Sessions** | Partial | GET /sessions/active must return real data; POST /sessions/logout accept sessionId; add POST /sessions/logout-all; wire DevicesPage to revoke-one (self). |
| **Admin panel wiring** | Partial | Dashboard/users/reports/diagnostics defined; fix session field names and revoke-one wiring; define “online users” vs “connections”. |
| **Reporting** | Partial | Add conversationId to report; define message context (snippet, chatId); priority calculation optional. |
| **Exports** | Yes | JSON/PDF and auth defined; path /api/export/chat/:chatId.(json|pdf). |
| **Delete account** | No | Choose hard delete vs anonymization; define DELETE /api/me and data handling; wire DangerPage. |
| **Observability** | Partial | Metrics and snapshot defined; fix latency export name; define decay for suspicious flags if needed. |

**No item is left undefined for implementation:** Sections 2–8 and 10 define or call out every decision. Phase 1–8 implementation may proceed once Section 10 decisions are closed and stub/incomplete items in Section 1.5 are implemented per this contract.
