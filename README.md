# Integrated Chat (Frontend + Backend)

Backend: Node/Express + WebSocket. Frontend: React + Vite. MongoDB for persistence.

---

## Deploy on Render

Render deployment uses **no Dockerfile**: backend runs via **Start Command**, frontend as a **Static Site**.

- **Backend:** Web Service; root directory `backend`, start command `node server.js`, health path `/health`, WebSocket path `/ws`.
- **Frontend:** Static Site; root directory `myfrontend/frontend`, build `npm install && npm run build`, publish `dist`.

Full instructions, env vars, and cookie/CORS notes: **[docs/deploy/RENDER.md](docs/deploy/RENDER.md)**.

---

## Docs

Single entry point for all project documentation: **[docs/00_INDEX.md](docs/00_INDEX.md)**.

- **Deployment:** [docs/deploy/RENDER.md](docs/deploy/RENDER.md), precheck, readiness audit.
- **Security:** Security audit, checklists, secrets policy, env template under `docs/security/` and `docs/`.
- **Legacy:** Nginx/systemd/AWS material (not used on Render) under `docs/legacy/` and `infra/legacy/`.

---

## Local development

- **Backend:** `cd backend && npm install && npm run dev` (see `backend/.env.example`).
- **Frontend:** `cd myfrontend/frontend && npm install && npm run dev`.
- Use `http://localhost:5173` with backend e.g. on port 8000; see [docs/config/ENV_TEMPLATE.md](docs/config/ENV_TEMPLATE.md) for env contract.
