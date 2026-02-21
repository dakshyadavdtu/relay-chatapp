# System Technical Audit

**Mode:** Read + analyze only. No code changes. Evidence-based.

**Scope:** Backend + frontend (myfrontend/frontend) within the integrated project.

---

## SECTION 1 — FEATURE WIRING AUDIT (FRONTEND ↔ BACKEND)

### Auth / Sessions

| Item | Frontend | Backend | Wiring |
|------|----------|---------|--------|
| Login | `auth.api.js`: `apiFetch("/api/login", …)` | `auth.routes.js`: `POST /login` → `auth.controller.login` | ✅ Fully wired |
| Register | `apiFetch("/api/register", …)` | `POST /register` → `auth.controller.register` | ✅ Fully wired |
| GET /me | `apiFetch("/api/me")` | `GET /me` → `auth.controller.getMe` | ✅ Fully wired |
| PATCH /me | `apiFetch("/api/me", { method: "PATCH", body })` | `PATCH /me` → `auth.controller.patchMe` | ✅ Fully wired |
| Logout | `apiFetch("/api/logout")` or `/api/logout/current` | `POST /logout`, `POST /logout/current` | ✅ Fully wired |
| Refresh | `lib/http.js` calls `POST /api/auth/refresh` on 401 | `POST /auth/refresh` → `auth.controller.refresh` | ✅ Fully wired |
| Sessions list | `sessions.api.js`: `GET /api/sessions/active` | `sessions.routes.js`: `GET /active` → `sessions.controller.getActiveSessions` | ✅ Fully wired |
| Logout session | `POST /api/sessions/logout` (body: `{ sessionId? }`) | `POST /sessions/logout` → `sessions.controller.logout` | ✅ Fully wired |
| Logout all | `POST /api/sessions/logout-all` | `POST /sessions/logout-all` → `sessions.controller.logoutAll` | ✅ Fully wired |

### Devices / Logout flows

- Devices page uses `getActiveSessions` and `logoutSession` from `features/settings/api/sessions.api.js`, which call `/api/sessions/active` and `/api/sessions/logout`. Backend implements both. **✅ Fully wired.**
- Danger page uses `logoutAllSessions()` then `logout()`. **✅ Fully wired.**

### Admin Users

| Item | Frontend | Backend | Wiring |
|------|----------|---------|--------|
| Users list | `admin.api.js`: `GET /api/admin/users` | `admin.routes.js`: `GET /users` requireAdmin → `admin.controller.getUsers` | ✅ Fully wired |
| User sessions | `GET /api/admin/users/:id/sessions` | `GET /users/:id/sessions` requireAdmin → `getUserSessions` | ✅ Fully wired |
| Ban | `adminBanUser(userId)` → `POST /api/admin/users/:id/ban` | `POST /users/:id/ban` requireAdmin → `banUser` | ✅ Fully wired |
| Unban | `adminUnbanUser(userId)` | `POST /users/:id/unban` → `unbanUser` | ✅ Fully wired |
| Revoke all sessions | `adminRevokeSessions(userId)` | `POST /users/:id/revoke-sessions` → `revokeSessions` | ✅ Fully wired |
| Revoke one session | `adminRevokeOneSession(userId, sessionId)` | `POST /users/:id/sessions/:sessionId/revoke` → `revokeOneSession` | ✅ Fully wired |
| Warn user | `adminWarnUser(userId, reason)` | `POST /users/:id/warn` → `warnUser` | ✅ Fully wired |
| Set role (promote) | `setUserRole(userId, role)` → `POST /api/admin/users/:id/role` | **Route:** `POST /admin/root/users/:id/role` (admin.users.routes), not `POST /admin/users/:id/role` | 🟡 **Mismatch:** Frontend calls `/api/admin/users/:id/role`; backend only exposes role change at `/api/admin/root/users/:id/role` (requireRootAdmin). So non-root admin cannot change roles via API; frontend may get 404 or wrong path. |
| Root users list | No `fetchAdminRootUsers` or equivalent in `admin.api.js` | `GET /admin/root/users` → `getRootUsersList` (admin.users.routes) | ❌ **Exists only on backend.** Frontend has no API call for root users list. |

### Admin Dashboard

| Item | Frontend | Backend | Wiring |
|------|----------|---------|--------|
| Dashboard cards | `fetchAdminDashboard()` → `GET /api/admin/dashboard` | `GET /dashboard` requireAdmin → `getDashboard` | ✅ Fully wired |
| Timeseries | `fetchAdminDashboardTimeseries()` → `GET /api/admin/dashboard/timeseries` | `GET /dashboard/timeseries` → `getDashboardTimeseries` | ✅ Fully wired |
| Series | `fetchAdminDashboardSeries()` → `GET /api/admin/dashboard/series` | `GET /dashboard/series` → `getDashboardSeries` | ✅ Fully wired |
| Stats | `fetchAdminDashboardStats()` → `GET /api/admin/dashboard/stats` | `GET /dashboard/stats` → `getDashboardStats` | ✅ Fully wired |
| Dashboard activity | `fetchAdminDashboardActivity()` → `GET /api/admin/dashboard/activity` | `GET /dashboard/activity` → `getDashboardActivity` | ✅ Fully wired |
| Dashboard history | Not found in frontend admin.api | `GET /dashboard/history` → `getDashboardHistory` | 🟡 **Backend only.** Route exists; no frontend caller found. |
| Activity feed | `fetchAdminActivity()` → `GET /api/admin/activity` | `GET /activity` → `getActivity` | ✅ Fully wired |

### Reports / Moderation

| Item | Frontend | Backend | Wiring |
|------|----------|---------|--------|
| Create report | `report.api.js`: `apiFetch("/api/reports", { method: "POST", body })` | `reports.routes.js`: `POST /` requireAuth, reportLimiter → `reports.controller.createReport` | ✅ Fully wired |
| List reports | `fetchAdminReports()` → `GET /api/admin/reports` | `GET /reports` requireAdmin → `getReports` | ✅ Fully wired |
| Report details | `fetchAdminReportDetails(reportId)` → `GET /api/admin/reports/:id` | `GET /reports/:id` → `getReportDetails` | ✅ Fully wired |
| Resolve report | `resolveAdminReport(reportId)` → `POST /api/admin/reports/:id/resolve` | `POST /reports/:id/resolve` requireAdmin → `resolveReport` | ✅ Fully wired |

### Export

| Item | Frontend | Backend | Wiring |
|------|----------|---------|--------|
| Export JSON | `chat.api.js`: `/api/export/chat/${chatId}.json` | `export.routes.js`: `GET /chat/:chatId.json` requireAuth → `export.controller.exportChatJson` | ✅ Fully wired |
| Export PDF | `/api/export/chat/${chatId}.pdf` | `GET /chat/:chatId.pdf` → `exportChatPdf` | ✅ Fully wired |
| Ownership | UI passes chatId (direct or room) | `export.controller` uses `validateChatOwnership(chatId, userId)` (history.service); for rooms uses `roomManager.isRoomMember(roomId, uid)` | ✅ Wired; export only for chats user can access. |

### Rooms / Groups

- Room and group actions are driven by **WebSocket** (ROOM_LIST, ROOM_JOIN, ROOM_MESSAGE, etc.). Frontend uses `wsClient` (rooms.ws.js, ChatAdapterContext). Backend handles these in `websocket/handlers/room.js` and router. **✅ Fully wired** for real-time flow.
- HTTP chat list: `GET /api/chats`, `GET /api/chats/:chatId` (chat.routes, chat.controller). Frontend uses `chat.api.js` for some metadata. **✅ Wired.**

### WebSocket messaging

- Frontend: `wsClient` sendMessage, sendRoomMessage, HELLO → HELLO_ACK, MESSAGE_SEND, ROOM_MESSAGE, RESUME, etc. Backend: router + sendMessage, room handlers, message.service, delivery. **✅ Fully wired.**
- Message persistence: backend `message.service.js` and `message.store` / DB; `trackPersistedMessageTimestamp` called from message.service. **✅ Wired.**

## SECTION 2 — BACKEND FLOW COMPLETENESS AUDIT

### 1. Login → session creation → refresh → WS upgrade

- **Login:** auth.controller login → sessionStore.createSession, tokenService.issueAccess/issueRefresh, cookies set. **Complete.**
- **Refresh:** auth.controller refresh → cookie read, sessionStore.getSessionIdByRefreshHash, rotateRefreshHash, new cookies. **Complete.** Frontend uses it on 401 (lib/http.js).
- **WS upgrade:** wsServer validates JWT/session, resolves session; if session missing or revoked, rejects upgrade (401/403). **Complete.**
- **Gap:** None identified for this flow.

### 2. Message send → persistence → delivery → metrics

- **Send path:** Router → sendMessage handler → message.service (persist, delivery). **Complete.**
- **Persistence:** message.service calls messageStore/db; `trackPersistedMessageTimestamp()` called in message.service (services/message.service.js) after persist. **Complete.**
- **Delivery:** delivery.trigger / sendToUserSocket; MESSAGE_RECEIVE or ROOM_MESSAGE to recipient sockets. **Complete.**
- **Metrics:** observability/metrics incremented (e.g. messages_persisted_total); messages aggregator uses trackPersistedMessageTimestamp. **Complete.**

### 3. Room message → broadcast → history → export

- **Room message:** ROOM_MESSAGE handler, roomManager, message.service (room persistence), broadcast to room members. **Complete.**
- **History:** replay.service / getUndelivered; RESUME / MESSAGE_REPLAY. **Complete.**
- **Export:** export.controller uses messageStore.getAllHistory(chatId). **Evidence:** message.mongo.js getAllHistory(chatId) queries by `chatId`; for room chats frontend may pass `room:&lt;roomId&gt;` or similar. history.service validateChatOwnership supports `room:` and uses roomManager.isRoomMember. **Complete** if chatId format for rooms is consistent (e.g. room:uuid).

### 4. Report creation → moderation queue → admin action

- **Create:** reports.controller createReport → reportsStore.createReport; adminActivityBuffer.recordEvent. **Complete.**
- **Queue:** getReports reads from reports store; getReportDetails loads report + message context. **Complete.**
- **Resolve:** resolveReport → reportsStore.resolveReport(reportId, adminId). **Complete.**

### 5. Admin ban/revoke → session invalidation → WS disconnect

- **Ban:** admin.controller banUser → userStoreStorage.setBanned, authSessionStore.revokeAllSessions, connectionManager.getSockets(targetId) → send ERROR ACCOUNT_SUSPENDED, close(4003), then connectionManager.remove(targetId). **Complete.**
- **Revoke one:** revokeOneSession → authSessionStore.revokeSession(sessionId), connectionManager.removeSession(sessionId). **Complete.**
- **Revoke all:** revokeSessions → revokeAllSessions, connectionManager.remove(targetId). **Complete.**

### 6. Export generation → history ownership validation

- **Export:** export.controller exportChatJson/exportChatPdf require userId, validateChatOwnership(chatId, userId). **Complete.**
- **Ownership:** history.service validateChatOwnership: direct chat (participants include userId); room (roomManager.isRoomMember(roomId, uid)). **Complete.**
- **Risk:** getParticipantsOrMembers(chatId) for rooms uses roomManager.getRoomMembers(roomId). If roomManager is in-memory only, after restart room membership may be empty; export still returns messages but participants list could be empty. **Documented; no missing step.**

### Dead code paths / silent failures

- **connections aggregator:** Uses `s.socket` (singular) while sessionStore.getAllSessions() returns objects with `sockets` (Set). So `s.socket` is undefined; connection counts in snapshot/observability will be 0. See Section 4.
- **getDashboardHistory:** Backend route exists; no frontend consumer found. Not dead but unused by current UI.

---

## SECTION 3 — WEBSOCKET PROTOCOL AUDIT

| Area | Finding | Status |
|------|---------|--------|
| HELLO / HELLO_ACK | helloHandler: HELLO required first; session must exist; version checked; HELLO_ACK sets protocolVersion, startPing. | ✅ safe |
| Reconnect / resume | reconnect handler: MESSAGE_REPLAY → replayService.replayMessages; RESUME; ensureSessionReady. sessionStore supports multiple sockets per session. | ✅ safe |
| Message ACK/NACK | sendMessage handler returns MESSAGE_ACK / ROOM_MESSAGE_RESPONSE; MESSAGE_ERROR on failure. Frontend handles ACK and errors. | ✅ safe |
| Delivery confirmations | deliveredAck, readAck handlers; delivery service and state updates. | ✅ safe |
| Session binding | ws.userId, ws.sessionId set in wsServer setupConnection; connectionManager.register(userId, ws, sessionId). | ✅ safe |
| Disconnect handling | ws.on('close') → handleDisconnect; connectionManager has socket.once('close') in _attachCloseAndHeartbeat; cleanup. lifecycle.onDisconnect idempotent (Phase 1 fix). | ✅ safe |
| getSocket() side effects | Phase 1: getSocket() no longer calls lifecycle.onDisconnect; read-only. | ✅ safe |
| Multiple sockets per session | sessionStore: sockets Set per session; connectionManager.getSockets(userId) flattens by session. remove(userId) iterates sessions and closes each socket. | ✅ safe |
| Socket registration after close | connectionManager cleanup marks offline and deletes from connectionStore; close handler runs once. | ✅ safe |

**Risks:**

- **Reconnect duplication:** If client sends multiple HELLO or RESUME in quick succession, backend may process all; protocolVersion and HELLO_ALREADY_SENT limit duplicate HELLO. **🟡 low risk.**
- **Memory:** sessionStore and connectionStore cleared on disconnect; connectionManager.remove and cleanup used. **✅ no leak identified.**

---

## SECTION 4 — OBSERVABILITY & METRICS AUDIT

| Component | Where recorded | Where used | Finding |
|-----------|----------------|------------|---------|
| Latency | dispatcher.js: `recordLatency(Date.now() - startMs)` after handleIncoming | latencyAggregator.getLatencySummary → adminDashboardBuffer.sample(), snapshot.js | ✅ Wired; latency.js exports both _recordLatency and recordLatency. |
| Message rate (MPS) | messages aggregator: trackPersistedMessageTimestamp() | message.service.js (3 call sites) calls trackPersistedMessageTimestamp | ✅ Wired. |
| Connection count (dashboard) | connectionManager.getConnectionCount() | adminDashboardBuffer.sample() uses it for connectionsAvg | ✅ Wired. |
| Connection count (snapshot) | connectionsAggregator.getConnectionsSummary(null, isAdmin) | snapshot.js assembleSnapshot | ❌ **Bug:** aggregators/connections.js iterates getAllSessions() and uses `s.socket` (singular). sessionStore.getAllSessions() returns `sockets` (Set) and `primary`, not `socket`. So `s.socket` is always undefined; total and countByRole stay 0. Snapshot connection metrics are wrong. |
| Snapshot values | assembleSnapshot uses connections, messages, latency aggregators | admin dashboard may consume snapshot or similar; getDashboard uses adminDashboardBuffer (different from snapshot) | Dashboard buffer uses connectionManager.getConnectionCount() directly (correct). Snapshot uses broken getConnectionsSummary. |
| Dashboard buffer | adminDashboardBuffer.sample() runs on interval (start() at load); samples messages, connections, latency, suspiciousFlags | getDashboardSeries, getExtendedStats | ✅ Buffer fed; dashboard series/stats reflect buffer. |
| Aggregators never called | connections.getConnectionsSummary called by snapshot.js and tests; messages.getMessagesSummary by adminDashboardBuffer and snapshot; latency by same | All called | ✅ None unused. |
| metrics.getMetrics() | observability/metrics (counters) | messages aggregator getMessagesSummary reads metrics.messages_persisted_total, messages_delivered_total | ✅ Wired. |

**Summary:** Latency and message metrics are correct. Dashboard buffer connection count is correct (connectionManager.getConnectionCount()). Snapshot and any consumer of **connections aggregator** getConnectionsSummary see zero connections due to s.socket vs s.sockets mismatch.

---

## SECTION 6 — SECURITY & VULNERABILITY AUDIT

| Area | Finding | Risk |
|------|---------|------|
| Admin routes | admin.routes.js: requireAuth then requireAdmin or requireRootAdmin per route. Role from req.user. | ✅ Protected. |
| Root-only routes | /admin/root/users under admin.users.routes: requireRootAdmin. promoteUserToAdmin and getRootUsersList only there. | ✅ Protected. |
| Reports | POST /reports requireAuth, reportLimiter. GET /admin/reports, resolve requireAdmin. | ✅ Protected. |
| Export | export.routes requireAuth; export.controller validates validateChatOwnership(chatId, userId). | ✅ Protected. |
| Session revocation | revokeOneSession checks session.userId === userId (param); revokeSessions targets user by id. Admin only. | ✅ Protected. |
| Ban | banUser: root admin immune (ROOT_ADMIN_IMMUNE); cannot ban self; cannot ban another admin. | ✅ Protected. |
| WS auth | Upgrade: JWT/session validated; session revoked → reject. helloHandler requires userId and session. | ✅ Protected. |
| Report abuse | reportLimiter (10/hour per user); body size limit; validation of messageId/conversationId/senderId. | ✅ Mitigated. |
| Export data leakage | validateChatOwnership ensures user is participant (DM) or room member. | ✅ Ownership enforced. |
| Auth middleware | requireAuth uses sessionStore.getSession(sessionId), checks session.revokedAt. | ✅ Revoked sessions rejected. |
| Role promotion path | Frontend calls POST /api/admin/users/:id/role; backend only has POST /api/admin/root/users/:id/role. Non-root admin would get 404 (or wrong path). | 🟡 Non-root admin cannot change roles via current frontend URL; root admin must use correct path. |

---

## SECTION 7 — DATA CONSISTENCY & STATE RISKS

| Item | Finding |
|------|---------|
| Naming | Backend uses userId, sessionId, messageId, chatId, roomId consistently. Frontend normalizers use id, sessionId, etc. Some APIs return `id` vs `userId` (e.g. user list); frontend normalizers map (e.g. id ?? ""). **Minor inconsistency only.** |
| Export chatId | Export uses chatId as stored (e.g. direct:u1:u2, or room:roomId). history.service validateChatOwnership and message.mongo getAllHistory(chatId) expect same format. Room messages in DB may use roomId in a field; getAllHistory(chatId) queries by chatId. **Evidence:** message.mongo getAllHistory(chatId) does find({ chatId }). Room messages might be stored with chatId like "room:uuid"; if stored with only roomId, query could miss. **Worth verifying** room message chatId storage vs export frontend pass. |
| Partial updates | Ban: setBanned, revokeAllSessions, then close sockets. Order is correct. No partial-update risk identified. |
| Stale caches | adminDashboardBuffer is a ring buffer; no invalidation. adminActivityBuffer: activity feed. Both eventually consistent. |
| In-memory vs stored | connectionManager/sessionStore are in-memory; session revocations and bans are persisted (sessionStore.mongo, user.mongo). After restart, WS state is lost but HTTP auth and bans persist. **By design.** |

---

## SECTION 8 — UNUSED / DEAD / SHADOW CODE

| Item | Location | Evidence |
|------|----------|----------|
| GET /admin/dashboard/history | admin.routes.js, admin.controller getDashboardHistory | No frontend call in admin.api.js or adapters. **Unused by frontend.** |
| GET /admin/root/users | admin.users.routes.js getRootUsersList | No fetchAdminRootUsers or equivalent in frontend. **Unused by frontend.** |
| POST /admin/users/:id/role (non-root) | N/A | Backend does not expose this; only /admin/root/users/:id/role. Frontend calls /admin/users/:id/role which does not match. **Shadow:** frontend expects a route that doesn’t exist at that path. |
| Legacy http/client.js | frontend src/http/client.js | Throws "LEGACY_HTTP_CLIENT_DISABLED". **Dead;** not used. |
| Legacy user.api.js | frontend src/http/user.api.js | Throws in dev; deprecated. **Dead.** |
| connections aggregator getConnectionsSummary | observability/aggregators/connections.js | Called by snapshot.js and tests. **Alive but buggy** (s.socket vs s.sockets); effectively returns zero. |

---

## SECTION 9 — ABNORMALITIES & SURPRISE BEHAVIOR

1. **Connections aggregator:** Expects `s.socket` per session; sessionStore returns `s.sockets` (Set) and `primary`. So connection totals in snapshot are always 0. **Contradicts expectation** that snapshot reflects live connection count.
2. **Role change URL:** Frontend AdminPage uses setUserRole calling `POST /api/admin/users/:id/role`. Backend only mounts role change at `POST /api/admin/root/users/:id/role`. **Surprise:** non-root admin UI may show role change but request goes to wrong path (404 or 405).
3. **Admin capabilities:** All admin features are fully implemented; no disabled or placeholder capabilities.
4. **Dashboard buffer:** Uses connectionManager.getConnectionCount() (correct). Snapshot uses getConnectionsSummary (broken). So “dashboard” numbers and “snapshot” numbers can differ; snapshot connections will be 0.
5. **DOCS mention:** backend/docs/SYSTEM_CONTRACTS_MASTER.md notes latency export name mismatch (_recordLatency vs recordLatency). **Reality:** latency.js exports both; dispatcher imports recordLatency. **No runtime mismatch.**

---

## SECTION 10 — SUMMARY (NO FIXES)

### Top 10 incomplete wiring issues

1. **Role change path mismatch:** Frontend calls `POST /api/admin/users/:id/role`; backend only has `POST /api/admin/root/users/:id/role`.
2. **Root users list never called:** GET /admin/root/users has no frontend API or UI.
3. **Dashboard history unused:** GET /admin/dashboard/history has no frontend consumer.
4. **Connections aggregator wrong shape:** Uses s.socket; sessions have s.sockets (Set), so snapshot connection count is always 0.
5. **Admin capabilities:** All admin features are fully implemented; no disabled or placeholder capabilities.
6. **Export room chatId:** Confirm room messages stored with chatId format that export and getAllHistory expect.
7. **Session store getAllSessions vs connections aggregator:** Aggregator assumes one socket per session object; store has multiple sockets per session.
8. **No frontend path for root/users:** Root admin cannot list root users from current UI (no API bound).
9. **Legacy HTTP clients:** client.js and user.api.js are dead but remain in tree.
10. **Admin dashboard/stats and series:** Rely on buffer and connectionManager; snapshot path for connections is broken, so any view using snapshot for “connections” is wrong.

### Top 10 risk areas

1. **Connections aggregator (observability):** Snapshot and any consumer get zero connections; misleading for ops.
2. **Role change 404:** Admin UI may 404 when changing role if frontend path is not fixed or backend route added.
3. **Export room history:** If chatId format for rooms in DB differs from what export sends, export could return empty or wrong scope.
4. **Multiple sockets per session:** connectionManager and sessionStore support it; connections aggregator does not iterate s.sockets.
5. **Report rate limit:** 10/hour per user; abuse vector limited but present.
6. **Session revocation race:** Revoke then removeSession; if WS close is slow, client could send one more message before close. **Low impact.**
7. **Ban flow:** Sends ERROR then close(4003); connectionManager.remove then runs; double-close on same socket is safe. **No critical risk.**
8. **Dashboard buffer start():** Called at module load; if aggregators throw, sample() catches and buffer can grow. **Safe.**
9. **validateChatOwnership for room:** Depends on roomManager.isRoomMember; if room state is lost (restart), export may 403 for valid room. **Edge case.**
10. **Message store getAllHistory(chatId):** Mongo query by chatId; room messages must have chatId set consistently.

### Top 10 safest next improvements (high-level only)

1. Fix connections aggregator to iterate over session.sockets (or use connectionManager.getConnectionCount() for total).
2. Align role-change URL: either add POST /admin/users/:id/role (with same root-only logic) or have frontend call /admin/root/users/:id/role.
3. Expose root users list in frontend API and use it where root admin manages users.
4. Use or remove GET /admin/dashboard/history (document or wire to UI).
5. Admin tools are fully implemented; no simulator or metadata-only endpoints remain.
6. Verify room message chatId storage and export chatId format for rooms.
7. Remove or clearly mark legacy http client and user.api.js as deprecated.
8. Add a single test that snapshot.assembleSnapshot returns connection total consistent with connectionManager.getConnectionCount() when aggregator is fixed.
9. Document that snapshot connection metrics are currently wrong due to aggregator bug.
10. Consider unifying dashboard connection source (buffer vs connectionManager) and snapshot so one source of truth for “current connections.”

---

**End of audit. No code was modified. All findings are traceable to the files cited.**
