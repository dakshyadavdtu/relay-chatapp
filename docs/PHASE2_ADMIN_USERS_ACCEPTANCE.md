# Phase 2 Admin Users — Manual Acceptance (curl)

Use this doc to verify Phase 2 “done” definition with copy-paste curl commands.  
**Prerequisites:** Backend running (e.g. `npm run dev`), admin user exists (e.g. `dev_admin` with dev password or created via register).

**Base URL:** `http://localhost:3001` (or set `BASE_URL`).  
**Cookies:** After login, use `-b cookies.txt` for authenticated requests; login uses `-c cookies.txt` to save cookies. Default cookie names: `token`, `refresh_token`.

---

## 1. Login as admin (get session)

```bash
curl -s -c cookies.txt -X POST "$BASE_URL/api/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"dev_admin","password":"YOUR_DEV_PASSWORD"}'
```

**Expected:** `200`, body like `{"success":true,"data":{"user":{...},"capabilities":[...]}}`.  
If dev user has no password: create a user via `/api/register` and promote to ADMIN, or use that user for admin steps.

---

## 2. GET /api/admin/users (stable keys)

```bash
curl -s -b cookies.txt "$BASE_URL/api/admin/users"
```

**Expected:** `200`, body with stable shape:

- `success: true`
- `data.users`: array of user objects
- Each user must have: `id`, `username`, `role`, `status`, `banned`, `flagged`, `messages`, `reconnects`, `failures`, `violations`, `avgLatencyMs`, `lastSeen`, `email`
- Types: `messages`/`reconnects`/`failures`/`violations` numbers; `banned` boolean; `avgLatencyMs` number or null

Example slice:

```json
{
  "success": true,
  "data": {
    "users": [
      {
        "id": "dev_admin",
        "username": "dev_admin",
        "role": "admin",
        "status": "offline",
        "banned": false,
        "flagged": false,
        "messages": 0,
        "reconnects": 0,
        "failures": 0,
        "violations": 0,
        "avgLatencyMs": null,
        "lastSeen": null,
        "email": null
      }
    ],
    "nextCursor": null,
    "total": 1
  }
}
```

---

## 3. GET /api/admin/diagnostics/:userId (stable shape)

Replace `USER_ID` with a real user id (e.g. from users list).

```bash
curl -s -b cookies.txt "$BASE_URL/api/admin/diagnostics/USER_ID"
```

**Expected:** `200`, body with exact keys:

- `success: true`
- `data.userId`, `data.timestamp` (ISO string), `data.online` (boolean), `data.metrics`, `data.lastActivityAt`, `data.suspiciousFlags` (number), `data.notes` (array)
- `data.metrics`: `messagesWindow`, `reconnectsWindow`, `deliveryFailuresWindow`, `violationsWindow`, `avgLatencyMs`

Example:

```json
{
  "success": true,
  "data": {
    "userId": "dev_admin",
    "timestamp": "2025-02-16T12:00:00.000Z",
    "online": false,
    "metrics": {
      "messagesWindow": 0,
      "reconnectsWindow": 0,
      "deliveryFailuresWindow": 0,
      "violationsWindow": 0,
      "avgLatencyMs": null
    },
    "lastActivityAt": null,
    "suspiciousFlags": 0,
    "notes": []
  }
}
```

---

## 4. GET /api/admin/diagnostics/:userId — 404 for random id

```bash
curl -s -w "\n%{http_code}" -b cookies.txt "$BASE_URL/api/admin/diagnostics/random-nonexistent-user-id-404"
```

**Expected:** HTTP `404`, body:

```json
{
  "success": false,
  "error": "Not found",
  "code": "NOT_FOUND"
}
```

---

## 5. Revoke single session (ownership — 403 when revoking other user’s session)

- Create two users (e.g. A and B). Log in as A and as B in another terminal/browser; note B’s session id from GET `/api/admin/users/:id/sessions` as admin.
- As admin, call revoke with **target user id = A** and **sessionId = B’s session**.

```bash
# Replace USER_A_ID and SESSION_OF_USER_B with real values
curl -s -w "\n%{http_code}" -b cookies.txt -X POST \
  "$BASE_URL/api/admin/users/USER_A_ID/sessions/SESSION_OF_USER_B/revoke"
```

**Expected:** `403`, body:

```json
{
  "success": false,
  "error": "Cannot revoke session of another user",
  "code": "FORBIDDEN"
}
```

---

## 6. Ban user then login/refresh → 403 ACCOUNT_BANNED

- Pick a non-admin user id `TARGET_ID` (or create one and note id).
- As admin: ban the user.

```bash
curl -s -b cookies.txt -X POST "$BASE_URL/api/admin/users/TARGET_ID/ban"
```

**Expected:** `200` (ban success).

- Attempt login as that user:

```bash
curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"TARGET_USERNAME","password":"TARGET_PASSWORD"}'
```

**Expected:** `403`, body:

```json
{
  "success": false,
  "error": "Account is suspended",
  "code": "ACCOUNT_BANNED"
}
```

- Optional: If you have a refresh cookie for that user, call POST `/api/auth/refresh` with that cookie; **expected** `403` and `code: ACCOUNT_BANNED` (and cookies cleared).

- Unban (cleanup):

```bash
curl -s -b cookies.txt -X POST "$BASE_URL/api/admin/users/TARGET_ID/unban"
```

---

## 7. Two-device simulation (optional)

1. **Device A:** Login as admin, GET `/api/admin/users`, note a normal user id and get their sessions: GET `/api/admin/users/:id/sessions`.
2. **Device B:** Login as that normal user in another terminal (different cookie file), get a new session.
3. **Device A:** As admin, revoke one of that user’s sessions (own user id + session id) → expect `200`.
4. **Device B:** Use the same session (e.g. call a protected endpoint) → expect `401` (session revoked).

---

## Summary

| Check | Endpoint / action | Expected |
|-------|-------------------|----------|
| Users list stable keys | GET /api/admin/users | 200, each user has required keys and types |
| Diagnostics shape | GET /api/admin/diagnostics/:userId | 200, exact keys including metrics subkeys |
| Diagnostics 404 | GET /api/admin/diagnostics/random-id | 404, code NOT_FOUND |
| Revoke other’s session | POST .../users/:id/sessions/:sessionId/revoke (id ≠ session owner) | 403, code FORBIDDEN |
| Ban blocks login | Ban user → POST /api/login as that user | 403, code ACCOUNT_BANNED |
| Ban blocks refresh | Ban user → POST /api/auth/refresh with that user’s cookie | 403, code ACCOUNT_BANNED |

Automated tests covering the same contract live in:

- `backend/tests/admin/phase2-admin-users.test.js`
- `backend/tests/diagnostics/diagnostics.test.js` (diagnostics shape + 404)
