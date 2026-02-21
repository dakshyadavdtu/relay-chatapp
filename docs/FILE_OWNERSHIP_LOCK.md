# File-Level Ownership Lock — Permanent Architectural Rules

**STATUS: LOCKED** — This document defines immutable file-level ownership rules.

---

## 🎯 0.1 — DB Adapter Ownership (LOCKED)

### ✅ Allowed DB Adapter Callers

Only these files may import or call `backend/config/db.js`:

1. **`backend/services/message.service.js`** — REQUIRED
   - Canonical message persistence, state transitions, ACK generation

2. **`backend/services/message.store.js`** — ALLOWED
   - Read-only wrapper around dbAdapter for message reads
   - Provides service-level API for controllers/handlers

3. **`backend/services/replay.service.js`** — ALLOWED WITH REVIEW
   - Replay logic for undelivered messages
   - Performs replay-specific DB operations

4. **`backend/services/offline.service.js`** — ALLOWED WITH REVIEW
   - Offline message recovery (temporary)

### ❌ Forbidden Areas

These areas MUST NEVER import or call `backend/config/db.js`:

- ❌ `backend/http/controllers/*` — Use `messageStore` or `messageService` APIs
- ❌ `backend/websocket/handlers/*` — Delegate to services
- ❌ `backend/websocket/services/*` — Use canonical `services/message.service.js`
- ❌ `backend/websocket/safety/*` — Use service-layer APIs
- ❌ `backend/websocket/state/*` — State stores must not access DB
- ❌ `backend/tests/*` — Use service APIs or test helpers

### 🔒 Enforcement

- **Violations Fixed:**
  - ✅ `http/controllers/chat.controller.js` — Now uses `messageStore`
  - ✅ `services/history.service.js` — Now uses `messageStore`
  - ✅ `websocket/services/message.service.js` — Now uses `messageStoreService`
  - ✅ `websocket/safety/backpressure.js` — Now uses `messageStoreService`

- **Documentation:**
  - ✅ `docs/DB_OWNERSHIP_LOCK.md` — Complete enforcement rules
  - ✅ `docs/MIGRATION_CHECKLIST.md` — Updated with allowed list

See: `docs/DB_OWNERSHIP_LOCK.md` for complete rules and violation patterns.

---

## 🎯 1.3 — State Ownership (ENFORCED)

### ✅ Allowed Map/Set Locations

Only these locations may contain `new Map()` or `new Set()`:

1. **`backend/websocket/state/*`** — Canonical state stores
   - `messageStore.js`, `presenceStore.js`, `sessionStore.js`, etc.

2. **Allowlisted Files** (legacy/service-local):
   - `config/db.js` — In-memory DB simulation
   - `services/message.service.js` — Service-local deduplication maps
   - `utils/logger.js`, `utils/monitoring.js` — Utility maps
   - Service implementation files (documented, service-local caches)

### ❌ Forbidden Areas

- ❌ `backend/http/*` — HTTP must not create Maps/Sets (use state stores)
- ❌ `backend/websocket/handlers/*` — Handlers must use state stores
- ❌ New code outside `websocket/state/` — Must use existing stores

### 🔒 Enforcement

- **Script:** `scripts/enforce-state-ownership.js` — CI enforcement
- **CI Integration:** Runs in `npm test` pipeline
- **Violation Detection:** Fails build on `new Map()`/`new Set()` outside allowed areas

See: `scripts/enforce-state-ownership.js` for enforcement logic.

---

## 🎯 1.4 — Presence/Session Lifecycle (LOCKED)

### ✅ Allowed Writers

Only these modules may write to presence/session stores:

1. **`backend/websocket/connection/connectionManager.js`** — PRIMARY WRITER
   - Creates sessions (`sessionStore.createSession`)
   - Updates presence (`presenceStore.markOnline`, `markOffline`)
   - Manages socket lifecycle

2. **`backend/websocket/connection/wsServer.js`** — Via connectionManager
   - Delegates to connectionManager for all writes

### ❌ Forbidden Writers

- ❌ `backend/websocket/handlers/*` — Must not write directly
- ❌ `backend/websocket/services/*` — Must not write directly
- ❌ `backend/http/*` — HTTP must not write presence/session

### ⚠️ Documented Exceptions

- **`backend/websocket/services/presence.service.js`** — `clearStore()` method
  - Status: Admin/test operation
  - Note: Should be restricted or moved to connectionManager if strict enforcement needed

- **Tests** — May manipulate stores for simulation
  - Status: Acceptable for test helpers
  - Note: Keep test store manipulation in test helpers

### 🔒 Enforcement

- **Primary Rule:** Only `connectionManager` writes session/presence stores
- **Exception Handling:** Documented exceptions for admin/test operations
- **Test Isolation:** Test helpers may manipulate stores for simulation

---

## 📋 COMPLETION STATUS

### ✅ 0.1 — DB Adapter Ownership
- **Status:** LOCKED
- **Violations Fixed:** 4 files updated to use service-layer APIs
- **Documentation:** Complete enforcement rules in `docs/DB_OWNERSHIP_LOCK.md`
- **Verification:** No `dbAdapter.` calls in forbidden areas

### ✅ 1.3 — State Ownership
- **Status:** ENFORCED
- **Enforcement:** `scripts/enforce-state-ownership.js` in CI
- **Allowlist:** Documented legacy/service-local Maps/Sets
- **Verification:** CI fails on violations

### ✅ 1.4 — Presence/Session Lifecycle
- **Status:** LOCKED
- **Primary Writer:** `connectionManager.js` only
- **Exceptions:** Documented (admin/test operations)
- **Verification:** Manual audit confirms connectionManager ownership

---

## 🚨 VIOLATION RECOVERY

If violations are detected:

1. **DB Adapter Violations:**
   - Replace `dbAdapter.` calls with service-layer APIs
   - Use `messageStore` for reads, `messageService` for writes
   - See `docs/DB_OWNERSHIP_LOCK.md` for patterns

2. **State Ownership Violations:**
   - Move Maps/Sets to `websocket/state/*` if global state
   - Document service-local Maps/Sets if intentionally encapsulated
   - Re-run CI to verify

3. **Presence/Session Violations:**
   - Route writes through `connectionManager`
   - Document exceptions if admin/test operations
   - Update this document if exceptions are added

---

## 🔗 RELATED DOCUMENTATION

- **DB Ownership:** `docs/DB_OWNERSHIP_LOCK.md`
- **State Ownership:** `docs/folder-contract.md` (Phase 7)
- **Migration Checklist:** `docs/MIGRATION_CHECKLIST.md`
- **Enforcement Script:** `scripts/enforce-state-ownership.js`

---

**This document is PERMANENT and IMMUTABLE.**
**Violations must be fixed immediately.**
**No exceptions without explicit documentation and review.**
