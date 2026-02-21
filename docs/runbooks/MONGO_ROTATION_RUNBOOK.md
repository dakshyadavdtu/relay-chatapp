# MongoDB Atlas password rotation runbook

**When to use:** The MongoDB password (or connection string) is compromised or exposed (e.g. was committed to a repo). Rotate immediately and reduce blast radius.

**Assumption:** Backend reads `DB_URI` only from environment (no hardcoded URIs). See `backend/config/env.validate.js` and `backend/storage/mongo.client.js`.

---

## 1. Create new least-privilege user (preferred)

1. In **MongoDB Atlas** → your project → **Database Access** → **Add New Database User**.
2. **Authentication:** Password (or Certificate if you use x.509).
3. **User name:** e.g. `app_readwrite` or `mychat_app` (do not reuse the compromised username).
4. **Password:** Generate a strong password; store it in a secret manager or secure env—do not commit.
5. **Database User Privileges:**  
   - **Built-in role:** Choose **Read and write to any database** only if you have one DB; otherwise use **Custom role**.  
   - **Preferred (least privilege):** Create a custom role or use “Read and write to a specific database” and grant **readWrite** on the **application database only** (e.g. `mychat`). Do **not** grant `clusterAdmin`, `userAdmin`, or `readWriteAnyDatabase` unless required.
6. **Save** the user.

---

## 2. Build new connection string

Format:

```
mongodb+srv://<NEW_USER>:<NEW_PASSWORD>@<CLUSTER_HOST>/<DB>?retryWrites=true&w=majority
```

- `<CLUSTER_HOST>`: from Atlas → Cluster → Connect → “Drivers” (e.g. `cluster0.xxxxx.mongodb.net`).
- `<DB>`: application database name (backend default is `mychat`; overridable with `DB_NAME`).

Test from a machine that has network access to Atlas:

```bash
mongosh "mongodb+srv://<NEW_USER>:<NEW_PASSWORD>@<CLUSTER_HOST>/<DB>?retryWrites=true&w=majority" --eval "db.runCommand({ ping: 1 })"
```

---

## 3. Update DB_URI everywhere (env var and places)

The backend uses **only** the `DB_URI` environment variable. These are the places that must be updated after rotation:

| Location | Env var | Notes |
|----------|--------|--------|
| **Local dev** | `DB_URI` in `backend/.env` | Copy from `backend/.env.example`; set `DB_URI=` to the new URI. Never commit `.env`. |
| **Production (EC2/PM2)** | `DB_URI` in process environment | Set in PM2 ecosystem file, systemd unit, or shell `export` used to start the app. Prefer secret manager (e.g. AWS Secrets Manager) and inject at startup. |
| **CI (GitHub Actions)** | `DB_URI` in workflow `env` | Current CI uses `mongodb://localhost:27017/relay_test` (in-repo Mongo service). If you ever point CI at Atlas, put the URI in **GitHub repo secrets** and reference as `DB_URI: ${{ secrets.DB_URI }}`. Do not put real Atlas URIs in the workflow file. |
| **Scripts** | `DB_URI` in environment when running | e.g. `backend/scripts/verify-delivery-fix.sh` and any script that runs `mongosh` or connects to Mongo. Run with `export DB_URI='...'` (or from a loaded `.env`) before executing. |

**Optional:** `DB_NAME` defaults to `mychat` in `backend/storage/mongo.client.js`. Only set it if your database name differs.

---

## 4. Network access (Atlas)

1. In Atlas → **Network Access** → review the list.
2. **Production:** Do **not** use `0.0.0.0/0` (allow from anywhere). Restrict to:
   - Your application server IP(s), or
   - VPC peering / Private Endpoint if running in a cloud VPC.
3. **Development:** If you need broad access for dev, use a **separate Atlas project or cluster** (or a dev user with limited privileges) and a different `DB_URI` in local `.env` only.

---

## 5. Deploy new env and smoke test

1. Update `DB_URI` in the production environment (and any scripts that talk to prod DB).
2. Restart the backend (e.g. `pm2 restart all` or restart the process that runs `server.js`).
3. Run post-rotation smoke tests:

| Check | How |
|-------|-----|
| Backend boots | Process starts without exit; no “DB_URI” or Mongo connection errors in logs. |
| Login | User can log in (auth uses Mongo for users/sessions). |
| Chat send/receive | Send a message; other user or same session sees it (messages and delivery in Mongo). |
| Admin endpoints | If you have admin routes (e.g. `/api/admin/*`), call one and confirm 200 or expected behavior. |

4. If all pass, proceed to **disable or delete the old user** in Atlas (Database Access). If any check fails, see **Rollback** below.

---

## 6. Disable or delete old user

- In Atlas → **Database Access** → find the compromised user (e.g. `my_db_user`).
- **Delete** the user, or **Edit** and disable (if your Atlas version supports it).
- Confirm no process still uses the old connection string (old `DB_URI`).

---

## 7. Rollback plan

If after switching to the new user the app fails (e.g. wrong permissions, wrong DB name):

1. **Immediate:** Set `DB_URI` back to the **previous** (old user) connection string in the same place you updated it (PM2/EC2 env, etc.), and restart the backend. The old credentials are still compromised, so use only long enough to fix the new user.
2. **Fix:** Correct the new user’s roles in Atlas (e.g. grant `readWrite` on the correct database) or fix the new connection string (typo, wrong DB name).
3. **Re-rotate:** Once the new user works, delete/disable the old user again so the old password is no longer valid.

---

## 8. Validation checklist (quick reference)

- [ ] New Atlas user created with least privilege (e.g. readWrite on app DB only).
- [ ] New connection string tested with `mongosh` from a allowed IP.
- [ ] `DB_URI` updated in: local `backend/.env`, production env (PM2/EC2/secret manager), and any script that runs against prod.
- [ ] CI: still using local Mongo or, if using Atlas, URI from GitHub secrets only.
- [ ] Atlas Network Access: no `0.0.0.0/0` in production; IP or VPC restricted.
- [ ] Backend restarted; smoke tests passed (boot, login, chat, admin).
- [ ] Old user deleted or disabled in Atlas.

---

## 9. Env var summary (exact names and places)

| Env var | Where it must be set / updated | Purpose |
|---------|--------------------------------|--------|
| **DB_URI** | `backend/.env` (local); production server env (PM2/EC2/secret manager); CI workflow `env` if using Atlas | MongoDB connection string. Backend reads this only from `process.env.DB_URI`. |
| **DB_NAME** | Optional; same places as DB_URI if you override | Database name; default `mychat` in code. |
| **ALLOW_LOCAL_DB** | `backend/.env` (local only, `true` for local Mongo) | Allow non-Atlas URIs in development. Do not set in production. |

No code changes are required for rotation; the backend already reads `DB_URI` only from the environment.
