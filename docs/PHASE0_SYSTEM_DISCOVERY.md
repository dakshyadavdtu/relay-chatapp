# Phase 0 — Full System Discovery (No Fixes)

**Mode:** Diagnosis only. No code changes.

**Scope:** WebSocket-based chat system — Node.js backend, MongoDB (Atlas), React frontend, Redux (minimal), WebSocket realtime, Admin observability.

**Source:** Repository from `z integrated frontend nayii wali copy 12.zip` (current workspace).

---

## PART 1 — BUILD THE SYSTEM MODEL

### 1) AUTHENTICATION FLOW

**End-to-end login:**
- **Frontend:** User submits credentials → `auth.api.js` `loginUserApi()` → `apiFetch('POST', '/api/login', body)` with credentials.
- **Backend:** `auth.controller.js` `login` → validates user (userStore), creates session via `sessionStore.createSession({ userId, role, userAgent?, ip? })` (Mongo: `sessions` collection), issues access + refresh tokens, sets **httpOnly cookies** (or in dev-token mode returns tokens in JSON).
- **Frontend (post-login):** Calls `getCurrentUser()` (GET /api/me) and `setAuthState({ user, status: 'authenticated' })`. Auth state is **not in Redux**; it lives in **module-level state** in `state/auth.state.js` and is consumed by React via `hooks/useAuth.js` and `subscribeAuth()`.

**Cookie vs dev token mode:**
- **Production / cookie:** Access and refresh stored in httpOnly cookies; `credentials: 'include'` on fetch; WS upgrade sends cookies automatically.
- **Dev token mode:** When `VITE_DEV_TOKEN_MODE=true`, `features/auth/tokenTransport.js` stores access/refresh in **localStorage** and sends `Authorization: Bearer <access>` on API calls; WS URL can carry token in query (see `getWsUrl` in `wsClient.js` / `config/ws.js`). No sessionStorage used for auth in current code.

**Where auth state is stored:**
- **Backend:** Session in MongoDB (`sessionStore.mongo.js` → `sessions`). In-memory session index in `sessionStore.js` (WS) used for WS upgrade and connectionManager (sessionId → sockets).
- **Browser:** Cookies (production) or localStorage (dev-token): access + refresh.
- **Redux:** Auth is **not** in Redux. Store is effectively a placeholder (`state/store.js` — single `_placeholder` reducer). Chat and auth live in React state and `auth.state.js`.

**Auth validation:**
- **HTTP:** `backend/http/middleware/auth.middleware.js` — JWT from Bearer header (dev) or from cookie; `tokenService.verifyAccess`; attaches `req.user`; checks banned via userStore.
- **WebSocket:** `backend/websocket/connection/wsServer.js` — on upgrade: token from cookie or query (dev); `tokenService.verifyAccess`; session lookup `authSessionStore.getSession(sessionId)`; if session missing/revoked/banned, reject with 401; then `connectionManager.register(userId, ws, sessionId)` and `connectionStore.setSocketUser/setSocketSession`.

**On refresh:**
- **Auth:** Frontend runs `runAuthInitOnce` (e.g. in `useAuth`): calls `getCurrentUser()` (GET /api/me). If cookies/token valid, user is restored and `setAuthState({ user, status: 'authenticated' })`. If 401, refresh is attempted (e.g. `lib/http.js` → POST /api/auth/refresh); if refresh fails, auth state set to logged-out.
- **WS:** After auth, wsClient connects (e.g. when `getAuthState().status === 'authenticated'`); HELLO → HELLO_ACK; then ROOM_LIST requested, RESUME, presence ping. So on refresh: auth is re-established via /me (and refresh if needed), then WS reconnects and directory is re-fetched (ROOM_LIST / ROOMS_SNAPSHOT).

**File references:**  
`myfrontend/frontend/src/http/auth.api.js`, `state/auth.state.js`, `hooks/useAuth.js`, `features/auth/tokenTransport.js`, `backend/http/controllers/auth.controller.js`, `backend/http/middleware/auth.middleware.js`, `backend/websocket/connection/wsServer.js`, `backend/auth/sessionStore.mongo.js`, `backend/auth/tokenService.js`.

---

### 2) WEBSOCKET LIFECYCLE

**Full lifecycle:**
- **Connect:** Frontend `wsClient.connect()` builds URL (`getWsUrl` — with cookie or query token in dev), creates `WebSocket`; on `open` sends **HELLO** (with optional sessionId / lastSeenMessageId). Backend `helloHandler` validates auth (already done at upgrade), then `connectionManager.register(userId, ws, sessionId)` and **HELLO_ACK** is sent. So HELLO/HELLO_ACK occur **after** upgrade and register.
- **ConnectionManager registration:** `connectionManager.register(userId, socket, sessionId)` — creates or attaches socket to session in `sessionStore` (multiple sockets per session allowed up to MAX_SOCKETS_PER_SESSION); `connectionStore.setSocketUser/setSocketSession`; `_attachCloseAndHeartbeat(userId, sessionId, socket)` (close handler + heartbeat). On first connection for user, `lifecycle.onConnect(userId)` runs (presence → online).
- **Presence online/offline:** `lifecycle.onConnect(userId)` sets presence online and `presenceNotifier.notifyPresenceChange(userId, 'online', previousStatus)` (broadcasts **PRESENCE_UPDATE** to other users). On disconnect: socket `close` fires → `sessionStore.markOffline(sessionId, socket)`, `connectionStore.deleteSocketUser(socket)`; if `getSockets(userId).length === 0`, `lifecycle.onDisconnect(userId)` runs: sets presence offline, then `presenceNotifier.notifyPresenceChange(userId, 'offline', previousStatus)`. So **PRESENCE_OFFLINE** is the transition event name in logger; wire protocol sends **PRESENCE_UPDATE** with `status: 'offline'`.
- **Cleanup path:** One socket close → `markOffline` removes socket from session's Set; `deleteSocketUser(socket)`; if no remaining sockets for that user, `onDisconnect(userId)` and transition CONNECTION_CLOSE. `cleanup(userId, sessionId, ws, reason)` is used for forced removal (revoke, evict) and also closes the socket, so both `close` event and explicit `cleanup()` can run; idempotent guard in `onDisconnect` (already offline and activeConnectionCount === 0 → return) limits duplicate presence work.

**Who owns connection state:**  
**connectionManager** (and its dependencies **sessionStore**, **connectionStore**) own all live WebSocket connections and session→socket mapping. **lifecycle** owns presence transitions; **presenceStore** holds current presence per user; **presenceNotifier** broadcasts PRESENCE_UPDATE.

**Connections per user:**  
Multiple sockets per user and per session are allowed (multi-tab). Session store has `MAX_SOCKETS_PER_SESSION`; over limit evicts oldest socket (4002 "Too many tabs").

**What triggers PRESENCE_OFFLINE (i.e. going offline):**  
When the **last** socket for a user is removed (socket close or forced cleanup), `lifecycle.onDisconnect(userId)` runs: presence set to offline, then `notifyPresenceChange(userId, 'offline', …)`.

**File references:**  
`myfrontend/frontend/src/transport/wsClient.js`, `backend/websocket/connection/wsServer.js`, `backend/websocket/connection/connectionManager.js`, `backend/websocket/connection/lifecycle.js`, `backend/websocket/connection/presence.js`, `backend/websocket/state/sessionStore.js`, `backend/websocket/state/connectionStore.js`, `backend/websocket/protocol/helloHandler.js`.

---

### 3) MESSAGE FLOW

**Send from frontend:**  
UI sends via adapter → `wsClient.sendMessage({ recipientId, content, clientMessageId })` (DM) or `sendRoomMessage` (room). Payload goes over WebSocket as MESSAGE_SEND or ROOM_MESSAGE.

**Backend handler:**  
- **DM:** Router → `sendMessage.handleMessageSend(ws, payload)` → `messageService.acceptIncomingMessage` then `messageService.persistAndReturnAck` (backend `services/message.service.js`). Persist is DB-first (dbAdapter.persistMessage); then delivery logic (delivery.trigger / sendToUserSocket) sends **MESSAGE_RECEIVE** to recipient sockets and **MESSAGE_ACK** to sender.
- **Room:** ROOM_MESSAGE handler → roomManager + message persistence for room; broadcast to room members (roomManager.broadcastToRoom / message.service).

**DB write:**  
Messages are persisted in MongoDB via `dbAdapter` / message store before ACK and delivery. `message.service.js` is the single place for persist and state transitions (SENT → DELIVERED → READ).

**Broadcast / receive:**  
Recipient’s sockets get **MESSAGE_RECEIVE** (or **ROOM_MESSAGE** for rooms) via `sendToUserSocket` / room broadcast. Frontend `wsClient` receives the frame and pushes to listeners; **ChatAdapterContext** handles **MESSAGE_RECEIVE** (and ROOM_MESSAGE) in its message handler and updates **React state** (`setMessagesByConversation`), not Redux.

**Where incoming messages should update UI:**  
In **ChatAdapterContext.jsx**: on `MESSAGE_RECEIVE` (and ROOM_MESSAGE, MESSAGE_ACK, etc.) the handler updates `messagesByConversation` (and unread counts, etc.). Components (e.g. ChatWindow, Sidebar) read from context (useChatStore) so they should re-render when state updates.

**Why other browsers need refresh:**  
If the **other** browser/tab never receives the **MESSAGE_RECEIVE** (or ROOM_MESSAGE) event — e.g. WS not connected, or backend not broadcasting to that socket, or frontend not subscribed to the same wsClient listener — then that client’s React state is never updated. Refresh triggers re-auth, reconnect, and often a RESUME/MESSAGE_REPLAY or ROOM_LIST that repopulates messages from server, so messages “appear after refresh.” Root cause is therefore **delivery path to that client** (WS connection or broadcast targeting), not necessarily DB or persist.

**File references:**  
`myfrontend/frontend/src/features/chat/adapters/ChatAdapterContext.jsx` (send paths, handleMessage, MESSAGE_RECEIVE/ROOM_MESSAGE), `myfrontend/frontend/src/transport/wsClient.js`, `backend/websocket/handlers/sendMessage.js`, `backend/websocket/router.js`, `backend/services/message.service.js`, `backend/websocket/services/message.service.js` (sendToUserSocket), `backend/services/delivery.trigger.js` (or equivalent delivery path).

---

### 4) CONVERSATION / GROUP MODEL

**How conversations/groups are created:**  
- **Rooms:** Backend `websocket/handlers/room.js` handles **ROOM_CREATE** (payload: name, thumbnailUrl, memberIds, optional roomId). `roomManager.createRoom(roomId, userId, { name, thumbnailUrl })` creates in-memory room (and persists via `roomStore.upsertRoom`). Then members are added via `roomManager.joinRoom`. Backend broadcasts **ROOM_MEMBERS_UPDATED** to the room and returns **ROOM_CREATED** to creator with full snapshot.
- **DM:** No explicit “create conversation” message; first message or sidebar “direct chat” selection implies a conversation (chatId = directChatId(sender, recipient)).

**How sidebar list is populated:**  
- **Rooms:** Frontend gets list from **ROOMS_SNAPSHOT** (e.g. after RESUME in reconnect flow — `reconnect.js` sends `roomManager.listRoomsForUser(userId)`) or from **ROOM_LIST_RESPONSE** (after HELLO_ACK frontend sends ROOM_LIST; backend `handleRoomList` returns `roomManager.listRoomsForUser(userId)`). ChatAdapterContext merges both into `roomsById` and `roomIds`; sidebar uses `roomIds` and `roomsById` (and membersByRoomId, usersById) from context.
- **Direct chats:** From `apiChats` (HTTP GET /api/chats) and/or from message traffic; `directChats` derived from context.

**What event should cause a new group to appear:**  
- For **creator:** **ROOM_CREATED** (response to ROOM_CREATE) adds the room to `roomsById` / `roomIds` with name from `room.meta`.
- For **other members:** They should receive **ROOM_MEMBERS_UPDATED** (broadcast to room when they’re added). That event is handled in ChatAdapterContext and adds/updates the room in `roomIds`/`roomsById` and members.

**Why group name is missing initially:**  
**ROOM_MEMBERS_UPDATED** handler in ChatAdapterContext (lines ~651–676) updates `roomsById[roomId]` with **only** `version`, `updatedAt`, and members/roles — it does **not** set `name` (or thumbnailUrl). So when a user is added to a new room, they get the room in the list but without meta. Name comes from **ROOM_LIST_RESPONSE** or **ROOMS_SNAPSHOT** (which use `roomManager.listRoomsForUser` and include `room.meta.name`). So until the client requests ROOM_LIST again (or gets ROOMS_SNAPSHOT on reconnect), or receives ROOM_INFO_RESPONSE for that room, **name** stays undefined. After refresh, ROOM_LIST or ROOMS_SNAPSHOT fills names.

**File references:**  
`backend/websocket/handlers/room.js` (ROOM_CREATE, ROOM_LIST, getRoomSnapshot, listRoomsForUser), `backend/websocket/state/roomManager.js`, `myfrontend/frontend/src/features/chat/adapters/ChatAdapterContext.jsx` (ROOMS_SNAPSHOT, ROOM_LIST_RESPONSE, ROOM_CREATED, ROOM_MEMBERS_UPDATED, ROOM_INFO_RESPONSE), `myfrontend/frontend/src/features/chat/ui/Sidebar.jsx`.

---

### 5) ADMIN OBSERVABILITY

**Online users count:**  
- **Dashboard buffer (timeseries):** `adminDashboardBuffer.js` samples `connectionManager.getConnectionCount()` — this is **correct** (iterates `sessionStore.getAllSessions()` and counts live sockets from `s.sockets`).
- **Snapshot (admin dashboard snapshot):** `snapshot.js` calls `connectionsAggregator.getConnectionsSummary(null, isAdmin)`. The **connections aggregator** (`observability/aggregators/connections.js`) iterates `sessionStore.getAllSessions()` but uses **`s.socket`** (singular) to check if the connection is live. Sessions actually have **`s.sockets`** (a Set). So `s.socket` is always undefined, `isSocketLive(ws)` is false for every session, and the aggregator returns **total: 0** (and zero counts by role). So **admin dashboard snapshot** shows 0 connections; timeseries may show correct value if it only uses `connectionManager.getConnectionCount()`.

**Messages/sec:**  
Comes from **messages aggregator** (`observability/aggregators/messages.js`), which uses `trackPersistedMessageTimestamp`-driven data (message.service writes after persist). Dashboard buffer reads `messagesAggregator.getMessagesSummary(null).messagesPerSecond`.

**How snapshot is assembled:**  
`snapshot.js` `assembleSnapshot(capabilities)` calls: connections aggregator, messages aggregator, latency aggregator; validates; builds overview/network/events/state. On any aggregator exception or invalid result it returns `SAFE_EMPTY_SNAPSHOT`. So when connections aggregator returns `{ total: 0 }` due to the bug, snapshot still assembles but with 0 connections.

**Dependency on connectionManager:**  
Timeseries/buffer uses `connectionManager.getConnectionCount()` (correct). Snapshot uses **connections aggregator**, which uses **sessionStore** directly but with wrong property (`s.socket` instead of `s.sockets`), so snapshot metrics are wrong regardless of connectionManager state.

**File references:**  
`backend/observability/adminDashboardBuffer.js`, `backend/observability/aggregators/connections.js`, `backend/observability/snapshot.js`, `backend/websocket/state/sessionStore.js` (`getAllSessions` returns objects with `sockets`).

---

## PART 2 — REPRODUCE AND EXPLAIN CURRENT FAILURES

### A) Login in tab2 logs out tab1 after refresh

- **Layer:** Auth state + token/session model; possibly session revocation or single-session assumption.
- **What breaks:** Tab1’s auth state or session is invalidated when tab2 logs in. Possibilities: (1) Backend or frontend treats “login” as “replace session” and revokes previous sessions (e.g. logout-all on login), so tab1’s cookie/session becomes invalid; on refresh tab1 calls GET /api/me and gets 401 → frontend sets auth to logged-out. (2) Or token storage (e.g. localStorage in dev-token mode) is shared; tab2 overwrites tokens and tab1 still holds old refs until refresh, then tab1 uses new token that might be tied to a different session or tab2’s session list, and /me fails for tab1. (3) Or backend allows multiple sessions but something (e.g. refresh rotation, or single-session cookie) makes only one session valid at a time.
- **Why it used to partially work:** If previously only one tab was used, or sessions were not revoked on login, tab1 would keep a valid session until it expired or was explicitly revoked.

### B) Messages appear only after refresh in other browser

- **Layer:** WebSocket delivery / frontend listener.
- **What breaks:** The other browser’s client either (1) is not connected (WS not open or reconnect failed), (2) is not in the set of sockets the backend broadcasts to for that recipient/room, or (3) does not handle MESSAGE_RECEIVE/ROOM_MESSAGE in a way that updates the visible list (e.g. listener not attached, or conversationId mismatch). So the message is persisted and sent to the sender’s sockets, but the recipient’s UI is not updated until they refresh and refetch (RESUME/replay or ROOM_LIST + history).
- **Why it used to partially work:** In single-tab or same-browser scenarios, the sender’s tab gets MESSAGE_ACK and the recipient’s tab is the same process or reliably receives the same WS stream; or RESUME was requested often enough that messages appeared on next sync.

### C) Group name invisible until refresh

- **Layer:** Frontend handling of ROOM_MEMBERS_UPDATED vs ROOM_LIST/ROOMS_SNAPSHOT.
- **What breaks:** When a user is added to a room, they receive **ROOM_MEMBERS_UPDATED** (broadcast). ChatAdapterContext updates `roomsById[roomId]` with version, updatedAt, members, roles — but **does not set `name`** (or thumbnailUrl). Name is only set from **ROOM_LIST_RESPONSE**, **ROOMS_SNAPSHOT**, **ROOM_CREATED**, or **ROOM_INFO_RESPONSE**. So the new member sees the room in the list with no name until they get a ROOM_LIST/ROOMS_SNAPSHOT (e.g. on refresh) or ROOM_INFO for that room.
- **Why it used to partially work:** If the user refreshed after being added, or the app requested ROOM_LIST/ROOM_INFO soon after, names would appear.

### D) PRESENCE_OFFLINE spam + stack overflow

- **Layer:** Backend lifecycle and/or frontend handling of presence.
- **What breaks:** (1) **Backend:** The same user can be transitioned to offline more than once — e.g. when a socket is closed and also explicitly cleaned up (revoke/evict), both the `close` handler and `cleanup()` may run; `onDisconnect` has an idempotent guard (already offline + no connections → return), but transition logging and `notifyPresenceChange` might still run on duplicate exit paths, producing many PRESENCE_UPDATE(offline) or log lines. (2) **Frontend:** A flood of PRESENCE_UPDATE messages could cause many setState updates (setPresenceByUserId) and re-renders; if any effect reconnects or triggers more presence traffic, that could amplify. (3) **Stack overflow:** Could be from recursive frontend effect (e.g. on presence change → do something → trigger another presence update) or from backend recursion (e.g. inside notifyPresenceChange or getConnectedUsers); evidence not fully traced here.
- **Why it used to partially work:** With a single tab and clean close, onDisconnect runs once; with multi-tab or revoke flows, duplicate cleanup paths can cause repeated offline notifications.

### E) Admin dashboard stuck at 0

- **Layer:** Observability aggregator (connections).
- **What breaks:** `observability/aggregators/connections.js` uses **`s.socket`** to get the WebSocket for each session. `sessionStore.getAllSessions()` returns objects with **`sockets`** (a Set of sockets), not `socket`. So `ws = s.socket` is always undefined, `isSocketLive(ws)` is false for every session, and the loop never increments `total` (or role counts). The snapshot (and any UI that reads from this aggregator) therefore shows 0 connections. The dashboard **buffer** uses `connectionManager.getConnectionCount()`, which correctly iterates `s.sockets`, so timeseries could show non-zero if the UI reads from the buffer; if the UI reads from the same snapshot that uses the aggregator, it stays at 0.
- **Why it used to partially work:** If the dashboard previously used only `connectionManager.getConnectionCount()` or a different code path that used `s.sockets`, it would have shown correct counts.

### F) "Not authorized to mark this message as read"

- **Layer:** Backend read-ack authorization (message.service / readAck handler).
- **What breaks:** `readAck.handleMessageRead` (and `message.service.confirmReadAndReturnAck` / markRead) require **message.recipientId === userId** (the requester must be the **recipient** of the message). So if the frontend sends MESSAGE_READ with a messageId for which the current user is the **sender** (or a different user), the backend returns NOT_AUTHORIZED. For **room messages**, the persisted message may have `recipientId` set to a specific user (or null/roomId); if the model uses recipientId only for DMs and room messages use roomId, then room read-acks could be sent with a messageId that has recipientId !== current user (or missing), causing this error. So either: (1) frontend sends read for the wrong message (e.g. conversation mix-up), or (2) room messages are stored with a single recipientId and the read-ack check does not allow “any room member” as reader.
- **Why it used to partially work:** For DMs, only the recipient marks as read, so in pure DM flows the check passes; room or mixed flows expose the mismatch.

### G) Admin panel refresh on login

- **Layer:** Frontend routing / auth state / admin guard.
- **What breaks:** After login, the app may navigate to admin or load admin data; something in the flow (e.g. auth state update, role fetch, or admin API call) triggers a full page refresh or a remount that clears admin panel state. Possibilities: (1) Admin route or component depends on auth/role and re-runs a “redirect if not admin” or “fetch admin data” effect that does a hard redirect or reload. (2) Token/cookie change on login causes a global reload (e.g. some frameworks or auth libs reload on auth change). (3) Admin dashboard fetches snapshot/timeseries and the response or error handling causes a navigation/refresh. Exact trigger not confirmed without repro.
- **Why it used to partially work:** If admin was not used right after login, or auth flow didn’t trigger the same effect, the refresh would not be noticed.

---

## PART 3 — STORAGE AUDIT (MONGODB)

### 1) Which entities are currently persisted?

- **Users:** Yes — user store (e.g. MongoDB collection) for login, profile, roles, ban state. Referenced by auth controller, userStore, admin.
- **Messages:** Yes — message store / dbAdapter (e.g. `message.mongo.js` or equivalent) for DM and room messages; message.service writes before ACK and delivery.
- **Conversations/groups (rooms):** Yes — `room.store` (roomManager) persists room records (id, meta, members, roles, joinedAtByUser, version, updatedAt) via `roomStore.upsertRoom`; roomManager loads at startup with `loadFromStore()`.
- **Sessions:** Yes — `sessionStore.mongo.js` (auth sessions) for HTTP auth and refresh; collection `sessions`. WebSocket session state (sessionId → sockets) is in-memory in `sessionStore.js` (WS), not persisted.
- **Presence:** No — presence is only in-memory (`presenceStore.js`). No DB write on online/offline.

### 2) Which things exist only in memory?

- WebSocket connection state: sessionStore (WS) and connectionStore (socket → userId, sessionId).
- Presence: presenceStore (userId → status).
- Per-session WS state: lastSeenMessageId, lastSentMessageId, protocol version (in sessionStore).
- Message cache/dedup in message.service (clientMessageIdMap, messageStore Map) — optional performance cache; DB is source of truth.
- Observability: admin buffer, aggregator caches, activity buffers (unless explicitly persisted elsewhere).

### 3) What happens after backend restart?

- **Users, messages, rooms, auth sessions:** Remain in MongoDB; reloaded on startup (e.g. roomManager.loadFromStore(), auth sessionStore from DB).
- **Presence:** All users appear offline until they reconnect and HELLO → onConnect sets them online again.
- **WS connections:** All dropped; clients must reconnect (HELLO, ROOM_LIST, RESUME, etc.).
- **Admin dashboard:** After restart, connection count goes to 0 until clients reconnect; snapshot aggregator bug (s.socket) would still show 0 even after reconnections until that bug is fixed.

### 4) Are current issues from in-memory loss, missing persistence, or event propagation?

- **A (tab2 login logs out tab1):** Likely **session/token contract** or revocation policy, not persistence or propagation.
- **B (messages only after refresh):** **Event propagation / delivery** — message is persisted and sent; the other client either doesn’t get the event or doesn’t apply it to UI.
- **C (group name missing):** **Event propagation / payload contract** — ROOM_MEMBERS_UPDATED does not carry name; frontend doesn’t request ROOM_INFO when it sees a new room without name.
- **D (PRESENCE_OFFLINE spam / stack overflow):** **Lifecycle/cleanup** (duplicate onDisconnect paths) and/or **frontend handling** of presence flood; not persistence.
- **E (admin stuck at 0):** **Bug in aggregator** (wrong property s.socket vs s.sockets); not persistence or propagation.
- **F (not authorized to mark read):** **Authorization rule** (recipientId check) and possibly **room vs DM model**; not persistence.
- **G (admin refresh on login):** **Frontend auth/navigation** behavior; not persistence.

---

## PART 4 — OUTPUT FORMAT

### 1) System Architecture Diagram (Text)

```
[Browser Tab 1]  [Browser Tab 2]  ...  [Admin Dashboard]
       |                 |                      |
       v                 v                      v
  React + useAuth   React + useAuth         React + Admin API
  auth.state.js    auth.state.js           (GET /api/admin/...)
  (no Redux auth)  (no Redux auth)              |
       |                 |                      |
       +--------+--------+                      |
                |                              |
                v                              v
         apiFetch (HTTP)                 auth.middleware
         cookies / Bearer                requireAdmin
                |                              |
                v                              v
         [Node HTTP Server]  <----------  [Admin Controller]
                |                 GET /dashboard, /timeseries, etc.
                |                 snapshot.assembleSnapshot()
                |                 connections aggregator (broken: s.socket)
                |                 connectionManager.getConnectionCount() (ok)
                |
                v
         [MongoDB]
         users, sessions (auth), messages, rooms
                |
         [WebSocket Server] (same process)
         wsServer upgrade → auth → connectionManager.register
                |
         sessionStore (in-memory: sessionId → { sockets Set, userId })
         connectionStore (in-memory: ws → userId, sessionId)
         lifecycle.onConnect / onDisconnect → presenceStore, presenceNotifier
                |
         Router → sendMessage, room, readAck, reconnect, helloHandler
                |
         message.service (persist + ACK + delivery)
         roomManager (rooms + broadcast)
         sendToUserSocket / broadcastToRoom
                |
                v
         [Browser] wsClient onmessage → ChatAdapterContext handleMessage
         messagesByConversation, roomsById, roomIds (React state, not Redux)
         Sidebar, ChatWindow read from useChatStore()
```

**Data flow summary:**  
Auth: cookies/localStorage → HTTP/WS auth → session (DB + in-memory WS index). Messages: UI → WS → handler → message.service (DB) → broadcast → other clients’ wsClient → ChatAdapterContext → React state. Rooms: roomManager (in-memory + room.store DB) → ROOM_LIST/ROOMS_SNAPSHOT/ROOM_MEMBERS_UPDATED → ChatAdapterContext. Admin: connectionManager + aggregators (connections bug) + message/latency aggregators → snapshot → admin API → dashboard.

---

### 2) Data Ownership Table

| Component | Owns | Source of truth |
|-----------|------|------------------|
| auth.controller + sessionStore (Mongo) | Auth sessions (create, refresh, revoke) | MongoDB `sessions` |
| tokenTransport (frontend) | Access/refresh in cookie or localStorage | Browser |
| auth.state.js + useAuth | Current user + auth status in process | Module state + React |
| connectionManager + sessionStore (WS) + connectionStore | Live WS connections (socket ↔ user/session) | In-memory |
| lifecycle + presenceStore | Presence (online/offline) | In-memory |
| message.service + dbAdapter | Message persistence and state (SENT/DELIVERED/READ) | MongoDB + in-memory cache |
| roomManager + roomStore | Room membership, meta, version | MongoDB + in-memory Maps |
| ChatAdapterContext | messagesByConversation, roomsById, roomIds, presenceByUserId, etc. | React state (per tab) |
| Redux store | (placeholder only) | N/A for chat/auth |
| observability (buffer + aggregators) | Connection/message/latency metrics | In-memory; snapshot uses connections aggregator (bug) |

---

### 3) Failure Root Cause Map

| ID | Failure | Root cause (layer) | Inconsistent state |
|----|--------|--------------------|---------------------|
| A | Tab2 login logs out tab1 on refresh | Auth/session: revocation or token overwrite on login | Tab1’s session/token invalid; auth.state or /me returns unauthenticated |
| B | Messages only after refresh in other browser | WS delivery or frontend listener not updating UI for that client | Other client’s messagesByConversation not updated by MESSAGE_RECEIVE |
| C | Group name invisible until refresh | ROOM_MEMBERS_UPDATED does not include name; frontend doesn’t request ROOM_INFO | roomsById[roomId].name undefined until ROOM_LIST/ROOMS_SNAPSHOT/ROOM_INFO |
| D | PRESENCE_OFFLINE spam + stack overflow | Duplicate onDisconnect and/or frontend presence handling / recursion | Many PRESENCE_UPDATE(offline) or re-renders/effects; possible stack overflow in effect chain |
| E | Admin dashboard stuck at 0 | connections aggregator uses s.socket instead of s.sockets | Snapshot connection total/counts always 0 |
| F | Not authorized to mark this message as read | readAck requires message.recipientId === userId; room messages or wrong messageId | Frontend or room model sends read for message where user is not recipient |
| G | Admin panel refresh on login | Frontend auth/navigation effect after login | Admin route or data fetch triggers full reload or remount |

---

### 4) Missing or Weak Contracts Between Backend and Frontend

- **ROOM_MEMBERS_UPDATED:** Backend sends members/roles/version but frontend expects name in same event or must request ROOM_INFO; contract does not require server to include meta (name, thumbnailUrl) in ROOM_MEMBERS_UPDATED, and frontend does not request ROOM_INFO when name is missing.
- **Presence:** Backend sends PRESENCE_UPDATE (userId, status, previousStatus); frontend updates presenceByUserId. No contract on rate or ordering; flood of updates can cause many setState calls.
- **Multi-tab / multi-session:** Backend allows multiple sessions and multiple sockets per session; frontend auth and token storage (especially dev-token in localStorage) may not be multi-tab safe (e.g. tab2 login overwriting tokens and tab1 not re-reading until refresh).
- **Read-ack for rooms:** Backend markRead checks message.recipientId === userId; for room messages the stored message shape (recipientId vs roomId) and who may call MESSAGE_READ are not clearly defined in a single contract.
- **Admin snapshot:** Frontend expects non-zero connection counts when users are connected; backend snapshot uses an aggregator that reads wrong property (s.socket), so contract “dashboard shows live connection count” is broken on backend.
- **HELLO_ACK → ROOM_LIST:** Frontend sends ROOM_LIST after HELLO_ACK; backend returns ROOM_LIST_RESPONSE with rooms from listRoomsForUser. Contract is clear; if ROOM_LIST is not sent or response is lost, directory stays empty until next request or ROOMS_SNAPSHOT (e.g. on reconnect).

---

### 5) UNKNOWNs to Confirm Before Fixing

- **A:** Does backend explicitly revoke other sessions (or all sessions) on login? Is there a “single session per user” or “logout others on login” flag or code path?
- **A:** In dev-token mode, does tab2’s login overwrite localStorage tokens used by tab1, and does tab1 re-read tokens before next /me or only on refresh?
- **B:** For the “other browser” case: is that client’s WebSocket actually open and subscribed to the same wsClient message listener? Is the backend sending MESSAGE_RECEIVE to that client’s socket(s) (e.g. sendToUserSocket or room broadcast includes that socket)?
- **D:** Exact reproduction for stack overflow: backend-only (e.g. recursive call in notifyPresenceChange/getConnectedUsers) or frontend-only (effect that triggers WS send that triggers more presence), or both?
- **D:** When multiple tabs close, does each socket close trigger a separate onDisconnect, or does idempotent guard prevent all but the first? (Confirm order: markOffline then getSockets so remaining count is correct.)
- **F:** For room messages, how is recipientId set in the persisted message (same as sender, roomId, or null)? Does the frontend send MESSAGE_READ for room messages with the same messageId as stored, and who is the intended “reader” (any member vs only one)?
- **G:** Exact navigation/auth flow after login: which component or effect causes the admin panel to refresh (route guard, auth callback, admin data fetch, or token storage listener)?

---

**End of Phase 0 — Full System Discovery.** No fixes applied; diagnosis only.
