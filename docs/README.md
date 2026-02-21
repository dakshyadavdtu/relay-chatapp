# Project documentation

Single entry point: **[00_INDEX.md](00_INDEX.md)** — use it to find any doc by topic.

How docs are organized: **[STRUCTURE.md](STRUCTURE.md)** — layout, section rules, adding new docs.

---

## Structure

| Section | Purpose |
|--------|--------|
| **[deploy/](deploy/)** | Render deployment: backend Web Service, frontend Static Site, env vars, precheck |
| **[security/](security/)** | Security audits, checklists, vulnerabilities, metrics protection |
| **[runbooks/](runbooks/)** | Operations: secrets, MongoDB rotation, purge procedures |
| **[verification/](verification/)** | Phase checklists, verification matrices, smoke tests |
| **[websocket/](websocket/)** | WebSocket protocol, handshake, close codes, ping timers |
| **[reference/](reference/)** | Root-cause reports, proofs, implementation notes (historical) |
| **[legacy/](legacy/)** | Nginx/systemd/AWS — not used for Render |
| **[config/](config/)** | Environment variable contract (no secrets) |

Each section has a **README.md** that lists all docs in that folder.

---

## Frequently used

- [config/ENV_TEMPLATE.md](config/ENV_TEMPLATE.md) — Environment variable contract
- [security/SECURITY_VERIFICATION_CHECKLIST.md](security/SECURITY_VERIFICATION_CHECKLIST.md) — Security verification

---

## Backend and frontend docs

| Location | Purpose |
|----------|---------|
| [../backend/docs/README.md](../backend/docs/README.md) | Backend: API contracts, room/WS protocol, admin, env, verification |
| [../frontend/docs/README.md](../frontend/docs/README.md) | Frontend: Admin UI, auth, phases, dev setup |
