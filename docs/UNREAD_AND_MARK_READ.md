# Unread count and mark-read flow

## Source of truth (persistent)

- **Backend** is the source of truth for `unreadCount` in `GET /api/chats` and `GET /api/chats/:chatId`.
- Unread is **persistent** and computed from a **DB-backed read cursor** (Mongo collection `chat_read_cursors`), not from in-memory delivery store.
- **Rule:** `unreadCount` = number of messages from the other participant with `message.timestamp > lastReadTimestamp`. `lastReadTimestamp` comes from the cursor’s `lastReadMessageId` (resolved to message timestamp) or `cursor.lastReadAt` if the message was purged. No `message.state` checks.

## Read cursor store

- **backend/chat/readCursorStore.mongo.js**
- Collection: `chat_read_cursors`. Document: `{ userId, chatId, lastReadMessageId, lastReadAt, updatedAt }`. Unique index: `(userId, chatId)`.
- `getCursor(userId, chatId)`, `upsertCursor(userId, chatId, lastReadMessageId, lastReadAt)`, `bulkGetCursors(userId, chatIds)` for chat list (avoids N+1).

## Mark-read (persistent cursor)

- **POST /api/chats/:chatId/read**  
  Body: `{ lastReadMessageId: string }`.  
  Validates user is participant and message belongs to chat; upserts cursor with `lastReadAt = message.timestamp ?? Date.now()`. Unread survives **refresh and backend restart**.

- **POST /api/chats/:chatId/mark-read** (legacy)  
  Updates in-memory delivery store only; use `/read` for persistent unread.

- **WS MESSAGE_READ**  
  Still updates delivery store; unread **persistence** is driven only by POST `/read` and the cursor.

## Frontend

- When opening a DM, a ref guard ensures mark-read runs only when `(chatId, latestMsgId)` changes (no loop).
- Frontend calls **POST /api/chats/:chatId/read** with `lastReadMessageId` (see `markChatRead` in `features/chat/api/chat.api.js`).
- After success, unread for that chat is set to 0 optimistically; next `GET /api/chats` returns cursor-based unread.

## Verification

1. UserB receives 5 messages → `GET /api/chats` shows unreadCount = 5.
2. UserB opens chat → POST `/read` with latest message id → unreadCount = 0.
3. **Refresh page** (no backend restart) → unread stays 0 (cursor in Mongo).
4. **Restart backend** → unread stays 0 (cursor in Mongo).

## Terminal (with auth)

```bash
# Login and save cookie
curl -c /tmp/cj -s -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"userB","password":"..."}'

# Chat list (unreadCount from backend cursor)
curl -b /tmp/cj -s http://localhost:8000/api/chats | jq '.data.chats[] | { chatId, unreadCount }'

# Persist read cursor (replace chatId and messageId)
curl -b /tmp/cj -s -X POST http://localhost:8000/api/chats/direct%3Au1%3Au2/read \
  -H "Content-Type: application/json" \
  -d '{"lastReadMessageId":"<messageId>"}'

# Again: unread should be 0
curl -b /tmp/cj -s http://localhost:8000/api/chats | jq
```

## Inspect cursor (script)

From backend dir (requires DB_URI):

```bash
node scripts/print_read_cursor.js --userId <userId> --chatId direct:u1:u2
```

## DEV-only: chat list without cookie

When `NODE_ENV !== 'production'`:

```bash
curl -s "http://localhost:8000/api/dev/chats/list?asUserId=<userId>" | jq '.data.chats[] | { chatId, unreadCount }'
```
