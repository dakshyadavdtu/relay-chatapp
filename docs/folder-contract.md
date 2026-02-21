# Folder Contract

**Phase 0 Baseline Documentation**  
**Last Updated:** 2026-02-03  
**Purpose:** Document purpose of each top-level directory and explicit "DO NOT MOVE" rules.

---

## Directory Structure

```
backend/
├── config/              # Configuration modules (DO NOT MOVE)
├── docs/               # Documentation (safe to add)
├── http/               # HTTP routes and controllers (DO NOT MOVE)
├── infra/              # Infrastructure configs (safe to add)
├── models/             # Data models (DO NOT MOVE)
├── scripts/            # Utility scripts (safe to add)
├── services/           # Business logic services (DO NOT MOVE)
├── tests/              # Test files (safe to add)
├── utils/              # Utility functions (DO NOT MOVE)
├── websocket/          # WebSocket implementation (DO NOT MOVE)
├── app.js              # Express app setup (DO NOT MOVE)
├── server.js           # Entry point (DO NOT MOVE)
└── package.json        # Dependencies (DO NOT MOVE)
```

---

## Top-Level Directories

### `config/` - Configuration Modules

**Purpose:** Centralized configuration and environment variable management.

**Files:**
- `env.js` - Environment variable loader
- `env.validate.js` - Environment validation
- `constants.js` - Configuration constants
- `db.js` - Database adapter

**DO NOT MOVE:**
- These files are imported throughout the codebase
- Changing paths would break imports
- `config/env.js` is the entry point for env loading

**Allowed:**
- Adding new config files
- Adding documentation

---

### `docs/` - Documentation

**Purpose:** Project documentation, deployment guides, and baseline documentation.

**Files:**
- Various `.md` files documenting architecture, deployment, and contracts

**Safe to Modify:**
- Add new documentation files
- Update existing documentation
- No code dependencies

---

### `http/` - HTTP Routes and Controllers

**Purpose:** HTTP API routes and request handlers.

**Structure:**
```
http/
├── controllers/        # Request handlers
└── routes/            # Route definitions
```

**DO NOT MOVE:**
- Routes are registered in `app.js`
- Controllers are imported by routes
- Changing structure would break route registration

**Allowed:**
- Adding new routes/controllers
- Adding documentation

---

### `infra/` - Infrastructure Configurations

**Purpose:** Deployment configurations (PM2, systemd, nginx, AWS).

**Structure:**
```
infra/
├── aws/               # AWS configurations
├── nginx/             # Nginx configurations
└── systemd/           # systemd service files
```

**Safe to Modify:**
- Add new infrastructure configs
- Update deployment configs
- No code dependencies

---

### `models/` - Data Models

**Purpose:** Data models and state machine definitions.

**Files:**
- `Message.model.js` - Message data model
- `message.state.js` - Message state machine

**DO NOT MOVE:**
- Models are imported by services
- State machine is used by message logic
- Changing paths would break imports

**Allowed:**
- Adding new models
- Adding documentation

---

### `scripts/` - Utility Scripts

**Purpose:** Utility scripts for verification, testing, and maintenance.

**Files:**
- `verify-baseline.js` - Baseline verification script (Phase 0)

**Safe to Modify:**
- Add new scripts
- Update verification scripts
- No code dependencies (scripts are standalone)

---

### `services/` - Business Logic Services

**Purpose:** Core business logic and service layer.

**Structure:**
```
services/
├── message.service.js      # Message persistence and state
├── replay.service.js       # Message replay on reconnect
├── history.service.js      # Message history retrieval
├── redisAdapter.js        # Redis adapter (if used)
└── [other service files]
```

**DO NOT MOVE:**
- Services are imported by handlers and other services
- Changing paths would break imports
- Service layer is architectural boundary

**Allowed:**
- Adding new services
- Adding documentation

**Note:** Duplicate directories with space-separated names have been removed. Only dot-separated canonical versions remain (e.g., `message.core/`, `group.chat/`, `delivery.and.offline.semantics/`).

---

### `tests/` - Test Files

**Purpose:** Test suites for validation and regression testing.

**Files:**
- `ack-drop.test.js` - ACK-drop replay test (Tier-0.6)
- `backpressure-enforcement.test.js` - Backpressure test
- `db-idempotency.test.js` - Database idempotency test
- `rate-limit-router.test.js` - Rate limiting test

**ENFORCED IN PHASE 7:**
- Tests MUST import only `websocket/state/*` and store **public APIs**
- Tests MUST NOT import or reach into internal store Maps (e.g. `_map`, `_sessions`)
- Tests assert **behaviour**, not storage

**Safe to Modify:**
- Add new tests
- Update test files
- Tests are standalone

**Note:** Tests may import from backend, but backend should not import from tests.

---

### `utils/` - Utility Functions

**Purpose:** Shared utility functions used across the codebase.

**Files:**
- `jwt.js` - JWT verification and user extraction
- `logger.js` - Structured logging
- `cookies.js` - Cookie parsing
- `errorCodes.js` - Error code constants
- `monitoring.js` - Metrics/monitoring
- `correlation.js` - Correlation ID utilities

**DO NOT MOVE:**
- Utils are imported throughout the codebase
- Changing paths would break imports
- Utils are shared dependencies

**Allowed:**
- Adding new utilities
- Adding documentation

---

### `websocket/` - WebSocket Implementation

**Purpose:** Complete WebSocket server implementation.

**Structure:**
```
websocket/
├── connection/        # Connection lifecycle and management
├── handlers/          # Message handlers
├── protocol/          # Protocol dispatch and negotiation
├── safety/            # Safety mechanisms (rate limiting, backpressure)
├── services/          # WebSocket-specific services
└── state/             # In-memory state stores
```

**DO NOT MOVE:**
- WebSocket code is tightly coupled
- Entry point is `websocket/index.js` (imported by `app.js`)
- Changing structure would break imports
- State modules have strict ownership rules

**Allowed:**
- Adding new handlers
- Adding new state modules (following ownership rules)
- Adding documentation

**Critical Rules (ENFORCED IN PHASE 7):**
- All WebSocket runtime state must live under `websocket/state/`
- Only state modules may own Maps/Sets; Maps/Sets outside `websocket/state/` are **forbidden** (enforced by CI)
- Handlers must not own shared state
- Tests MUST use store public APIs only; tests MUST NOT reach into internal store Maps

---

## Entry Point Files

### `server.js`

**Purpose:** Application entry point.

**DO NOT MOVE:**
- Referenced in `package.json` as `main`
- Entry point for `npm start`
- Required by PM2 ecosystem config

**Responsibilities:**
- Load environment variables
- Start HTTP server
- Handle graceful shutdown

---

### `app.js`

**Purpose:** Express application setup and WebSocket attachment.

**DO NOT MOVE:**
- Imported by `server.js`
- Exports `app`, `server`, and `shutdown` function
- Central application setup

**Responsibilities:**
- Create Express app
- Register HTTP routes
- Attach WebSocket server
- Export shutdown function

---

## Explicit "DO NOT MOVE" Rules

### 1. Configuration Files
- `config/env.js` - Entry point for env loading
- `config/constants.js` - Centralized config access
- `config/env.validate.js` - Production contract validation

### 2. Entry Points
- `server.js` - Application entry point
- `app.js` - Application setup
- `websocket/index.js` - WebSocket entry point

### 3. State Modules
- `websocket/state/*` - All state must remain here
- State ownership rules depend on this location

---

## Architecture Enforcement (ENFORCED IN PHASE 7)

- **Only state owners:** `websocket/state/*` are the **only** allowed owners of runtime Maps/Sets for WebSocket state.
- **Forbidden:** Creating `new Map()` or `new Set()` elsewhere is **forbidden**. CI runs `scripts/enforce-state-ownership.js` and **fails the build** on violation.
- **Allowed exclusions:** `node_modules/**`; the enforcement script itself; explicit allowlist (legacy); in tests only, line-level `// ALLOW_MAP — TEST MOCK ONLY`.
- **Tests:** Tests MUST import store public APIs only from `websocket/state/*`. Tests MUST NOT use `new Map()`/`new Set()` or access private store variables.

---

## PHASE 7 — ARCHITECTURAL FALLBACKS

- **CI failure IS the fallback.** When `new Map()` or `new Set()` appears outside `websocket/state/*`, the enforcement script fails the build. There is no runtime recovery. Deployment MUST NOT proceed.
- **Runtime has ZERO fallback.** The application does not attempt to fix or migrate state at runtime. No try/catch recovery around state ownership. No silent degradation. If enforcement fails in CI, the build fails; the application MUST NOT start with violated code.
- **Developers recover by moving state into websocket/state/.** To fix a violation: (1) If it is runtime state, create or use a store under `websocket/state/*`, export a minimal API, update `websocket/state/index.js` and docs. (2) Fix code. (3) Re-run CI. No other recovery path is allowed.

---

## ARCHITECTURAL FALLBACKS (PHASE 7)

Phase 7 has **zero runtime fallbacks**. Failure happens at CI-time. Recovery paths are explicit. No silent degradation.

**Why CI failure is the fallback:** Runtime guessing causes partial corruption, replay inconsistency, and undebuggable bugs. CI failure is the safety mechanism. If enforcement fails, the build fails; deployment MUST NOT proceed; the application MUST NOT start with violated code.

**How developers recover safely:** See categories below. No auto-fix is allowed. Fix code, then re-run CI.

### Fallback Category 1 — CI failure on Map/Set violation

When CI detects `new Map()` or `new Set()` outside `websocket/state/*`:

- **Mandated:** CI fails immediately. Error output includes file path, line number, rule violated. No auto-fix.
- **Developer fallback:** (1) Identify intent: runtime state → move into `websocket/state/*`; test-only helper → use explicit allowlist. (2) Fix code. (3) Re-run CI. No other recovery path.

### Fallback Category 2 — Test-only state need

If tests legitimately need isolated containers:

- **Allowed:** Line-level comment `// ALLOW_MAP — TEST MOCK ONLY` on the same line (tests only). CI reports allowlisted usage distinctly.
- **Forbidden:** Disabling enforcement; using runtime stores as mocks; global test Maps without annotation.

### Fallback Category 3 — Legacy test breakage (internal Map access)

If tests fail because they accessed internal Maps:

- **Mandated:** Rewrite tests to assert **behaviour**, not storage (e.g. `hasMessage(messageId)`, `getState(messageId)`, store public APIs).
- **Forbidden:** Exposing internal Maps; adding debug getters; weakening store encapsulation.

### Fallback Category 4 — False positives (comments, strings, vendored code)

- **Allowed:** Improve scanner accuracy; add directory-level exclusions; ignore commented code safely.
- **Forbidden:** Turning warnings into passes; catching and ignoring failures; global ignore flags. Enforcement quality must improve, not be disabled.

### Fallback Category 5 — Urgent state requirement

If a hotfix seems to require new state:

- **Mandated:** (1) Create new store in `websocket/state/*`. (2) Export minimal API. (3) Update `state/index.js`. (4) Update documentation ownership list. (5) CI passes.
- **Forbidden:** Temporary Maps; inline caches; “just this once” exceptions. Architecture consistency overrides urgency.

### Fallback Category 6 — Production safety

**Phase 7 has zero runtime fallbacks.** If enforcement fails, the application MUST NOT start and deployment MUST NOT proceed. This is intentional. CI failure is the safety mechanism.

---

### 4. Service Layer
- `services/*` - Business logic boundary
- Handlers depend on service locations

### 5. Utility Functions
- `utils/*` - Shared dependencies
- Imported throughout codebase

---

## Safe to Modify

### Documentation
- `docs/` - Add or update documentation

### Infrastructure
- `infra/` - Add deployment configs

### Scripts
- `scripts/` - Add utility scripts

### Tests
- `tests/` - Add or update tests

---

## Notes

- **Phase 0 Rule:** No files may be moved or renamed in Phase 0.
- **Import Paths:** Changing directory structure breaks imports.
- **Architectural Boundaries:** Directories represent architectural layers.
- **State Ownership:** `websocket/state/` location is enforced by ownership rules.

---

## Future Considerations (Out of Scope for Phase 0)

- Consolidating duplicate directories
- Reorganizing service structure
- Moving files to improve organization
- Refactoring import paths

**All of the above are FORBIDDEN in Phase 0.**
