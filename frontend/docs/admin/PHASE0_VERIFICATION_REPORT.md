# Phase 0 Verification – Auth Readiness (No Bypass, Login→Chat Safety)
_Date: 2026-02-14 • Scope: backend + frontend • Mode: read-only; servers not started in this audit._

## Bypass OFF configuration (current state)
- Backend `.env` sets `ALLOW_BYPASS_AUTH=true` (dev bypass **enabled**): `backend/.env:1-36`.
- Frontend `.env.local` sets `VITE_DEV_BYPASS_AUTH=true` and shows dev session buttons: `myfrontend/frontend/.env.local:1-6`; wsClient appends `?dev_user=dev_admin` when ALLOW_BYPASS_AUTH is true: `myfrontend/frontend/src/transport/wsClient.js:24-30`; apiFetch sends `x-dev-user: dev_admin` in bypass mode: `myfrontend/frontend/src/lib/http.js:47-49`.
- To truly disable bypass for Phase 0, both env flags must be unset/false (not done in this audit).

## Key implementation evidence
- Access/refresh cookies & TTLs: names `token` (access), `refresh_token` (refresh) in config: `backend/config/constants.js:22-50`.
- Device session store (in-memory): create/list/revoke/rotate refresh hash: `backend/auth/sessionStore.js:4-200`.
- Token service: access JWT includes `sid`, refresh hashed with pepper: `backend/auth/tokenService.js:4-92`.
- Login creates session, issues access+refresh cookies, returns user (no tokens in JSON): `backend/http/controllers/auth.controller.js:66-135`.
- Refresh rotates refresh token, sets new cookies: `backend/http/controllers/auth.controller.js:138-199`.
- Logout revokes session, clears both cookies: `backend/http/controllers/auth.controller.js:202-214`.
- requireAuth (HTTP) checks session exists & not revoked, throttled touch: `backend/http/middleware/requireAuth.js:20-62`.
- WS upgrade: validates JWT cookie; sid extracted but **not validated against auth session store**; bypass path accepts `?dev_user` when ALLOW_BYPASS_AUTH=true: `backend/websocket/connection/wsServer.js:330-419`.
- WS connection manager supports kicking by sessionId: `backend/websocket/connection/connectionManager.js:220-239`; WS session map keyed by sessionId: `backend/websocket/state/sessionStore.js:1-120`.
- Admin session endpoints: list sessions `GET /api/admin/users/:id/sessions` and revoke one/all with WS kick: `backend/http/controllers/admin.controller.js:308-338,680-728`; routes: `backend/http/routes/admin.routes.js:31,45-46`.
- Frontend RequireAuth bypasses checks when ALLOW_BYPASS_AUTH is true: `myfrontend/frontend/src/components/auth/RequireAuth.jsx:17-37`.
- Frontend auth fetch always relative with cookies; injects x-dev-user only if bypass flag true: `myfrontend/frontend/src/lib/http.js:39-55`.

## Truth table (Phase 0 checks)
Item | Status | Notes / Evidence
---|---|---
Register endpoint | PASS (implemented) | `/api/register` in `auth.controller.js:264-339`; route in `backend/http/index.js:75`.
Login endpoint | PASS | `auth.controller.js:66-135`.
/api/me gate | PASS | `auth.controller.js:217-260`; requireAuth session-aware.
Cookies set on login | PASS (by code) | access + refresh cookies httpOnly, path `/api` (`auth.controller.js:105-120`).
Refresh rotation | PASS | `auth.controller.js:138-199`.
Logout clears auth | PASS | `auth.controller.js:202-214`.
Bypass disabled | FAIL (env) | `ALLOW_BYPASS_AUTH=true` and `VITE_DEV_BYPASS_AUTH=true`.
Frontend sends x-dev-user | PASS when bypass true (not desired) | `lib/http.js:47-49`.
WS uses real auth | PARTIAL | JWT checked; sid not validated vs auth session store; bypass accepted when enabled (`wsServer.js:366-386`).
In-memory user store persistence noted | PASS (expected) | Users lost on backend restart (in-memory user store implied in docs).

## Gaps / risks
1) Bypass currently enabled on both FE/BE → undermines “no-bypass” requirement.  
2) WS upgrade does not validate sid against auth session store; a valid JWT without active session would pass; bypass query accepted when enabled.  
3) Verification steps not executed (servers not started); need runtime confirmation once env is set to bypass=off.

## Minimal remediation (no code applied)
- Set `ALLOW_BYPASS_AUTH=false` (or unset) in backend env; set `VITE_DEV_BYPASS_AUTH=false` and `VITE_ENABLE_DEV_SESSION=false` in frontend env before running Phase 0.
- Harden WS upgrade: after JWT verify, call auth sessionStore.getSession(sid) and reject if missing/revoked; set ws sessionId from that record; disallow bypass when flags off.

## Verification commands to run (after setting bypass off)
```bash
# backend health (PORT from backend/.env, default 8000)
curl -i http://localhost:8000/api/health || true

# register → login → me
rm -f /tmp/cj.txt
curl -i -c /tmp/cj.txt -b /tmp/cj.txt -H 'content-type: application/json' \
  -d '{"username":"phase0_user","password":"pass1234","displayName":"Phase0 User"}' \
  http://localhost:8000/api/register
curl -i -c /tmp/cj.txt -b /tmp/cj.txt -H 'content-type: application/json' \
  -d '{"username":"phase0_user","password":"pass1234"}' \
  http://localhost:8000/api/login
curl -i -c /tmp/cj.txt -b /tmp/cj.txt http://localhost:8000/api/me

# refresh
curl -i -c /tmp/cj.txt -b /tmp/cj.txt -X POST -H 'content-type: application/json' \
  -d '{}' http://localhost:8000/api/auth/refresh

# negative login
curl -i -c /tmp/cj.txt -b /tmp/cj.txt -H 'content-type: application/json' \
  -d '{"username":"phase0_user","password":"wrong"}' \
  http://localhost:8000/api/login
```

## Expected outcomes
- Set-Cookie for `token` (access) and `refresh_token` (refresh) with HttpOnly, path `/api`, SameSite `Lax` (per defaults).
- /api/me returns user JSON after login; 401 after logout or with wrong password.
- After backend restart, login for the created user fails (in-memory user store) — acceptable for Phase 0.
- WS upgrade succeeds when cookies present and bypass off; fails (401) without cookies.
