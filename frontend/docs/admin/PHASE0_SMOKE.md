# Phase 0 Smoke Runbook

Copy-paste runbook to confirm Phase 0 (auth + file-backed users + dev seed) is working.

---

## Backend env

| Variable | Value | Note |
|----------|--------|------|
| `PORT` | `8000` | Default in dev; frontend proxy must match. |
| `DEV_SEED_ADMIN` | `true` | Seeds `dev_admin` (ADMIN) on startup if missing. |
| `DEV_SEED_ADMIN_PASSWORD` | `dev_admin` | Optional; default `dev_admin`. Use this password to log in as `dev_admin`. |

No `ALLOW_BYPASS_AUTH` for this runbook (real login flow).

---

## Frontend env

| Variable | Value | Note |
|----------|--------|------|
| `VITE_BACKEND_PORT` | `8000` | Must match backend `PORT`. |
| `VITE_DEV_BYPASS_AUTH` | unset or `false` | Bypass OFF so login uses `/api/login` and cookies. |

---

## Step-by-step (copy-paste)

**1) Start backend** (from repo root)

```bash
cd backend
DEV_SEED_ADMIN=true PORT=8000 node server.js
```

You should see: `DEV_SEED_ADMIN enabled: ensured dev_admin (ADMIN) exists` and `Backend listening on http://localhost:8000`.

**2) Start frontend** (new terminal, from repo root)

```bash
cd myfrontend/frontend
VITE_BACKEND_PORT=8000 VITE_DEV_BYPASS_AUTH=false npm run dev
```

Open the URL Vite prints (e.g. `http://localhost:5173`).

**3) Login as dev_admin**

- Go to `/login` (or start there).
- Username: `dev_admin`
- Password: `dev_admin` (or whatever you set in `DEV_SEED_ADMIN_PASSWORD`).
- Click **Sign In**.

**4) Open /chat**

- You should land on `/chat` after login; if not, go to `/chat`.
- WebSocket should connect (cookie auth).

**5) Refresh page**

- Refresh the browser (F5 or Cmd+R).
- You should remain logged in (`GET /api/me` succeeds with cookie).

**6) Restart backend and repeat**

- Stop the backend (Ctrl+C), then start it again with the same command as in step 1.
- In the same browser session, refresh or go to `/chat`.
- You should still be logged in (cookies + session valid).
- Optionally log out, then log in again as `dev_admin` with the same password — users persist in `backend/storage/_data/users.json`.

---

## One-liner (backend + frontend)

**Terminal 1 – backend:**

```bash
cd backend && DEV_SEED_ADMIN=true PORT=8000 node server.js
```

**Terminal 2 – frontend:**

```bash
cd myfrontend/frontend && VITE_BACKEND_PORT=8000 VITE_DEV_BYPASS_AUTH=false npm run dev
```

Then in the browser: open the Vite URL → Login → `dev_admin` / `dev_admin` → /chat → refresh (still logged in).

---

## Pass criteria

- Backend starts and logs dev_admin seed when `DEV_SEED_ADMIN=true`.
- Frontend shows login/register; no bypass.
- Login with `dev_admin` / `dev_admin` succeeds and lands on /chat; WS connects.
- Refresh keeps you logged in.
- After backend restart, login still works and users persist (file-backed store).
