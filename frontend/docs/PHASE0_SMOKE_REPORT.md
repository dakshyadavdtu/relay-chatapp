# Phase 0 Smoke Report — Backend Real Auth Verification

**Date:** 2026-02-14  
**Scope:** Phase 0 only (pre-requisite). No Phase 1+ work. Verify `/api/login` and `/api/me` work end-to-end with current code.

---

## 1) Backend verification

### Commands used

- **Start backend (from repo root):**
  ```bash
  cd backend
  PORT=8000 DEV_SEED_ADMIN=true node server.js
  ```
  Or: `npm run dev` (ensure `PORT=8000` and `DEV_SEED_ADMIN=true` in env or `.env` if you want seeded `dev_admin`).

- **Health check:**
  ```bash
  curl -s -o /dev/null -w "%{http_code}" http://localhost:8000/api/health
  ```
  Result: `200`.

### Routes confirmed (mounted under `/api`)

| Method | Path | Result |
|--------|------|--------|
| POST | /api/login | 200 — returns `{ success, data: { user, capabilities } }`, sets cookies |
| GET | /api/me | 401 without cookie; 200 with cookie — returns `{ success, data: { user, capabilities } }` |
| POST | /api/auth/refresh | 200 when refresh cookie present — returns `{ success, data: { ok: true } }`, sets new cookies |
| POST | /api/logout | 200 — clears cookies |
| POST | /api/register | 201 — creates user, sets cookies, returns user |

### Dev routes (present, not removed)

| Method | Path | Result |
|--------|------|--------|
| GET | /api/dev/session | Mounted when `NODE_ENV !== 'production'`. Without `X-DEV-KEY` header: 401 "Invalid dev key". |

---

## 2) Cookie presence confirmation

Verified with curl cookie jar (`-c` / `-b`). After `POST /api/login` with body `{"username":"dev_admin","password":"dev_admin"}`:

- **Cookie names:** `token` (access JWT), `refresh_token` (opaque).
- **Path:** `/api` (so sent only to /api requests).
- **httpOnly:** Backend sets these with `httpOnly: true` (see `backend/http/controllers/auth.controller.js`). In browser DevTools → Application → Cookies, both cookies appear with **HttpOnly** checked and path `/api`.

No blockers: login and /api/me work with cookie-based auth.

---

## 3) Frontend verification (current state, no code changes)

### Commands

- **Start frontend with bypass OFF (from repo root):**
  ```bash
  cd myfrontend/frontend
  VITE_BACKEND_PORT=8000 VITE_DEV_BYPASS_AUTH=false npm run dev
  ```
  Ensure `VITE_DEV_BYPASS_AUTH` is not set to `true` so the app uses real login (no `x-dev-user` header).

- **Manual steps:**
  1. Open the Vite dev URL (e.g. `http://localhost:5173`).
  2. You should land on `/login` (root redirects to /login when bypass is off).
  3. Log in with a real user (e.g. `dev_admin` / `dev_admin` if backend was started with `DEV_SEED_ADMIN=true`, or a user you registered via `/register`).
  4. In browser DevTools → Network:
     - **POST /api/login** → Status 200, response body has `success: true` and `data.user`.
     - **GET /api/me** → Status 200 after login (called by useAuth after login to confirm session).
  5. In DevTools → Application → Cookies, confirm `token` and `refresh_token` are set for the app origin, path `/api`, HttpOnly.

### Refresh endpoint

- **POST /api/auth/refresh** exists and returns 200 when a valid refresh cookie is sent (verified with curl). The current frontend does not yet call it on 401 (Phase 1 will add that). No change made in Phase 0.

---

## 4) Blockers

**None.** All of the following passed:

- GET /api/me without cookie → 401.
- POST /api/login (dev_admin / dev_admin) → 200, Set-Cookie.
- GET /api/me with cookie → 200, user matches login.
- POST /api/auth/refresh with cookie → 200.
- POST /api/register → 201.
- POST /api/logout → 200.
- GET /api/dev/session (no key) → 401 (route mounted in dev).

---

## 5) Stop condition check

- **If /api/login or /api/me had failed:** Would stop and fix minimal backend issues only (e.g. CORS/credentials/cookies).  
- **Actual result:** Both succeeded. Phase 0 complete. Do not implement Phase 1 refresh logic in this run.
