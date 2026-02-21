# Runtime Baseline

**Phase 0 Baseline Documentation**  
**Last Updated:** 2026-02-03  
**Purpose:** Document runtime environment, startup order, and application entry points.

---

## Node.js Version

- **Required:** Node.js 20.x
- **Tested:** Node.js v20.19.6
- **Package Manager:** npm 10.8.2

---

## Operating System Assumptions

- **Primary Target:** Linux (Ubuntu 22.04 LTS for AWS EC2)
- **Development:** macOS, Linux, Windows (with WSL)
- **File System:** Case-sensitive (Linux/macOS) or case-insensitive (Windows)

---

## Startup Order

### 1. Entry Point: `server.js`

**File:** `backend/server.js`

**Responsibilities:**
- Load environment variables via `require('./config/env')`
- Import configuration from `config/constants`
- Import application from `app.js`
- Start HTTP server on configured `PORT`
- Setup graceful shutdown handlers (SIGTERM, SIGINT)

**Execution Flow:**
```javascript
require('./config/env');           // Loads and validates env vars
const config = require('./config/constants');
const { server, shutdown } = require('./app');
server.listen(config.PORT);        // Start HTTP server
```

**Shutdown Handling:**
- Listens for `SIGTERM` and `SIGINT`
- Calls `shutdown()` from `app.js`
- Exits with code 0 on success, 1 on error

---

### 2. Application Setup: `app.js`

**File:** `backend/app.js`

**Responsibilities:**
- Create Express application
- Setup middleware (JSON parsing, URL encoding)
- Register HTTP routes (`/health`, history routes)
- Create HTTP server from Express app
- Attach WebSocket server to HTTP server
- Export `app`, `server`, and `shutdown` function

**HTTP Routes:**
- `GET /health` - Health check endpoint (returns `200 OK`)
- History routes (via `http/routes/history.routes.js`)

**WebSocket Attachment:**
- Calls `attachWebSocketServer(server)` from `websocket/index.js`
- WebSocket server handles upgrade requests on configured `WS_PATH`

**Shutdown Function:**
- Shuts down WebSocket server (if available)
- Closes HTTP server gracefully
- Returns Promise

---

### 3. WebSocket Initialization: `websocket/index.js`

**File:** `backend/websocket/index.js`

**Responsibilities:**
- Create WebSocket server instance
- Handle HTTP upgrade requests
- Setup connection lifecycle
- Register message handlers
- Setup process error handlers

**Initialization:**
- Called from `app.js` via `attachWebSocketServer(server)`
- Receives HTTP server instance
- Configures WebSocket path (default: `/ws`, configurable via `WS_PATH`)

**Public API:**
- `attachWebSocketServer(httpServer, options)` - Attach WS to HTTP server
- `shutdown()` - Graceful shutdown of WebSocket server

---

## Environment Variable Loading

**Order:**
1. `dotenv` loads `.env` file (if present)
2. `config/env.validate.js` validates variables
3. `config/env.js` exports frozen `process.env`
4. `config/constants.js` reads env vars with defaults
5. Application code uses constants

**Critical:** `config/env.js` must be required before any other config access.

---

## Process Management

### Development
```bash
npm start
# or
node server.js
```

### Production
```bash
NODE_ENV=production node server.js
# or via PM2
pm2 start ecosystem.config.js --env production
```

### Graceful Shutdown

**Signals Handled:**
- `SIGTERM` - Termination signal (e.g., from PM2, systemd)
- `SIGINT` - Interrupt signal (e.g., Ctrl+C)

**Shutdown Sequence:**
1. Stop accepting new WebSocket connections
2. Close existing WebSocket connections gracefully
3. Shutdown WebSocket server
4. Close HTTP server
5. Exit process

**Timeout:** Configurable via `WS_SHUTDOWN_TIMEOUT` (default: 10 seconds)

---

## Port Configuration

- **Default:** `3000` (development only)
- **Production:** Must be set via `PORT` environment variable
- **Validation:** Must be integer 1-65535

**Usage:**
- HTTP server listens on `PORT`
- WebSocket upgrade requests handled on `WS_PATH` (default: `/ws`)
- Health check available at `http://localhost:PORT/health`

---

## File Responsibilities

### `server.js` vs `app.js`

**`server.js`:**
- Entry point
- Environment loading
- Server startup
- Signal handling
- Process lifecycle

**`app.js`:**
- Express application setup
- HTTP route registration
- WebSocket attachment
- Application-level shutdown logic

**Separation of Concerns:**
- `server.js` = Process/Infrastructure
- `app.js` = Application/HTTP/WebSocket

---

## Architecture Enforcement (ENFORCED IN PHASE 7)

- **Only state owners:** `websocket/state/*` are the **only** canonical owners of runtime Maps/Sets for WebSocket state.
- **Forbidden:** Creating Maps/Sets elsewhere is **forbidden**. CI enforces this rule; any violation **MUST fail builds**.
- **Enforcement:** `scripts/enforce-state-ownership.js` runs in CI (no bypass). Allowed: node_modules, this script, websocket/state/**, explicit allowlist (legacy); tests only: line-level `// ALLOW_MAP — TEST MOCK ONLY`. CI reports allowlisted usage distinctly.
- **Tests:** Tests MUST use store public APIs only (e.g. `messageStore.getMessage(...)`). Tests MUST NOT use `new Map()`/`new Set()` or access private store variables. Tests assert behaviour, not storage.

---

## PHASE 7 — ARCHITECTURAL FALLBACKS

- **CI failure = fallback.** When the enforcement script detects `new Map()` or `new Set()` outside `websocket/state/*`, CI fails. There is no runtime recovery. Deployment MUST NOT proceed.
- **Runtime has zero fallback.** The application does not fix or migrate state at runtime. No try/catch recovery around state ownership. If enforcement fails in CI, the build fails; the application MUST NOT start with violated code.
- **Recovery = move state to websocket/state/.** To fix a violation: create or use a store under `websocket/state/*`, export a minimal API, update `websocket/state/index.js` and docs, fix code, re-run CI. No other recovery path.

---

## ARCHITECTURAL FALLBACKS (PHASE 7)

- **Why CI failure is the fallback:** Runtime recovery would cause partial corruption, replay inconsistency, and undebuggable bugs. CI failure is the safety mechanism. No runtime fallback exists.
- **How to recover:** See docs/folder-contract.md section “ARCHITECTURAL FALLBACKS (PHASE 7)” for category-by-category recovery (identify intent, fix code, re-run CI; or create store in websocket/state/*; or rewrite tests to assert behaviour). No auto-fix. No env flags to disable enforcement.
- **Production:** If enforcement fails, the build fails; deployment MUST NOT proceed; application MUST NOT start with violated code. Fail fast, recover safely.

---

## Dependencies

### Core Dependencies
- `express` - HTTP server framework
- `ws` - WebSocket server library
- `dotenv` - Environment variable loading

### Internal Dependencies
- `config/*` - Configuration modules
- `websocket/*` - WebSocket implementation
- `http/*` - HTTP routes and controllers
- `services/*` - Business logic services
- `utils/*` - Utility functions
- `models/*` - Data models

---

## Startup Verification

**Health Check:**
```bash
curl http://localhost:3000/health
# Expected: 200 OK
```

**WebSocket Connection:**
- Connect to `ws://localhost:PORT/WS_PATH`
- Requires valid JWT token in cookie
- Must send `HELLO` message first

---

## Notes

- **🚫 DO NOT CHANGE IN PHASE 0:** This document describes current state only.
- **Startup Order:** Must be preserved. Changing order may break initialization.
- **Environment:** Production requires all mandatory env vars (see `env-contract.md`).
- **Graceful Shutdown:** Critical for zero-downtime deployments.

---

## 🚫 Things Explicitly Not Changed in Phase 0

The following are documented AS-IS and MUST NOT be modified:

- **Startup Order:** `server.js` → `config/env.js` → `app.js` → `websocket/index.js`
- **File Responsibilities:** `server.js` handles process lifecycle, `app.js` handles application setup
- **Environment Loading:** `dotenv` loads `.env`, then `env.validate.js` validates, then `constants.js` reads
- **Port Configuration:** Default `3000` in development, required `PORT` env var in production
- **Shutdown Sequence:** SIGTERM/SIGINT → WebSocket shutdown → HTTP server close → process exit
- **Module Dependencies:** Import paths and module structure unchanged

**Phase 0 is documentation only. No runtime behavior changes.**

---

## Known Limitations

- Database adapter is stub implementation (in-memory)
- No clustering/multi-process support
- Single instance only (no horizontal scaling)
- WebSocket state is in-memory (not shared across instances)
