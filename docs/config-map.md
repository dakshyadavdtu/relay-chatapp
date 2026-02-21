# Configuration Ownership Map

**Phase 0 Baseline Documentation**  
**Last Updated:** 2026-02-03  
**Purpose:** Document all configuration files, their ownership, and access patterns.

---

## Configuration Directory Structure

```
backend/config/
├── env.js              # Environment variable loader and frozen export
├── env.validate.js     # Environment validation (fail-fast)
├── constants.js        # Centralized config values (with defaults)
└── db.js              # Database adapter (stub implementation)
```

---

## Configuration Files

### `config/env.js`

**Purpose:** Loads environment variables via `dotenv` and exports a frozen snapshot.

**Ownership:** Entry point for all environment variables.

**Exports:**
- Frozen `process.env` object (read-only)

**Dependencies:**
- `dotenv` package
- `config/env.validate.js` (runs validation before export)

**Usage Pattern:**
```javascript
require('./config/env'); // Loads and validates env vars
```

**Notes:**
- Must be required before any other config access
- Validation runs automatically on require
- Exports frozen object to prevent mutation

---

### `config/env.validate.js`

**Purpose:** Validates environment variables for type, bounds, and presence (production mode).

**Ownership:** Validation logic only. Does not export values.

**Exports:**
- `validateEnv()` function (called automatically by `env.js`)

**Validation Rules:**
- Production mode: Required vars must be present or `process.exit(1)`
- Type validation: Numeric vars checked for valid ranges
- Boolean vars: Must be exactly `"true"` or `"false"`
- String vars: Must be non-empty if set

**Failure Behavior:**
- Production missing vars: `console.error()` + `process.exit(1)`
- Invalid types/bounds: Throws `Error`
- Never logs secret values

**Notes:**
- This file defines the IMMUTABLE production environment contract
- AWS deployment correctness depends on this contract remaining stable

---

### `config/constants.js`

**Purpose:** Centralized configuration module with defaults and environment variable overrides.

**Ownership:** Single source of truth for all configurable values.

**Exports:**
- `PORT` - HTTP server port
- `JWT_COOKIE_NAME` - Cookie name for JWT
- `PROTOCOL_VERSION` - WebSocket protocol version
- `RATE_LIMIT` - Rate limiting configuration object
- `PAYLOAD` - Payload size limits
- `BACKPRESSURE` - Backpressure configuration
- `HEARTBEAT` - Heartbeat timing configuration
- `SERVER` - Server limits and timeouts
- `LOGGING` - Logging configuration
- `ROOMS` - Room management configuration

**Access Pattern:**
```javascript
const config = require('./config/constants');
const port = config.PORT;
const maxPayload = config.PAYLOAD.maxSize;
```

**Default Values:**
- All values have behavioral defaults for development
- Production mode requires explicit env vars (enforced by `env.validate.js`)

**Notes:**
- No external dependencies (uses only Node.js built-ins)
- Values can be overridden via environment variables
- Defaults are development-friendly but production requires explicit values

---

### `config/db.js`

**Purpose:** Database adapter providing async persistence for messages.

**Ownership:** Database access layer (currently stub implementation).

**Exports:**
- `persistMessage(message)` - Persist message to database
- `updateMessageState(messageId, state, userId)` - Update message state
- `getMessagesForUser(userId, options)` - Retrieve messages for user
- `getMessageById(messageId)` - Get single message by ID

**Current Implementation:**
- In-memory `Map` store (stub)
- Simulates async DB operations with delay
- Enforces idempotency via `clientMessageIdIndex`

**Allowed Callers (Architectural Rule):**
- `services/message.service.js` - Canonical message persistence
- `services/offline.service.js` - Offline message recovery (temporary)

**Forbidden Access:**
- `websocket/handlers/*` - Must delegate to services
- `websocket/state/*` - State modules must not access DB directly
- `tests/*` - Tests should not bypass services

**Notes:**
- This is a stub implementation
- In production, replace with actual database operations (MongoDB, PostgreSQL, etc.)
- All methods return Promises
- Enforces DB-first persistence invariants (Tier-0.5)

---

## Configuration Access Patterns

### Direct Environment Access

**Allowed:**
- `config/env.js` - Loads and exports env vars
- `config/env.validate.js` - Validates env vars
- `utils/jwt.js` - Reads `JWT_SECRET` at module load (fail-fast)

**Discouraged:**
- Direct `process.env` access outside config layer
- Accessing env vars before `config/env.js` is required

### Constants Access

**Pattern:**
```javascript
const config = require('./config/constants');
// Use config.PORT, config.RATE_LIMIT.maxMessages, etc.
```

**Used By:**
- `server.js` - Reads `config.PORT`
- `websocket/*` - Reads various config values
- `utils/*` - Reads config as needed

**Notes:**
- Always import from `config/constants.js`
- Never hardcode values that should be configurable
- Never access `process.env` directly when a constant exists

---

## Configuration Loading Order

1. `server.js` requires `config/env.js`
2. `config/env.js` loads `.env` via `dotenv`
3. `config/env.js` calls `env.validate.js` validation
4. `config/env.js` exports frozen `process.env`
5. `config/constants.js` reads env vars with defaults
6. Application code imports from `config/constants.js`

---

## Notes

- **🚫 DO NOT CHANGE IN PHASE 0:** This document describes current state only. No refactoring allowed in Phase 0.
- **Single Source of Truth:** `config/constants.js` is the canonical config source.
- **Validation:** `config/env.validate.js` enforces production contract.
- **Database:** `config/db.js` is currently a stub and should be replaced in production.

---

## Future Considerations (Out of Scope for Phase 0)

- Config hot-reloading
- Config file support (YAML, JSON)
- Environment-specific config files
- Config encryption for secrets
