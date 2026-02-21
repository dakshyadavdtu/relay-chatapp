# Unread badge = total messages after refresh — root cause proof

## Summary

On refresh, unread counts are re-fetched from the backend. The backend computes unread from **readCursorStore** (DB). The frontend only sends **MESSAGE_READ** over WebSocket and clears local state; it **never** calls **POST /api/chats/:chatId/read**, so the read cursor is never persisted. After refresh, the backend has no cursor → `lastReadTs = 0` → every received message counts as unread.

---

## 1) Frontend: where unreadCounts are hydrated on load/refresh

**File:** `myfrontend/frontend/src/features/chat/adapters/ChatAdapterContext.jsx`  
**Function:** `loadChats` (lines 1566–1706)

- Calls `getChatsApi()` (GET /api/chats).
- In the response handler (lines 1580–1589), sets `unreadCounts` from each chat’s `c.unreadCount`:

```javascript
setUnreadCounts((prev) => {
  const next = { ...prev };
  list.forEach((c) => {
    if (c.chatId != null && typeof c.unreadCount === "number") {
      const normalizedId = normalizeConversationId(c.chatId);
      next[normalizedId] = c.unreadCount;
    }
  });
  return next;
});
```

**Conclusion:** Unread counts on app load/refresh come solely from GET /api/chats response `unreadCount`.

---

## 2) Frontend: where messages are marked read when user opens/views a DM

**File:** `myfrontend/frontend/src/features/chat/adapters/ChatAdapterContext.jsx`

**Places that clear local unread and send MESSAGE_READ (no POST read):**

1. **Opening a conversation** (lines ~1397–1406):  
   - `setUnreadCounts(..., 0)` for the conversation.  
   - `wsClient.sendMessageRead(latestMessageId)`.

2. **markAsReadForConversation** (lines 2121–2188):  
   - Sends `wsClient.sendMessageRead(latestMessageId)` (line 2176).  
   - Clears local unread: `setUnreadCounts(..., 0)` (lines 2179–2180).  
   - Updates `lastReadMessageIdByConversation` locally.  
   - **Does not** call `markChatRead` (POST /api/chats/:chatId/read).

**API:** `markChatRead(conversationId, lastReadMessageId)` exists in  
`myfrontend/frontend/src/features/chat/api/chat.api.js` (lines 18–33) and performs POST `/api/chats/${chatId}/read` with `{ lastReadMessageId }`. It is **never called** from ChatAdapterContext or from any code path that runs when the user opens/views a DM.

**Conclusion:** When the user opens/views a DM, the frontend only sends MESSAGE_READ over WebSocket and clears local unreadCounts; it does **not** call POST /api/chats/:chatId/read.

---

## 3) Backend: GET /api/chats unreadCount uses readCursorStore; missing cursor ⇒ all messages unread

**File:** `backend/http/controllers/chat.controller.js`

- **getChats** (lines 293–363):  
  - Gets cursors: `cursorMap = await readCursorStore.bulkGetCursors(userId, chatIds)` (line 321).  
  - For each chat: `cursor = cursorMap.get(chatId) || null` (line 336).  
  - Unread: `unreadCount = await getUnreadCountWithCursor(chatId, userId, cursor, recipientMessages)` (line 338).

- **getUnreadCountWithCursor** (lines 199–223):  
  - `lastReadTs = await resolveLastReadTimestamp(userId, chatId, cursor?.lastReadMessageId)` (line 210).  
  - If still 0: `if (lastReadTs === 0 && cursor?.lastReadAt != null) lastReadTs = cursor.lastReadAt` (line 211).  
  - Counts unread: for each message from the other participant, `if (ts > lastReadTs) unreadCount++` (lines 214–216).

- **resolveLastReadTimestamp** (lines 181–188):  
  - Returns `0` if `lastReadMessageId` is null/empty or message not found.

So when **no cursor exists** (frontend never called POST read):

- `cursor` is `null` → `cursor?.lastReadMessageId` and `cursor?.lastReadAt` are undefined.  
- `lastReadTs` remains **0**.  
- Every message from the other participant with `ts > 0` is counted as unread.  
- **unreadCount = all received messages** from the other participant.

**Persisting the cursor:** Only **markChatRead** (lines 352–369) writes the cursor:  
`await readCursorStore.upsertCursor(userId, chatId, lastReadMessageId, lastReadAt)` (line 368).  
The WebSocket **readAck** handler (`backend/websocket/handlers/readAck.js`) calls `messageService.markRead` only; it does **not** use readCursorStore (and `message.service.js` does not reference readCursorStore in the markRead path).

**Conclusion:** GET /api/chats unreadCount is driven by readCursorStore. Missing cursor (never persisted) ⇒ lastReadTs = 0 ⇒ unreadCount = all received messages. Persistence is only done by POST /api/chats/:chatId/read (markChatRead), which the frontend never calls.

---

## Missing call (root cause)

**Missing:** After the frontend sends **MESSAGE_READ** (and/or when it clears local unread for a DM), it should also call **POST /api/chats/:chatId/read** with the same `lastReadMessageId` so the backend can persist the read cursor in **readCursorStore**. Without that, on the next load/refresh, GET /api/chats still sees no cursor and returns unreadCount = total received messages.

**Exact missing call:**  
From the frontend, when marking a DM as read (e.g. in `markAsReadForConversation` or in the “open conversation” path that calls `wsClient.sendMessageRead(latestMessageId)`), call:

- **markChatRead(conversationId, lastReadMessageId)**  
  (from `myfrontend/frontend/src/features/chat/api/chat.api.js`),  
  which performs **POST /api/chats/:chatId/read** with body `{ lastReadMessageId }`.

No code changes were made; this document is proof only.
