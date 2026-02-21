# Backend documentation

API contracts, WebSocket protocol, admin wiring, env/config, and verification docs for the Node/Express backend.

**Project docs index:** [../../docs/00_INDEX.md](../../docs/00_INDEX.md)

---

## API & contracts

| Doc | Description |
|-----|-------------|
| [env-contract.md](env-contract.md) | Environment variable contract (required, defaults, validation) |
| [folder-contract.md](folder-contract.md) | Folder structure and ownership contract |
| [config-map.md](config-map.md) | Config mapping and runtime behaviour |
| [SYSTEM_CONTRACTS_MASTER.md](SYSTEM_CONTRACTS_MASTER.md) | System contracts master reference |
| [SYSTEM_TECHNICAL_AUDIT.md](SYSTEM_TECHNICAL_AUDIT.md) | System technical audit |

---

## WebSocket & room protocol

| Doc | Description |
|-----|-------------|
| [ROOM_WS_PROTOCOL.md](ROOM_WS_PROTOCOL.md) | Room/group management over WebSocket (RBAC, messages) |
| [ROOM_RBAC_MODEL.md](ROOM_RBAC_MODEL.md) | Room RBAC model |
| [ROOM_NAME_INSTANT_APPEAR.md](ROOM_NAME_INSTANT_APPEAR.md) | Room name instant appear behaviour |
| [ROOM_RESUME_CONSISTENCY.md](ROOM_RESUME_CONSISTENCY.md) | Room resume consistency |
| [websocket-baseline.md](websocket-baseline.md) | WebSocket baseline |
| [verify-realtime-delivery.md](../verify-realtime-delivery.md) | Realtime delivery verification (backend root) |

---

## Admin

| Doc | Description |
|-----|-------------|
| [ADMIN_MESSAGES_API.md](ADMIN_MESSAGES_API.md) | Admin messages API |
| [ADMIN_MESSAGES_API_PLAN.md](ADMIN_MESSAGES_API_PLAN.md) | Admin messages API plan |
| [ADMIN_DASHBOARD_WIRING_VERIFICATION.md](ADMIN_DASHBOARD_WIRING_VERIFICATION.md) | Admin dashboard wiring verification |
| [METRICS_MPS_CALCULATION_FLOW.md](METRICS_MPS_CALCULATION_FLOW.md) | Metrics MPS calculation flow |
| [TIMESERIES_SEMANTICS.md](TIMESERIES_SEMANTICS.md) | Timeseries semantics |
| [ADMIN_DEVTOOLS_ROADMAP.md](ADMIN_DEVTOOLS_ROADMAP.md) | Admin devtools roadmap |

---

## Sessions, presence, unread

| Doc | Description |
|-----|-------------|
| [UNREAD_AND_MARK_READ.md](UNREAD_AND_MARK_READ.md) | Unread and mark-read behaviour |
| [LIVE_SESSIONS_FILTER_NOTES.md](LIVE_SESSIONS_FILTER_NOTES.md) | Live sessions filter notes |
| [PHASE4_SESSION_LIVENESS_AUDIT.md](PHASE4_SESSION_LIVENESS_AUDIT.md) | Phase 4 session liveness audit |
| [presence-debug.md](presence-debug.md) | Presence debugging |
| [REALTIME_DELIVERY.md](REALTIME_DELIVERY.md) | Realtime delivery |

---

## Auth, security, runtime

| Doc | Description |
|-----|-------------|
| [IP_VERIFICATION.md](IP_VERIFICATION.md) | IP verification |
| [LOGIN_BLOCKER.md](LOGIN_BLOCKER.md) | Login blocker |
| [runtime-baseline.md](runtime-baseline.md) | Runtime baseline |
| [ENV_RUNTIME_PROOF.md](ENV_RUNTIME_PROOF.md) | Env runtime proof |
| [FILE_OWNERSHIP_LOCK.md](FILE_OWNERSHIP_LOCK.md) | File ownership lock |
| [DB_OWNERSHIP_LOCK.md](DB_OWNERSHIP_LOCK.md) | DB ownership lock |

---

## Verification & acceptance

| Doc | Description |
|-----|-------------|
| [PHASE0_SYSTEM_DISCOVERY.md](PHASE0_SYSTEM_DISCOVERY.md) | Phase 0 system discovery |
| [PHASE2_ADMIN_USERS_ACCEPTANCE.md](PHASE2_ADMIN_USERS_ACCEPTANCE.md) | Phase 2 admin users acceptance |
| [PHASE2_SESSION_REVOKE_VERIFICATION.md](PHASE2_SESSION_REVOKE_VERIFICATION.md) | Phase 2 session revoke verification |
| [baseline-verification.md](baseline-verification.md) | Baseline verification |
| [TIER_1_6_VERIFICATION.md](TIER_1_6_VERIFICATION.md) | Tier 1–6 verification |

---

## Debug & misc

| Doc | Description |
|-----|-------------|
| [debug/multitab.md](debug/multitab.md) | Multitab debugging |
| [SMTP_SETUP.md](SMTP_SETUP.md) | SMTP setup |
| [PM2_STARTUP_PROOF.md](PM2_STARTUP_PROOF.md) | PM2 startup proof (legacy) |
