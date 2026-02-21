# Phase 2 — Session & Auth Contract (real device sessions + refresh rotation + revoke)

This document defines the **backend contract** for Phase 2 before coding routes. Auth UI integration should rely on this contract.

---

## 1. Design decisions (locked)

| Decision | Choice |
|----------|--------|
| Access token | JWT in httpOnly cookie, **short TTL** |
| Refresh token | **Opaque random** in httpOnly cookie, **long TTL** |
| Refresh rotation | **YES** — each refresh invalidates the previous refresh token and issues a new one |
| Refresh storage | Store as `sha256(token + REFRESH_PEPPER)` (never store raw token) |
| Session | **Device login session** (one record per device/login), not a WebSocket socket |

---

## 2. Session model (device session)

A **session** is one device login. Stored server-side (DB or equivalent). Fields:

| Field | Type | Description |
|-------|------|-------------|
| `sessionId` | string | Unique id (e.g. UUID). Used in access JWT as `sid`. |
| `userId` | string | Owner of the session. |
| `role` | string | User role at session creation (e.g. `user`, `admin`). |
| `createdAt` | ISO8601 | When the session was created (login time). |
| `lastSeenAt` | ISO8601 | Last time this session was used (e.g. refresh or API call). |
| `revokedAt` | ISO8601 \| null | When the session was revoked. `null` = active. |
| `userAgent` | string \| null | Optional User-Agent at login. |
| `ip` | string \| null | Optional IP at login. |

- **Active session:** `revokedAt === null`.
- Listing “sessions” for a user = list active (and optionally recently revoked) device sessions for that user.

---

## 3. Tokens

### 3.1 Access token (JWT)

- **Where:** httpOnly cookie (see Cookies below).
- **TTL:** Short (e.g. 15 min). Configurable via `ACCESS_TOKEN_EXPIRES_IN_SECONDS`.
- **Claims (minimum):**
  - `userId` — user id.
  - `sid` — **session id** (links this token to one device session).
  - `role` — user role (for authorization).
  - Standard: `iat`, `exp`, `nbf`.

Access token is validated on each request. If invalid/expired → 401; frontend should call refresh or re-login.

### 3.2 Refresh token (opaque)

- **Where:** httpOnly cookie (separate cookie from access).
- **Format:** Cryptographically random string (e.g. 32 bytes hex). **Not** a JWT.
- **TTL:** Long (e.g. 7 days). Configurable via `REFRESH_TOKEN_EXPIRES_IN_SECONDS`.
- **Storage:** Server stores only **hash** of the token: `sha256(refreshToken + REFRESH_PEPPER)`. `REFRESH_PEPPER` is a server secret (env).
- **Rotation:** On each successful refresh:
  1. Validate current refresh token (hash lookup, expiry, session not revoked).
  2. **Invalidate** the current refresh token (delete or mark used).
  3. Create a **new** session or reuse existing session record; issue new access + new refresh; set new cookies.

---

## 4. Cookies

| Cookie | Purpose | Path | maxAge | sameSite | secure |
|--------|---------|------|--------|----------|--------|
| **Access** | JWT access token | `/api` | `ACCESS_TOKEN_EXPIRES_IN_SECONDS` (seconds) | `lax` (or `strict` if needed for CSRF) | `true` in production, `false` in dev (no HTTPS) |
| **Refresh** | Opaque refresh token | `/api` | `REFRESH_TOKEN_EXPIRES_IN_SECONDS` (seconds) | `lax` | same as above |

- **Names:** Configurable; e.g. `ACCESS_COOKIE_NAME` (default `token` for backward compat) and `REFRESH_COOKIE_NAME` (default `refresh_token`).
- **httpOnly:** Always `true` for both.
- **Clearing:** On logout and on 401 that indicates “session invalid” (e.g. refresh failed or session revoked), clear **both** cookies (same path, maxAge 0).

---

## 5. Endpoints

Base: `/api`. Auth routes under `/api/auth` (Phase 2). Admin under `/api/admin`.

### 5.1 Auth

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/login` | None | Body: `{ usernameOrEmail, password }`. On success: create **one new session**; set access + refresh cookies; return `{ user: { id, username, role, ... } }`. |
| POST | `/api/auth/refresh` | Refresh cookie only | No body (or empty). Validates refresh cookie; rotates (invalidates old, issues new access + refresh); sets new cookies; returns `{ user }` or 401. |
| POST | `/api/auth/logout` | Access or refresh | Invalidates **current session** (set `revokedAt`); clears **both** cookies. Optional body: none. |

### 5.2 Admin (sessions)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/admin/users/:id/sessions` | Admin | Returns **real device sessions** for user `:id`: list of `{ sessionId, userId, role, createdAt, lastSeenAt, revokedAt, userAgent, ip }`. Filter: active only or include recently revoked by contract/query. |
| POST | `/api/admin/users/:id/sessions/:sessionId/revoke` | Admin | Revoke **one** session: set `revokedAt = now` for that session. If that session’s refresh/access are used later → 401 and clear cookies. |
| POST | `/api/admin/users/:id/revoke-sessions` | Admin | Revoke **all** sessions for user `:id` (set `revokedAt` for all). Any subsequent use of their tokens → 401 and clear cookies. |

---

## 6. Error semantics (401 vs 403; when cookies are cleared)

| Situation | HTTP | Cookies | Notes |
|----------|------|---------|--------|
| No cookie / missing access and no refresh | 401 | — | Client should send refresh or redirect to login. |
| Access expired but refresh valid | 401 | — | Client should call POST `/api/auth/refresh` (sends refresh cookie); do not clear cookies yet. |
| Refresh invalid / expired / session revoked | 401 | **Clear both** | Response should clear access + refresh cookies; client should redirect to login. |
| Valid access but **forbidden** (e.g. not admin) | 403 | — | Do not clear cookies. |
| Valid access, **authorized** | 2xx | — | Normal. |

**Summary:**

- **401** = not authenticated (no valid session/token). Clear cookies only when the **session is invalid** (revoked or refresh failed), so the client does not keep sending bad refresh.
- **403** = authenticated but not allowed. Cookies remain; do not clear.

---

## 7. File references (to implement)

- **Session store:** `backend/auth/sessionStore.js` — create/read/update sessions; revoke by sessionId or by userId.
- **Token service:** `backend/auth/tokenService.js` — issueAccess, issueRefresh, verifyAccess, hashRefresh (and validate refresh by hash).
- **Routes:** Wire POST `/api/auth/login`, `/api/auth/refresh`, `/api/auth/logout`; ensure GET/POST admin session endpoints use real session store and revoke semantics above.

---

*Contract locked for Phase 2. No behavior changes until routes and store are implemented.*
