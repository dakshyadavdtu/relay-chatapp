# DB Ownership & Migration Checklist

⚠️ CRITICAL RULE:
No file in this repository may import or call
`backend/config/db.js` directly
EXCEPT the explicitly allowed service modules listed below.

Violation of this rule is considered a critical architectural bug.

## ✅ Allowed DB Adapter Callers (Temporary & Explicit)

- `backend/services/message.service.js`
  - Purpose: canonical message persistence, state transitions, ACK generation
  - Status: REQUIRED

- `backend/services/message.store.js`
  - Purpose: read-only wrapper around dbAdapter for message reads
  - Status: ALLOWED (service-layer read API)
  - Note: Provides service-level API for message queries (getMessagesForRecipient, getHistoryPaginated, etc.)

- `backend/services/replay.service.js`
  - Purpose: replay logic for undelivered messages (reads + state updates)
  - Status: ALLOWED WITH REVIEW
  - Note: Performs replay-specific DB operations (getUndeliveredMessages, updateMessageState, markMessageDelivered)

- `backend/services/offline.service.js`
  - Purpose: offline message recovery (temporary)
  - Status: ALLOWED WITH REVIEW
  - Note: May be merged into replay.service later

Do NOT add any other files.

## ❌ Forbidden DB Access Areas

The following areas MUST NEVER import or call `backend/config/db.js`:

- `backend/websocket/handlers/*`
- `backend/websocket/state/*`
- `backend/websocket/safety/*` (use service-layer APIs instead)
- `backend/websocket/services/*` (use canonical services/message.service.js instead)
- `backend/http/controllers/*` (use service-layer APIs instead)
- `backend/tests/*` (use service APIs or test helpers)
- Any future protocol, controller, or transport layer

Handlers must delegate ALL DB work to services.
Controllers must use service-layer APIs (messageStore, messageService) instead of direct dbAdapter calls.

## 🔍 DB Access Audit Checklist

The following checks MUST be completed before any refactor or release:

- [x] Search repository for `require('../config/db')`
- [x] Search repository for `require('./config/db')`
- [x] Search repository for `dbAdapter.`
- [x] Verify DB imports exist ONLY in allowed service files
- [x] Confirm no handler performs DB reads or writes
- [x] Confirm no controller performs DB reads or writes directly
- [x] Confirm no test bypasses services to access DB (except for DB internals assertions)

**Current Status (LOCKED):**
- ✅ All HTTP controllers use service-layer APIs (`messageStore`, `messageService`)
- ✅ All WebSocket services use service-layer APIs (`messageStoreService`, `messageService`)
- ✅ All WebSocket safety modules use service-layer APIs
- ✅ Only allowed services import `config/db.js` directly

See: `docs/DB_OWNERSHIP_LOCK.md` for complete enforcement rules and violation patterns.

This checklist exists to prevent accidental architectural regression.

## Tier-0.7 — Deployment Readiness

- ✔ Env contract frozen
- ✔ Deployment assumptions documented
- ✔ Prod mode validated locally
- ✔ Replay & idempotency re-verified

Details: Production required vars (NODE_ENV, PORT, JWT_SECRET, DB_URI, COOKIE_DOMAIN, CORS_ORIGIN, WS_PATH) are enforced in `config/env.validate.js`. No silent defaults in production. See `docs/DEPLOYMENT_ASSUMPTIONS.md` and `docs/PROD_MODE_CHECK.md`. Run `JWT_SECRET=test node tests/ack-drop.test.js` from `backend/`; exit code must be 0. DB row count === 1, messageId unchanged, state upgraded only after replay.

## Tier-1.6 — AWS Deployment Integrated

- ✔ Single deployment path (systemd + NGINX; no ALB)
- ✔ Strict hierarchical authority: systemd (authority) → PM2 (process supervisor) → Node app
- ✔ systemd unambiguously owns PM2 lifecycle (PM2 runs with --no-daemon; systemd is only entry point)
- ✔ Runtime env hard-fail: ExecStartPre runs check-chat-backend-env.sh; systemd refuses to start PM2 if env missing
- ✔ NGINX is the only HTTPS/WSS entry (authoritative); Node binds 127.0.0.1:PORT only (no public access)
- ✔ NGINX timeout dominance: proxy_read_timeout 3600s > WS heartbeat 60s (guaranteed in config)
- ✔ Boot determinism: systemd → ExecStartPre → PM2 → Node; Restart=always; deterministic failure escalation
- ✔ Invariants preserved (no message/replay/DB logic changed)

**Code artifacts:**
- `infra/systemd/chat-backend.service` — ExecStartPre env check; ExecStart=pm2 --no-daemon (systemd owns PM2)
- `scripts/check-chat-backend-env.sh` — ExecStartPre; exit 1 if env missing → systemd does not start PM2
- `server.js` — binds to 127.0.0.1:PORT only (no public bind)
- `infra/nginx/chat-backend.conf` — explicit authority statements; timeout dominance enforced
- `ecosystem.config.js` — PM2 config (used by systemd; PM2 subordinate to systemd)
