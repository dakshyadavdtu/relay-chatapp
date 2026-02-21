# Documentation structure

How project documentation is organized and where to add new docs.

---

## Entry points

| Entry point | Use when |
|-------------|----------|
| **[00_INDEX.md](00_INDEX.md)** | Finding any doc by topic (single source of truth) |
| **[README.md](README.md)** | Quick overview of docs layout and sections |
| **Root [../README.md](../README.md)** | Deploy on Render, local dev, link to docs |

---

## Top-level layout

```
docs/
├── 00_INDEX.md          # Master index — link new docs here
├── README.md            # Section overview
├── STRUCTURE.md         # This file
├── config/              # Env var contract (ENV_TEMPLATE); no secrets
├── deploy/              # Render deployment
├── security/            # Audits, checklists, verification checklist
├── runbooks/            # Ops: secrets, MongoDB, purge
├── verification/        # Phase checklists, QA, smoke tests
│   ├── phase1/         # Phase 1 matrix, rows, message rate
│   ├── phase3/         # Phase 3A–3D
│   ├── phase4/         # Phase 4 protocol, room sync, moderation
│   ├── phase5/         # Phase 5 regression, security, contract
│   ├── phase7/         # Phase 7 E2E, quick checklist, prefs
│   └── smoke-and-reports/  # Smoke test, root-cause reports
├── websocket/           # WS protocol, handshake, close codes
├── reference/           # Root-cause reports, proofs (historical)
│   ├── admin/          # Admin dashboard, activity
│   ├── messages/       # Ticks, notifications, edit/delete
│   ├── sessions/       # Rooms, Redis pub/sub
│   └── auth-and-fixes/ # Origin 403, lastSeen, debugging
└── legacy/              # AWS/Nginx/systemd (not used on Render)
    ├── aws/             # AWS deployment docs
    ├── deployment/      # Deployment assumptions, prod mode, migration
    └── proofs-and-analysis/  # Proofs, fix analyses (historical)
```

---

## Section rules

- **config/** — Environment variable contract and templates only; no real secrets or credentials.
- **deploy/** — How to deploy (Render only). No Docker.
- **security/** — Security audits and verification; link runbooks for secrets/Mongo.
- **runbooks/** — Step-by-step ops procedures (rotation, purge).
- **verification/** — Phase N checklists, smoke tests, reports; subfolders: phase1, phase3, phase4, phase5, phase7, smoke-and-reports; each has a README.
- **websocket/** — Client/backend WS behaviour; backend protocol lives in `backend/docs/ROOM_WS_PROTOCOL.md`.
- **reference/** — Historical root-cause and proof docs; subfolders: admin, messages, sessions, auth-and-fixes; each has a README.
- **legacy/** — Old deployment paths (AWS, Nginx, systemd); keep for reference only.

---

## Backend and frontend docs

- **Backend:** [../backend/docs/README.md](../backend/docs/README.md) — API contracts, room/WS protocol, admin, env, debug.
- **Frontend:** [../frontend/docs/README.md](../frontend/docs/README.md) — Admin UI, auth, phases, dev setup.

Backend and frontend docs stay in their packages; link them from `00_INDEX.md` under “Other doc locations”.

---

## Adding or moving docs

1. Put the file in the correct section (e.g. new runbook → `runbooks/`).
2. Add an entry to that section’s **README.md** (e.g. [runbooks/README.md](runbooks/README.md)).
3. If it’s important for discovery, add a line to [00_INDEX.md](00_INDEX.md) in the right section.
4. Use relative links: `[RENDER.md](RENDER.md)` within the same folder, `[../config/ENV_TEMPLATE.md](../config/ENV_TEMPLATE.md)` when linking to config.

---

## Consistency

- Each section has a **README.md** that lists all docs in that section.
- **00_INDEX.md** is the single entry point; avoid duplicate “main” indexes.
- Cross-references: link to the actual file (e.g. `verification/smoke-and-reports/SMOKE_TEST.md`), not only to the section.
- Naming: `UPPERCASE_WITH_UNDERSCORES.md` for consistency with existing docs.
