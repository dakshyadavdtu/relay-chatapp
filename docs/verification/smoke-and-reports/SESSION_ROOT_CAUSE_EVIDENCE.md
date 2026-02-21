# Session root cause — Evidence report (PHASE 0)

**Goal:** Prove that "multiple sessions" are **persisted auth sessions from repeated logins over time**, NOT "multiple tabs right now".  
**Scope:** Read + TEMP instrumentation only; no behavior change. TEMP logs must be removed later.

---

## 1. How session lists are produced

### 1.1 Login creates a session (one per login)

| File | Function | Behavior |
|------|----------|----------|
| `backend/http/controllers/auth.controller.js` | `login()` | Validates credentials, then **always** calls `sessionStore.createSession({ userId, role, userAgent, ip })` (lines 91–96). Does **not** revoke existing sessions: comment states "Multiple active sessions allowed: we do NOT revoke existing sessions on login (multi-tab safe)." |

**Exact reference:** `auth.controller.js` lines 91–96 — single code path; no conditional skip of `createSession` on login.

### 1.2 Session store: persisted, filter by revokedAt

| File | Function | Behavior |
|------|----------|----------|
| `backend/auth/sessionStore.mongo.js` | `createSession(opts)` | Inserts one document into MongoDB `sessions` collection with `sessionId` (crypto.randomUUID), `userId`, `createdAt`, `lastSeenAt`, `revokedAt: null`, `userAgent`, `ip` (lines 39–56). |
| `backend/auth/sessionStore.mongo.js` | `listSessions(userId, opts)` | Queries `{ userId }`; if `opts.activeOnly !== false`, adds `revokedAt: null`. Returns **all matching DB rows** sorted by `lastSeenAt` desc (lines 76–85). No notion of "open tab" or WebSocket connection count. |

**Exact reference:** `sessionStore.mongo.js` lines 76–82: `filter.revokedAt = null` when `activeOnly` is true. So "active" = not revoked in DB, not "currently open in a tab".

### 1.3 GET /api/sessions/active

| File | Function | Behavior |
|------|----------|----------|
| `backend/http/controllers/sessions.controller.js` | `getActiveSessions(req, res)` | Gets `userId` from `req.user`, calls `sessionStore.listSessions(userId, { activeOnly: true })` (line 49). Maps each session to `{ sessionId, userId, createdAt, lastSeenAt, revokedAt, userAgent, ip, device, isCurrent }` where `isCurrent = (currentSid === s.sessionId)` (lines 54–64). Returns `{ sessions }`. |

**Exact reference:** `sessions.controller.js` lines 47–66. So **sessions/active returns all non-revoked sessions for the user** from the DB, not "tabs open right now".

### 1.4 Devices page: groups by device/UA, shows count

| File | Function | Behavior |
|------|----------|----------|
| `myfrontend/frontend/src/pages/settings/DevicesPage.jsx` | `groupSessions(list)` | Groups `list` by `getGroupKey(session)` (device label or userAgent prefix). Each group gets `sessions[]`, `count: g.sessions.length`, `lastSeenAt`, `hasCurrent` (lines 31–63). |
| Same | Render | For each group, shows `group.title`, `formatAgo(group.lastSeenAt)`, and **if `group.count > 1`** the line `"{group.count} sessions"` (lines 247–251). |

**Exact reference:** `DevicesPage.jsx` lines 247–251: `{group.count} sessions` is the user-visible "multiple sessions" text; count is number of **session records** in that device/UA group, not number of open tabs.

### 1.5 Admin: GET /api/admin/users/:id/sessions

| File | Function | Behavior |
|------|----------|----------|
| `backend/http/controllers/admin.controller.js` | `getUserSessions(req, res)` | Calls `authSessionStore.listSessions(userId, { activeOnly: false })`, slices to limit, maps to stable shape with `sessionId`, `createdAt`, `lastSeenAt`, `revokedAt`, `userAgent`, `ip`, `device` (lines 402–434). |

**Exact reference:** `admin.controller.js` lines 415–427. Same store: list of **persisted sessions** (active + revoked when `activeOnly: false`), not live tab count.

---

## 2. Confirmations in code

- **login() always calls sessionStore.createSession()**  
  Yes. In `auth.controller.js` `login()`, the only path after validation and ban check is `createSession` then token/cookie setup. No branch skips it.

- **sessions/active returns all non-revoked sessions (revokedAt == null), not "open tabs"**  
  Yes. `getActiveSessions` uses `listSessions(userId, { activeOnly: true })`, and `listSessions` in `sessionStore.mongo.js` sets `filter.revokedAt = null`. There is no join to WebSocket or "current tab" state; it is purely DB-backed.

- **DevicesPage groups by device/UA and displays "{count} sessions"**  
  Yes. `groupSessions()` builds groups by device (or userAgent); each group has `count: g.sessions.length`. The UI shows `{group.count} sessions` when `group.count > 1` (DevicesPage.jsx 247–251).

---

## 3. TEMP logs added (must remove later)

### A) auth.controller.js — after createSession in login()

- **Location:** `backend/http/controllers/auth.controller.js`, inside `login()`, immediately after `sessionStore.createSession(...)`.
- **Log:** `[TEMP-auth] login createSession` with `{ userId, sessionId, userAgent (first 60 chars), ip, timestamp }`.
- **Condition:** Only when `NODE_ENV !== 'production'`.

### B) sessions.controller.js — inside getActiveSessions()

- **Location:** `backend/http/controllers/sessions.controller.js`, inside `getActiveSessions()`, after `list = await sessionStore.listSessions(...)` and before mapping to `sessions`.
- **Log:** `[TEMP-sessions] getActiveSessions` with `{ userId, currentSid, returnedCount: list.length, newestLastSeenAt, oldestLastSeenAt }` (lastSeenAt derived from list; only when `list.length > 0` and not production).

---

## 4. Example log outputs (what to expect when running locally)

**Login once:**

```
[TEMP-auth] login createSession { userId: '...', sessionId: 'abc-123-uuid', userAgent: 'Mozilla/5.0 ...', ip: '::1', timestamp: 1234567890123 }
```

**Open Devices → GET /api/sessions/active:**

```
[TEMP-sessions] getActiveSessions { userId: '...', currentSid: 'abc-123-uuid', returnedCount: 1, newestLastSeenAt: 1234567890123, oldestLastSeenAt: 1234567890123 }
```

**Logout, then login again (same tab/browser):**

```
[TEMP-auth] login createSession { userId: '...', sessionId: 'def-456-uuid', userAgent: 'Mozilla/5.0 ...', ip: '::1', timestamp: 1234567890456 }
```

**Open Devices again:**

```
[TEMP-sessions] getActiveSessions { userId: '...', currentSid: 'def-456-uuid', returnedCount: 2, newestLastSeenAt: ..., oldestLastSeenAt: ... }
```

So you see **two different `sessionId` values** (e.g. `abc-123-uuid` and `def-456-uuid`) and `returnedCount: 2` — proving multiple **persisted** sessions from repeated logins, not "two tabs right now".

**Close tab without logout, reopen site, login again:**

- New login creates a **third** session (new `sessionId`).
- The previous session (e.g. `def-456-uuid`) was never revoked (no logout), so it still has `revokedAt: null`.
- GET /api/sessions/active will return **3** sessions; Devices page will show multiple entries and/or "{n} sessions" where n > 1.

---

## 5. Confirmation: tab close ≠ session revoke

- **Revoke happens only when:**  
  - User clicks "Log out" (current session) → `logout()` in auth.controller or sessions.controller revokes that session.  
  - User clicks "Log out" on Devices for a group → `logoutSession({ sessionId })` per session → `sessionStore.revokeSession(sessionId)`.  
  - "Log out all" → `revokeAllSessions(userId)`.

- **Closing the browser tab** does **not** call any of these. The backend is never notified. The session document stays in MongoDB with `revokedAt: null` until expiry or explicit revoke.

So in the current design, **tab close ≠ session revoke**. Multiple sessions in the list are persisted sessions from past logins (and possibly other devices/tabs that never logged out), not a count of "tabs open right now".

---

## 6. Validation checklist (run locally)

1. Login once → open Devices → confirm **1 session** and one `[TEMP-auth]` + one `[TEMP-sessions]` with `returnedCount: 1`.
2. Logout, login again (same tab/browser) → open Devices → confirm **session count increases** (e.g. 2); logs show a **new** `sessionId` in `[TEMP-auth]` and `returnedCount: 2` in `[TEMP-sessions]`.
3. Close tab **without** logout, reopen site, login again → open Devices → confirm **old session(s) still present** plus new one (e.g. 3 total); confirms tab close did not revoke.

**Remove TEMP logs** after verification: delete the `[TEMP-auth]` block from `auth.controller.js` and the `[TEMP-sessions]` block from `sessions.controller.js`.
