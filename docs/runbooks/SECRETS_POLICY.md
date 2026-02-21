# Secrets policy — no secrets in repo

**Never commit:**

- `.env` files or any file containing real `DB_URI`, `JWT_SECRET`, `REFRESH_PEPPER`, `DEV_SESSION_KEY`, or other secrets
- MongoDB connection strings (e.g. `mongodb+srv://...`) with real username/password
- AWS keys (`AKIA...`), private keys (`BEGIN PRIVATE KEY`), or any credential material
- Password hashes or user data files (e.g. `backend/storage/_data/users.json`) — keep these out of version control via `.gitignore`

**Where secrets must come from:**

- **Local dev:** Copy `backend/.env.example` to `backend/.env` and fill in values locally only. Never commit `backend/.env`.
- **CI (e.g. GitHub Actions):** Use repository secrets (Settings → Secrets and variables → Actions). Reference them in workflow env (e.g. `DB_URI`, `JWT_SECRET`); never echo or log them.
- **Production (e.g. EC2/PM2):** Set environment variables on the server (e.g. in PM2 ecosystem file, systemd, or shell profile). Prefer a secret manager (e.g. AWS Secrets Manager, HashiCorp Vault) over plain env files on disk.
- **Scripts that need DB access:** Use `DB_URI` from the environment (e.g. `export DB_URI=...` before running). Scripts must not contain hardcoded URIs or passwords.

**Placeholders in repo:**

- Use `backend/.env.example` with empty or example values only (e.g. `DB_URI=`, `mongodb+srv://<USER>:<PASSWORD>@<HOST>/<DB>?<OPTIONS>` in comments).
- Docs and scripts may show the *shape* of config (variable names, placeholder URIs) but must never contain real credentials.
