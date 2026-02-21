# DB Ownership Lock — Permanent Architectural Rule

**STATUS: LOCKED** — This document defines immutable DB adapter ownership rules.

---

## 🚨 CRITICAL RULE

No file in this repository may import or call `backend/config/db.js` directly EXCEPT the explicitly allowed service modules listed below.

**Violation of this rule is considered a critical architectural bug.**

---

## ✅ ALLOWED DB Adapter Callers (Explicit List)

### Required Services

1. **`backend/services/message.service.js`**
   - Purpose: Canonical message persistence, state transitions, ACK generation
   - Status: REQUIRED
   - Operations: `persistMessage`, `updateMessageState`, `markMessageDelivered`

### Allowed Service-Layer APIs

2. **`backend/services/message.store.js`**
   - Purpose: Read-only wrapper around dbAdapter for message reads
   - Status: ALLOWED (service-layer read API)
   - Operations: `getMessagesForRecipient`, `getHistoryPaginated`, `getById`, `getReadStates`
   - Note: Provides service-level API for message queries. Controllers and handlers should use this, not dbAdapter directly.

3. **`backend/services/replay.service.js`**
   - Purpose: Replay logic for undelivered messages (reads + state updates)
   - Status: ALLOWED WITH REVIEW
   - Operations: `getUndeliveredMessages`, `updateMessageState`, `markMessageDelivered`
   - Note: Performs replay-specific DB operations. Documented exception for replay logic.

4. **`backend/services/offline.service.js`**
   - Purpose: Offline message recovery (temporary)
   - Status: ALLOWED WITH REVIEW
   - Note: May be merged into replay.service later

### Infrastructure

5. **`backend/config/db.js`**
   - Purpose: DB adapter implementation itself
   - Status: SELF-REFERENCE (allowed)

---

## ❌ FORBIDDEN DB Access Areas

The following areas MUST NEVER import or call `backend/config/db.js`:

- ❌ `backend/websocket/handlers/*` — Must use `services/message.service.js` or `services/message.store.js`
- ❌ `backend/websocket/state/*` — State stores must not access DB directly
- ❌ `backend/websocket/safety/*` — Must use service-layer APIs (`messageStoreService`, `messageService`)
- ❌ `backend/websocket/services/*` — Must use canonical `services/message.service.js` instead
- ❌ `backend/http/controllers/*` — Must use service-layer APIs (`messageStore`, `messageService`)
- ❌ `backend/http/routes/*` — Routes delegate to controllers, which use services
- ❌ `backend/tests/*` — Tests should use service APIs or test helpers (not direct dbAdapter)
- ❌ Any future protocol, controller, or transport layer

---

## 📋 ENFORCEMENT RULES

### Rule 1: Controllers Must Use Service APIs
- HTTP controllers MUST use `messageStore` or `messageService` APIs
- HTTP controllers MUST NOT import `config/db.js` directly
- Example: `messageStore.getMessagesForRecipient()` instead of `dbAdapter.getMessagesForRecipient()`

### Rule 2: Handlers Must Delegate to Services
- WebSocket handlers MUST delegate ALL DB work to services
- Handlers MUST NOT perform DB reads or writes directly
- Example: Call `messageService.persistAndReturnAck()` instead of `dbAdapter.persistMessage()`

### Rule 3: Safety Modules Must Use Service APIs
- WebSocket safety modules MUST use service-layer APIs
- Safety modules MUST NOT import `config/db.js` directly
- Example: `messageStoreService.getById()` instead of `dbAdapter.getMessage()`

### Rule 4: Tests Should Use Service APIs
- Tests SHOULD use service APIs for test flows
- Tests MAY use dbAdapter directly ONLY for DB internals assertions
- Prefer: Test service APIs, not DB internals

---

## 🔍 VIOLATION DETECTION

### Automated Checks

Run these commands to detect violations:

```bash
# Find all imports of config/db
grep -R --line-number "require(['\"].*config/db" backend | grep -v "node_modules" | grep -v "docs/"

# Find all dbAdapter. calls
grep -R --line-number "dbAdapter\." backend | grep -v "node_modules" | grep -v "docs/"

# Expected results: Only allowed files should appear
```

### Manual Audit Checklist

Before any refactor or release:

- [ ] Search repository for `require('../config/db')`
- [ ] Search repository for `require('./config/db')`
- [ ] Search repository for `dbAdapter.`
- [ ] Verify DB imports exist ONLY in allowed service files
- [ ] Confirm no handler performs DB reads or writes
- [ ] Confirm no controller performs DB reads or writes directly
- [ ] Confirm no test bypasses services to access DB (except for DB internals assertions)

---

## 🛠️ FIXING VIOLATIONS

### Pattern 1: Controller Violation

**Before (VIOLATION):**
```javascript
const dbAdapter = require('../../config/db');
const messages = await dbAdapter.getMessagesForRecipient(userId);
```

**After (CORRECT):**
```javascript
const messageStore = require('../../services/message.store');
const messages = await messageStore.getMessagesForRecipient(userId);
```

### Pattern 2: Handler Violation

**Before (VIOLATION):**
```javascript
const dbAdapter = require('../../config/db');
await dbAdapter.persistMessage(messageData);
```

**After (CORRECT):**
```javascript
const messageService = require('../../services/message.service');
await messageService.persistAndReturnAck(message, context);
```

### Pattern 3: Safety Module Violation

**Before (VIOLATION):**
```javascript
const dbAdapter = require('../../config/db');
const message = await dbAdapter.getMessage(messageId);
```

**After (CORRECT):**
```javascript
const messageStoreService = require('../../services/message.store');
const message = await messageStoreService.getById(messageId);
```

---

## 📊 CURRENT STATUS

### ✅ Fixed Violations
- `backend/http/controllers/chat.controller.js` — Now uses `messageStore` service
- `backend/services/history.service.js` — Now uses `messageStore` service
- `backend/websocket/services/message.service.js` — Now uses `messageStoreService` for reads
- `backend/websocket/safety/backpressure.js` — Now uses `messageStoreService` for reads

### ✅ Documented Exceptions
- `backend/services/message.store.js` — Documented as allowed (service-layer read API)
- `backend/services/replay.service.js` — Documented as allowed (replay-specific operations)

### ⚠️ Remaining Considerations
- Tests may use dbAdapter directly for DB internals assertions (acceptable)
- Docs/scripts may reference config/db (acceptable, documentation only)

---

## 🔒 PERMANENT LOCK

This rule is **PERMANENT** and **IMMUTABLE**.

- Adding new files to the allowed list requires architectural review
- Violations must be fixed immediately
- No exceptions without explicit documentation and review

**If someone suggests adding direct dbAdapter access to a forbidden area → CONTRACT VIOLATION.**

See also: `docs/MIGRATION_CHECKLIST.md` for related architectural rules.
