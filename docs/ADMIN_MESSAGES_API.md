# Admin Messages API — Manual verification

**Endpoint:** `GET /api/admin/messages`  
**Auth:** requireAuth + requireAdmin. JWT from **cookie** (default name `token`) or **Authorization: Bearer &lt;token&gt;** (checked first for curl/dev).

---

## Authentication

- **Browser:** Session cookie is sent automatically after login (`JWT_COOKIE_NAME`, default `token`).
- **curl:** Use `Authorization: Bearer <accessToken>`. Obtain a token via login (e.g. `POST /api/login`) and copy the access token from the response or cookie.

---

## cURL examples

Replace `BASE` with your API base (e.g. `http://localhost:3000`). Replace `YOUR_JWT` with a valid admin access token.

### 1. First page (no cursor)

```bash
curl -s -X GET \
  "${BASE}/api/admin/messages?conversationId=direct:user1:user2&limit=50" \
  -H "Authorization: Bearer YOUR_JWT"
```

### 2. Next page (using cursor from previous response)

Use `nextCursor` from the previous response as the `before` parameter:

```bash
curl -s -X GET \
  "${BASE}/api/admin/messages?conversationId=direct:user1:user2&limit=50&before=NEXT_CURSOR_FROM_PREV_RESPONSE" \
  -H "Authorization: Bearer YOUR_JWT"
```

### 3. Filter by sender

Only messages where `senderId` equals the given id:

```bash
curl -s -X GET \
  "${BASE}/api/admin/messages?conversationId=room:room_abc&limit=50&senderId=user123" \
  -H "Authorization: Bearer YOUR_JWT"
```

**Query params:**

| Param             | Required | Description |
|-------------------|----------|-------------|
| `conversationId`  | Yes      | `direct:u1:u2` or `room:&lt;roomId&gt;` |
| `limit`           | Yes      | Page size, 1–100 (clamped) |
| `before`          | No       | Cursor for next page (id of last message from previous page) |
| `senderId`        | No       | Filter to messages from this sender |

---

## Frontend integration

- **Order:** Messages are **newest-first** (descending by time; first page = most recent).
- **Recommended request pattern:**
  - **First load:** `conversationId` + `limit=50` (no `before`). Append `data.messages` to the list.
  - **Infinite scroll (load older):** Same `conversationId` and `limit`, add `before=data.nextCursor` from the last response. Append the new `data.messages` below (older messages). Stop when `data.hasMore === false`.
  - **Filter by sender:** Add `senderId` from a UI dropdown (e.g. list of participants). Omit `senderId` to show all. When changing sender, refetch from first page (no `before`).

---

## Response shape (success)

Matches `sendSuccess` format:

```json
{
  "success": true,
  "data": {
    "conversationId": "direct:user1:user2",
    "messages": [
      {
        "id": "msg_xxx",
        "messageId": "msg_xxx",
        "roomMessageId": null,
        "roomId": null,
        "senderId": "user1",
        "recipientId": "user2",
        "content": "Hello",
        "createdAt": 1234567890123,
        "timestamp": 1234567890123,
        "state": "delivered",
        "messageType": "direct",
        "editedAt": null,
        "deleted": false,
        "deletedAt": null
      }
    ],
    "nextCursor": "msg_yyy",
    "hasMore": true
  }
}
```

- **Room messages:** `roomMessageId` and `roomId` will be set; `id` is typically `roomMessageId` when present.
- **Empty or no match:** `messages: []`, `nextCursor: null`, `hasMore: false`.

---

## Safety

- **Limit:** Always clamped to 1–100; no default — client must send `limit`.
- **conversationId / cursor / senderId:** Max lengths 256 and 128 respectively (no unbounded query params).
- **Logging:** Server logs **do not** include message content. Only metadata is logged: `conversationId`, `limit`, whether `senderId` was present, and `hasMore`.
- **Access:** Non-admin users receive **403**. Message list is never returned without admin role.
- **TODO:** For very large chats, implement storage-level pagination later to avoid loading full history into memory.

---

## Quick test checklist

1. **401** without token (or invalid token).
2. **403** with valid non-admin token.
3. **400** missing `conversationId` or `limit`, or invalid format.
4. **200** with valid admin token, `conversationId` + `limit`; verify `data.messages`, `data.nextCursor`, `data.hasMore`.
5. Next page: use `before=<data.nextCursor>`; verify different/older messages.
6. Filter: add `senderId`; verify only that sender’s messages.
