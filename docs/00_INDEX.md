# Docs index

Single entry point for project documentation. Render deployment does **not** use Docker; it uses Start Command and static build.

---

## Deployment (Render)

| Doc | Description |
|-----|-------------|
| [deploy/RENDER.md](deploy/RENDER.md) | **Render deployment:** backend Web Service + frontend Static Site, env vars, health path, WebSocket path |
| [deploy/RENDER_DEPLOYMENT_PRECHECK.md](deploy/RENDER_DEPLOYMENT_PRECHECK.md) | Pre-deploy audit and verification checklist |
| [deploy/DEPLOYMENT_READINESS_AUDIT.md](deploy/DEPLOYMENT_READINESS_AUDIT.md) | Deployment readiness audit |

See [deploy/README.md](deploy/README.md) for deploy section index.

---

## Security

| Doc | Description |
|-----|-------------|
| [security/SECURITY_AUDIT.md](security/SECURITY_AUDIT.md) | Security & deployment readiness audit (vulnerabilities, Render readiness) |
| [security/SECURITY_CHECKLIST_AUDIT.md](security/SECURITY_CHECKLIST_AUDIT.md) | Security checklist audit |
| [security/SECURITY_AND_DEPLOYMENT_READINESS.md](security/SECURITY_AND_DEPLOYMENT_READINESS.md) | Security and deployment readiness |
| [security/SECURITY_VULNERABILITIES_README.md](security/SECURITY_VULNERABILITIES_README.md) | Security vulnerabilities overview |
| [security/VULNERABILITIES_AUDIT.md](security/VULNERABILITIES_AUDIT.md) | Vulnerabilities audit |
| [security/METRICS_PROTECTION_AUDIT.md](security/METRICS_PROTECTION_AUDIT.md) | Metrics protection audit |
| [security/SECURITY_VERIFICATION_CHECKLIST.md](security/SECURITY_VERIFICATION_CHECKLIST.md) | Security verification checklist |
| [config/ENV_TEMPLATE.md](config/ENV_TEMPLATE.md) | Environment variable contract |

See [security/README.md](security/README.md) and [config/README.md](config/README.md) for section indexes.

---

## Runbooks (operations)

| Doc | Description |
|-----|-------------|
| [runbooks/SECRETS_POLICY.md](runbooks/SECRETS_POLICY.md) | Secrets policy |
| [runbooks/MONGO_ROTATION_RUNBOOK.md](runbooks/MONGO_ROTATION_RUNBOOK.md) | MongoDB secret rotation runbook |
| [runbooks/SECRETS_HISTORY_PURGE.md](runbooks/SECRETS_HISTORY_PURGE.md) | Secrets history purge procedure |

See [runbooks/README.md](runbooks/README.md) for runbooks index.

---

## Verification (QA & phase checklists)

Phase checklists, verification matrices, smoke tests. See [verification/README.md](verification/README.md) for full structure.

| Folder | Description |
|--------|-------------|
| [verification/phase1/](verification/phase1/README.md) | Phase 1 matrix, rows, message rate |
| [verification/phase3/](verification/phase3/README.md) | Phase 3A–3D |
| [verification/phase4/](verification/phase4/README.md) | Phase 4 protocol, room sync, moderation |
| [verification/phase5/](verification/phase5/README.md) | Phase 5 regression, security, contract |
| [verification/phase7/](verification/phase7/README.md) | Phase 7 E2E, quick checklist, prefs |
| [verification/smoke-and-reports/](verification/smoke-and-reports/README.md) | Smoke test, root-cause reports |

---

## WebSocket

| Doc | Description |
|-----|-------------|
| [websocket/WS_HANDSHAKE_AND_FAILURE_MODES.md](websocket/WS_HANDSHAKE_AND_FAILURE_MODES.md) | Handshake and failure modes |
| [websocket/WS_CLOSE_CODES.md](websocket/WS_CLOSE_CODES.md) | Close codes |
| [websocket/WS_PING_TIMERS_TABLE.md](websocket/WS_PING_TIMERS_TABLE.md) | Ping timers reference |

See [websocket/README.md](websocket/README.md) for WebSocket index. Backend protocol: [backend/docs/ROOM_WS_PROTOCOL.md](../backend/docs/ROOM_WS_PROTOCOL.md).

---

## Reference (root-cause reports & proofs)

Root-cause reports, proofs, implementation notes. See [reference/README.md](reference/README.md) for full structure.

| Folder | Description |
|--------|-------------|
| [reference/admin/](reference/admin/README.md) | Admin dashboard, activity, reports |
| [reference/messages/](reference/messages/README.md) | Ticks, notifications, edit/delete |
| [reference/sessions/](reference/sessions/README.md) | Rooms, Redis pub/sub |
| [reference/auth-and-fixes/](reference/auth-and-fixes/README.md) | Origin 403, lastSeen, debugging |

---

## Legacy (not used on Render)

| Folder | Description |
|--------|-------------|
| [legacy/README.md](legacy/README.md) | What “legacy” means; Nginx/systemd/AWS not required for Render |
| [legacy/aws/](legacy/aws/README.md) | AWS deployment (EC2, PM2, ALB) |
| [legacy/deployment/](legacy/deployment/README.md) | Deployment assumptions, prod mode, migration |
| [legacy/proofs-and-analysis/](legacy/proofs-and-analysis/README.md) | Proofs, fix analyses (historical) |

---

## Other doc locations

| Location | Purpose |
|----------|---------|
| [docs/README.md](README.md) | Docs structure overview |
| [docs/STRUCTURE.md](STRUCTURE.md) | How documentation is organized |
| [backend/docs/README.md](../backend/docs/README.md) | Backend API contracts, room/WS protocol, admin |
| [frontend/docs/README.md](../frontend/docs/README.md) | Frontend admin UI, auth, phases, dev setup |
