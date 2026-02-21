# HTTP Subsystem Architecture Contract

**PERMANENT ARCHITECTURAL LOCK** — This contract defines immutable boundaries between HTTP and WebSocket.

---

## 🟢 HTTP IS ALLOWED TO DO

### 1. Authentication Lifecycle (SOLE OWNER)
- ✅ Log users in (`POST /login`)
- ✅ Log users out (`POST /logout`)
- ✅ Create JWT tokens (ONLY place where tokens are generated)
- ✅ Set/clear HTTP-only cookies
- ✅ Verify JWT from cookies (for middleware)
- ✅ Return current user (`GET /me`)

### 2. User Discovery (STATIC DATA)
- ✅ Search users (`GET /users/search`)
- ✅ Get user profiles (`GET /users/:id`)
- ✅ Return: `userId`, `username`, `avatar`
- ✅ Query user database

### 3. Chat Metadata (STRUCTURE ONLY)
- ✅ List chats (`GET /chats`)
- ✅ Get chat details (`GET /chats/:chatId`)
- ✅ Return: `chatId`, `participants`, `unreadCount`, `lastMessage` (preview)
- ✅ Query DB for chat structure

### 4. Chat History (PERSISTENT DATA)
- ✅ Get paginated history (`GET /history?chatId=...&limit=...`)
- ✅ Query DB for historical messages
- ✅ Return messages in reverse chronological order
- ✅ Support cursor-based pagination

---

## 🔴 HTTP IS FORBIDDEN FROM DOING

### 1. Real-Time Messaging
- ❌ Send messages
- ❌ Receive messages in real-time
- ❌ Emit WebSocket events
- ❌ Broadcast to connected clients
- ❌ Push notifications

### 2. Delivery/Read State Transitions
- ❌ Mark messages as delivered
- ❌ Mark messages as read
- ❌ Update message state transitions
- ❌ Emit delivery/read acknowledgements

### 3. Presence & Typing
- ❌ Return online/offline status
- ❌ Return typing indicators
- ❌ Return last-seen timestamps
- ❌ Return presence state
- ❌ Query WebSocket connection state

### 4. Real-Time State
- ❌ Depend on in-memory WebSocket state
- ❌ Query `websocket/state/*` stores
- ❌ Access `connectionStore`, `sessionStore`, `presenceStore`
- ❌ Depend on active WebSocket connections

### 5. WebSocket Integration
- ❌ Import from `websocket/` directories
- ❌ Call WebSocket handlers
- ❌ Emit WebSocket events
- ❌ Access WebSocket server instance

---

## 📋 ARCHITECTURAL RULES

### Rule 1: HTTP Must Work Without WebSocket
- ✅ HTTP endpoints MUST work when WebSocket is disconnected
- ✅ HTTP endpoints MUST work after server restart
- ✅ HTTP endpoints MUST work after reconnect
- ✅ All HTTP data MUST come from database, not in-memory state

### Rule 2: HTTP Cannot Emit Real-Time Events
- ❌ HTTP controllers MUST NOT emit WebSocket events
- ❌ HTTP controllers MUST NOT broadcast to clients
- ❌ HTTP controllers MUST NOT push notifications
- ❌ HTTP responses are request-response only

### Rule 3: HTTP Owns Static/Persistent Data
- ✅ HTTP owns: authentication, user profiles, chat metadata, history
- ✅ HTTP queries: database only
- ✅ HTTP returns: JSON responses
- ✅ HTTP is: stateless, cacheable, RESTful

### Rule 4: WebSocket Owns Real-Time Data
- ✅ WebSocket owns: messaging, delivery/read, typing, presence
- ✅ WebSocket manages: connections, sessions, real-time state
- ✅ WebSocket emits: events, broadcasts, notifications
- ✅ WebSocket is: stateful, real-time, event-driven

---

## 🚨 ENFORCEMENT

### Code-Level Enforcement
- All HTTP controllers MUST have comments stating what they DO NOT do
- All HTTP routes MUST use `requireAuth` middleware
- All HTTP controllers MUST NOT import from `websocket/` directories
- All HTTP controllers MUST NOT emit WebSocket events

### Violation Detection
If you see any of these in HTTP code, it's a **VIOLATION**:
- `require('../websocket/')` or `require('../../websocket/')`
- `wss.emit()` or `ws.send()`
- `connectionStore`, `sessionStore`, `presenceStore` imports
- Real-time state queries
- WebSocket event emissions

### Recovery Path
If someone suggests adding real-time logic to HTTP:
1. Point to this contract
2. Explain that WebSocket owns real-time
3. Suggest implementing in `websocket/handlers/` instead

---

## 📁 FILE STRUCTURE

```
http/
├── README.md              ← This file (ARCHITECTURAL CONTRACT)
├── index.js               ← HTTP entry point (mounts all routes)
├── middleware/
│   └── auth.middleware.js ← JWT verification (HTTP-only)
├── routes/
│   ├── auth.routes.js     ← Authentication endpoints
│   ├── user.routes.js     ← User discovery endpoints
│   ├── chat.routes.js     ← Chat metadata endpoints
│   └── history.routes.js  ← Chat history endpoints
└── controllers/
    ├── auth.controller.js  ← Auth logic (token creation)
    ├── user.controller.js   ← User discovery logic
    ├── chat.controller.js   ← Chat metadata logic
    └── history.controller.js ← History query logic
```

---

## 🔗 RELATED DOCUMENTATION

- **WebSocket Protocol**: `websocket/PROTOCOL.md`
- **WebSocket Architecture**: `docs/websocket-baseline.md`
- **State Ownership**: `docs/folder-contract.md`

---

## ✅ COMPLETION CHECK

**If someone suggests adding real-time logic to HTTP, this contract explicitly forbids it.**

Examples of FORBIDDEN suggestions:
- ❌ "Add WebSocket event emission to HTTP controller"
- ❌ "Return online status in user profile endpoint"
- ❌ "Emit typing indicator from HTTP endpoint"
- ❌ "Query connectionStore in HTTP controller"
- ❌ "Broadcast message from HTTP endpoint"

**This is intentional.** HTTP is for static/persistent data. WebSocket is for real-time data.
