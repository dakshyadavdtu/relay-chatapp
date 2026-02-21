# Phase 2 — Session Revoke Verification

## Goal

Prove end-to-end that session revocation works:

1. **Revoke ONE session** → only that device’s WebSocket is kicked; other devices stay connected.
2. **Revoked device cannot reconnect** → WS upgrade is rejected (session store marks session revoked).
3. **Revoke ALL sessions** → all WebSockets for that user are closed; no reconnect until new login.

## Endpoints Used

| Action              | Method | Path                                              | Auth        |
|---------------------|--------|---------------------------------------------------|-------------|
| Login               | POST   | `/api/login`                                      | none        |
| Get current user    | GET    | `/api/me`                                         | cookie      |
| List user sessions  | GET    | `/api/admin/users/:id/sessions`                   | admin cookie|
| Revoke one session  | POST   | `/api/admin/users/:id/sessions/:sessionId/revoke`  | admin cookie|
| Revoke all sessions | POST   | `/api/admin/users/:id/revoke-sessions`            | admin cookie|

- **Cookie names**: `token` (JWT, default `JWT_COOKIE_NAME`), `refresh_token` (default `REFRESH_COOKIE_NAME`).
- **WS URL**: `ws://localhost:${PORT}/ws` with `Cookie` header from login.

## Expected Behaviour

### Single revoke

- User has two sessions (e.g. device A and B).
- Admin revokes **only** session A.
- **Expected:**
  - WebSocket for session A closes within ~1–2 s (reason/code indicates revoke).
  - WebSocket for session B stays **open** and continues to work.
  - Session A **cannot** reconnect: WS upgrade is rejected (401 Unauthorized: Session revoked).

### Revoke all

- Admin revokes **all** sessions for the user.
- **Expected:**
  - All active WebSockets for that user close.
  - Reconnect with the same cookies fails until the user logs in again (new session).

## How to Run the Smoke Script

**Prerequisites:** Backend running (e.g. `npm run dev` or `node server.js`) with at least one admin user.

```bash
cd backend
PORT=8000 ADMIN_USER=dev_admin ADMIN_PASS=dev_admin node scripts/session_revoke_smoke.js
```

- **PORT** — backend HTTP/WS port (default `8000`).
- **ADMIN_USER** / **ADMIN_PASS** — credentials for admin (used for revoke endpoints and, if no target user is set, as the target user for two sessions).
- **USER_USERNAME** / **USER_PASS** — (optional) target user for two sessions. If omitted, the script uses the admin user as the target (two logins as admin = two sessions).
- **WS_DEBUG=1** — print WebSocket open/close events.

**Exit codes:** `0` = pass, `1` = assertion failure (message printed).

## Sample Output (Pass)

```
login A ok
login B ok
ws A connected (sessionId=54033f11-16b1-4fc5-978b-425a51cfcec4)
ws B connected (sessionId=38a2aeee-7845-44ed-914d-5658db0d99cc)
revoke session A ok
ws A closed ✅
ws B still open ✅
reconnect A blocked ✅
revoke all ok
ws B closed ✅
reconnect B blocked ✅
PASS
```

## Manual Verification

1. **Two browsers (same user)**  
   - Browser A and Browser B both log in as the same user.  
   - Open DevTools → Application (or Network) and note the session/cookie.  
   - In the admin UI (or via API), list sessions for that user and revoke **one** session (e.g. the one for Browser A).  
   - **Expected:** Only Browser A’s tab loses connection / gets kicked; Browser B stays connected.

2. **Revoke all**  
   - Revoke all sessions for that user.  
   - **Expected:** Both Browser A and Browser B disconnect and cannot reconnect until the user logs in again.

## Implementation Notes (Backend)

- **Session store:** `backend/auth/sessionStore.js` — device sessions; `revokeSession(sessionId)`, `revokeAllSessions(userId)`.
- **WS upgrade:** `backend/websocket/connection/wsServer.js` — reads JWT from cookie, resolves `sessionId`, calls `authSessionStore.getSession(sessionId)`. If session is missing or `revokedAt` is set, upgrade is **rejected with 401**.
- **Kick:** After revoke, admin controller calls `connectionManager.removeSession(sessionId)` (one session) or `connectionManager.remove(userId)` (all). Those close the corresponding WebSocket(s) with a normal close (e.g. code 1000, reason “Session revoked” / “Removed”).
- **Two session stores:** Auth sessions live in `auth/sessionStore.js`; WebSocket socket binding in `websocket/state/sessionStore.js`. Connection manager uses the latter to find the socket(s) to close when revoking.

## Done When (Strict)

Phase 2 is complete only when:

- The smoke script **passes**: revoke one → only that socket drops, other stays open; revoked session cannot reconnect; revoke all → all sockets drop and cannot reconnect.
- Manual checks match: two browsers as same user; revoke one session kicks only one; revoke all kicks both.
