# Legacy documentation and infra

This folder (and sibling legacy paths) hold material **not used for Render deployment**. Kept for reference only.

---

## What “legacy” means

- **Render** runs the backend via **Start Command** (`node server.js` from `backend/`). No Dockerfile, no Nginx, no systemd.
- **Nginx / systemd / AWS** configs and docs are for self-hosted or EC2-style deployments. Render does **not** use them.
- **AWS-related docs** (e.g. EC2, PM2, ALB) live under [aws/](aws/README.md).
- **Deployment assumptions and migration** live under [deployment/](deployment/README.md).
- **Proofs and analysis** (ticks, unread, auth, etc.) live under [proofs-and-analysis/](proofs-and-analysis/README.md).
- **Infra legacy** (Nginx, systemd) lives under `infra/legacy/` (see below).

---

## Render does not require

- `infra/legacy/nginx/` — Nginx config (proxy, SSL). Not used on Render.
- `infra/legacy/systemd/` — systemd service file. Not used on Render.
- `docs/legacy/aws/` — AWS deployment runbooks. Not used on Render.

If you deploy on **Render**, use only the instructions in [../deploy/RENDER.md](../deploy/RENDER.md) and the env/docs referenced from [../00_INDEX.md](../00_INDEX.md).
