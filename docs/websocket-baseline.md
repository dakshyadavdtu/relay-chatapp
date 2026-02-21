# WebSocket Baseline

**Phase 0 Baseline Documentation**  
**Last Updated:** 2026-02-03  
**Purpose:** Document current WebSocket architecture, entry points, connection lifecycle, and state management.

---

## WebSocket Entry Point

**File:** `backend/websocket/connection/wsServer.js`

**Function:** `handleUpgrade(wss, request, socket, head)`

**Path:** Configured via `WS_PATH` environment variable (default: `/ws`)

**Authentication:**
- Requires JWT token in cookie (name: `JWT_COOKIE_NAME`, default: `token`)
- Token validated via `utils/jwt.js`
- User ID extracted from JWT payload
- Unauthenticated requests rejected with HTTP 401

**Connection Limits:**
- `WS_MAX_CONNECTIONS` - Global connection limit (0 = unlimited)
- `WS_MAX_CONNECTIONS_PER_USER` - Per-user limit (default: 5)
- `WS_MAX_CONNECTIONS_PER_IP` - Per-IP limit (default: 50)

---

## Connection Lifecycle

### 1. Upgrade Request

**Handler:** `websocket/connection/wsServer.js::handleUpgrade()`

**Steps:**
1. Check shutdown state (reject if shutting down)
2. Check connection limits (global, per-user, per-IP)
3. Extract JWT token from cookie header
4. Validate JWT token
5. Extract user ID from JWT payload
6. Accept upgrade and create WebSocket connection

**Rejection Reasons:**
- Server shutting down (HTTP 503)
- Maximum connections reached (HTTP 503)
- No token provided (HTTP 401)
- Invalid/expired token (HTTP 401)

---

### 2. Connection Setup

**Handler:** `websocket/connection/wsServer.js::setupConnection()`

**Steps:**
1. Store user ID on WebSocket object (`ws.userId`)
2. Store client IP address (`ws.clientIp`)
3. Register connection with `connectionManager`
4. Setup message handler (`ws.on('message')`)
5. Setup close handler (`ws.on('close')`)
6. Setup error handler (`ws.on('error')`)
7. Call `lifecycle.onConnect(userId)` for presence

**State Updates:**
- Connection registered in `connectionStore`
- Presence set to `online` via `presenceStore`
- Presence change notification emitted

---

### 3. Message Handling

**Handler:** `websocket/connection/wsServer.js::ws.on('message')`

**Flow:**
1. Generate `correlationId` (UUID) for traceability
2. Parse incoming message (JSON expected, binary rejected)
3. Route message via `protocolDispatcher.handleMessage()`
4. Router applies safety checks (rate limiting, backpressure)
5. Router dispatches to appropriate handler
6. Handler processes message and sends response

**Message Types:**
- `HELLO` - Protocol negotiation (must be first)
- `MESSAGE_SEND` - Send message to recipient
- `MESSAGE_ACK` - Acknowledge message delivery
- `MESSAGE_READ` - Mark message as read
- `RESUME` - Reconnect and replay messages
- `PING` - Heartbeat/ping
- `PRESENCE_PING` - Presence update
- Room-related messages (`ROOM_CREATE`, `ROOM_JOIN`, etc.)

---

### 4. Disconnection

**Handler:** `websocket/connection/wsServer.js::handleDisconnect()`

**Steps:**
1. Cleanup socket safety state
2. Remove connection from `connectionManager`
3. Call `lifecycle.onDisconnect(userId)` for presence
4. Remove user from rooms (if `WS_ROOM_LEAVE_ON_DISCONNECT` enabled)
5. Log disconnection event

**State Updates:**
- Connection removed from `connectionStore`
- Presence set to `offline` via `presenceStore`
- Presence change notification emitted

---

## State Storage Locations

**All in-memory state lives under:** `backend/websocket/state/`

### Core State Modules

**`connectionStore.js`**
- Maps WebSocket instances to user IDs
- Tracks active connections
- Owns: `connectionMap` (Map)

**`sessionStore.js`**
- Tracks user sessions
- Stores session metadata
- Owns: `sessionMap` (Map)

**`presenceStore.js`**
- Tracks user presence (`online`, `offline`)
- Owns: `presenceMap` (Map)
- **Single Writer Rule:** Only `lifecycle.js` may write presence

**`messageStore.js`** (MOVED IN PHASE 4 — OWNERSHIP ONLY)
- Temporary in-memory message cache
- Used for replay/reconnect
- Owns: `messageStore` (Map)

**`rateLimitStore.js`**
- Per-user rate limit tracking
- Owns: `rateLimitMap` (Map)

**`socketStateStore.js`**
- Per-socket state tracking
- Owns: `socketStateMap` (Map)

**`roomManager.js`**
- Room membership and state
- Owns: `roomMap` (Map)

**`typingStore.js`** (MOVED IN PHASE 4 — OWNERSHIP ONLY)
- Typing event rate limiting
- Owns: `buckets` (Map)

**`deliveryStore.js`** (MOVED IN PHASE 4 — OWNERSHIP ONLY)
- Per-member delivery state for room messages
- Owns: delivery tracking Map

**Architecture Enforcement (ENFORCED IN PHASE 7):**
- `websocket/state/*` are the **only** allowed owners of runtime Maps/Sets for WebSocket state.
- Creating Maps/Sets elsewhere is **forbidden**. CI runs `scripts/enforce-state-ownership.js`; any violation **MUST fail builds**.
- Tests MUST use store public APIs only; tests MUST NOT use `new Map()`/`new Set()` or access private store variables.

**ARCHITECTURAL FALLBACKS (PHASE 7):** Phase 7 has zero runtime fallbacks. CI failure is the safety mechanism. If enforcement fails, deployment MUST NOT proceed. Recovery: see docs/folder-contract.md “ARCHITECTURAL FALLBACKS (PHASE 7)”. Fail fast, recover safely.

---

## Safety Mechanisms

### Rate Limiting

**Location:** `websocket/safety/socketSafety.js`

**Enforcement:**
- Per-user message rate limiting
- Configurable via `WS_RATE_LIMIT_*` env vars
- Applied in router before handler execution

**Violation Handling:**
1. Warning threshold (80% of limit)
2. Throttling (delay messages)
3. Connection closure (max violations exceeded)

---

### Backpressure

**Location:** `websocket/safety/socketSafety.js`

**Enforcement:**
- Monitors WebSocket send queue size
- Drops messages if queue exceeds threshold
- Closes socket if queue overflows repeatedly

**Configuration:**
- `WS_BACKPRESSURE_THRESHOLD` - Queue size threshold
- `WS_BACKPRESSURE_MAX_QUEUE` - Max queue before closure
- `WS_BACKPRESSURE_BUFFERED_THRESHOLD` - Buffered bytes threshold

---

### Payload Size Limits

**Enforcement:**
- Maximum payload size: `WS_MAX_PAYLOAD_SIZE` (default: 1MB)
- Binary messages rejected
- Oversized messages rejected

---

### Heartbeat

**Location:** `websocket/connection/heartbeat.js`

**Purpose:**
- Detect dead connections
- Cleanup stale connections
- Update presence on timeout

**Configuration:**
- `WS_HEARTBEAT_INTERVAL` - Check interval (default: 30s)
- `WS_HEARTBEAT_TIMEOUT` - Timeout before marking dead (default: 60s)

**Behavior:**
- Sends ping to all connections periodically
- Marks connection as dead if no pong received
- Calls `lifecycle.onDisconnect()` on timeout

---

## Message Routing

**Location:** `backend/websocket/router.js`

**Function:** `handleIncoming(ws, message, context)`

**Flow:**
1. Safety checks (rate limiting, backpressure)
2. Parse message type
3. Route to appropriate handler
4. Handler processes and responds

**Handler Mapping:**
- `HELLO` → `helloHandler`
- `MESSAGE_SEND` → `sendMessage`
- `MESSAGE_ACK` → `deliveredAck`
- `MESSAGE_READ` → `readAck`
- `RESUME` → `reconnect`
- `PING` → `ping`
- `PRESENCE_PING` → `presence`
- Room messages → `room`
- Unknown types → `unknownType`

---

## Protocol

**Version:** `WS_PROTOCOL_VERSION` (default: `1.0.0`)

**Message Format:** JSON

**Required First Message:** `HELLO` (protocol negotiation)

**Correlation IDs:**
- Generated at WebSocket message entry
- Propagated through entire message lifecycle
- Included in all logs for traceability

---

## 🚫 What is OUT OF SCOPE in Phase 0

**DO NOT MODIFY (Documented AS-IS):**
- WebSocket connection logic (`websocket/connection/wsServer.js`)
- Message routing logic (`websocket/router.js`)
- State storage locations (`websocket/state/*`)
- Safety mechanisms (`websocket/safety/*`)
- Protocol format (JSON messages, HELLO first)
- Handler implementations (`websocket/handlers/*`)
- Connection lifecycle (`websocket/connection/lifecycle.js`)
- Presence management (`websocket/connection/presence.js`)

**Phase 0 is documentation only. No logic changes.**

---

## Notes

- **🚫 DO NOT CHANGE IN PHASE 0:** This document describes current state only.
- **State Ownership:** All state modules own their Maps/Sets. Handlers may only read or request mutations via functions.
- **Single Writer Rule:** Presence state may only be written by `lifecycle.js`.
- **Correlation IDs:** Every message has a correlation ID for end-to-end traceability.
- **Database:** Message persistence handled by `services/message.service.js`, not WebSocket layer.

---

## Known Limitations

- In-memory state (not shared across instances)
- No Redis/cluster support
- Single instance only
- Database adapter is stub (in-memory Map)
