# Debug: "Invalid last message not found in database" (repeated toast)

## Summary

The toast appears because the frontend sometimes stores **`m.id`** (which for room history is **roomMessageId**) as the last-seen message id, while the backend replay and DB lookup use **messageId** only. Sending that stored value in RESUME or MESSAGE_REPLAY causes the backend to return `INVALID_LAST_MESSAGE_ID`; the client then shows the backend error text as the toast.

---

## 1. Where the wrong id is stored

**File:** `myfrontend/frontend/src/features/chat/adapters/ChatAdapterContext.jsx`  
**Function:** `loadMessages` (callback used for loading chat history)  
**Line:** **1861**

```js
normalized.forEach((m) => m?.id && updateLastSeenMessageId(m.id));
```

- **Issue:** Uses **`m.id`** instead of **`m.messageId`**.
- **Effect:** After `normalizeMessage()`, for **room** messages the API shape gives `id = roomMessageId || messageId` (see backend `utils/apiShape.js` → `toApiMessage`: `id = msg.roomMessageId || msg.messageId`). So for room history, `m.id` is **roomMessageId**. Storing that in last-seen state means we persist a **roomMessageId** under the key used for RESUME/MESSAGE_REPLAY, while the backend expects a **messageId**.

**Correct usages of `updateLastSeenMessageId` in the same file:**

- **Line 357** (incoming DM handler): `updateLastSeenMessageId(msg.messageId)` — correct.
- **Line 1076** (ROOM_MESSAGE handler): `if (msg.messageId) updateLastSeenMessageId(msg.messageId)` — correct.

So the only call that can store the wrong id is the one in **loadMessages** at line **1861** using **`m.id`**.

---

## 2. Where RESUME is sent with that stored id

**File:** `myfrontend/frontend/src/features/chat/adapters/ChatAdapterContext.jsx`  
**Branch:** `msg.type === "HELLO_ACK"`  
**Lines:** **624–625**

```js
const lastSeen = getLastSeenMessageId();
wsClient.sendResume(lastSeen);
```

- **Source of `lastSeen`:** `getLastSeenMessageId()` from `myfrontend/frontend/src/state/resume.state.js`, which reads from in-memory `memoryLastSeen` (and optionally `localStorage` key **`chat:lastSeenMessageId`**). That value is updated by `updateLastSeenMessageId(...)` — including the wrong one from `loadMessages` when history was loaded with `m.id`.

So when the user has loaded room history, the stored last-seen can be a **roomMessageId**. On next connect, HELLO_ACK runs and **RESUME is sent with that stored id** (the wrong one).

---

## 3. Where MESSAGE_REPLAY is sent with that stored id (toast trigger)

**File:** `myfrontend/frontend/src/features/chat/adapters/ChatAdapterContext.jsx`  
**Branch:** `msg.type === "STATE_SYNC_RESPONSE"` when `msg.hasMoreMessages && msg.undeliveredCount > 0`  
**Lines:** **695–696**

```js
if (msg.hasMoreMessages && msg.undeliveredCount > 0) {
  wsClient.sendMessageReplay(getLastSeenMessageId());
}
```

- Same stored value from **resume.state.js** is sent as **MESSAGE_REPLAY**’s `lastMessageId`. When that value is a roomMessageId (or any id not present as messageId in the DB), the backend responds with **MESSAGE_ERROR** and the client shows the toast.

---

## 4. Backend: where INVALID_LAST_MESSAGE_ID is returned

**File:** `backend/services/replay.service.js`  
**Function:** `replayMessages(userId, lastMessageId, limit, context)`  
**Lines:** **75–95**

When `lastMessageId` is provided:

1. Backend calls `dbAdapter.getMessage(lastMessageId)` (line 78).
2. If the message is not found (`!lastMsg`), it returns (lines 88–95):

```js
return {
  type: 'MESSAGE_ERROR',
  error: 'Invalid lastMessageId: message not found in database',
  code: ErrorCodes.INVALID_LAST_MESSAGE_ID,
  lastMessageId,
};
```

- **DB lookup:** `getMessage(messageId)` in `backend/config/db.js` (line 24) looks up by **messageId** only. Passing a **roomMessageId** (or any non-messageId) results in no row, so this branch is hit.

**Which WS message triggers this path?**

- **RESUME:** `backend/websocket/handlers/reconnect.js` → `handleResume` (line 109) reads `payload.lastSeenMessageId` and calls `replayService.replayMessages(userId, lastSeenMessageId, ...)` (line 136). So **RESUME** can trigger the invalid lastMessageId path inside `replay.service.js`. The handler does **not** send this error back to the client; it continues and sends RESYNC_COMPLETE etc.
- **MESSAGE_REPLAY:** `handleMessageReplay` (line 46) calls `replayService.replayMessages(userId, lastMessageId, ...)` and **returns** the result. The router sends that response to the client. So when the result is `MESSAGE_ERROR` with `INVALID_LAST_MESSAGE_ID`, the **client receives it** and shows the toast.

So:

- **Backend line that throws/returns INVALID_LAST_MESSAGE_ID:** `backend/services/replay.service.js` **88–95** (`replayMessages`).
- **Incoming WS message that triggers the check:** both **RESUME** and **MESSAGE_REPLAY** (both call `replayMessages` with the client-supplied id).
- **Incoming WS message that causes the toast:** **MESSAGE_REPLAY** (only this handler returns the error to the client; RESUME does not).

---

## 5. Resume state storage (reference)

**File:** `myfrontend/frontend/src/state/resume.state.js`  
- **Storage key:** `chat:lastSeenMessageId` (localStorage and in-memory).  
- **Updated by:** `updateLastSeenMessageId(messageId)` (line 37).  
- **Read by:** `getLastSeenMessageId()` (line 30), used when sending RESUME and MESSAGE_REPLAY.

---

## 6. Exact line checklist

| Location | File | Function / branch | Line(s) |
|----------|------|-------------------|--------|
| Wrong id stored | `ChatAdapterContext.jsx` | `loadMessages` | **1861** (`m.id` → `updateLastSeenMessageId(m.id)`) |
| RESUME sent with stored id | `ChatAdapterContext.jsx` | HELLO_ACK branch | **624–625** (`getLastSeenMessageId()` → `sendResume(lastSeen)`) |
| MESSAGE_REPLAY sent with stored id | `ChatAdapterContext.jsx` | STATE_SYNC_RESPONSE, hasMoreMessages | **695–696** (`getLastSeenMessageId()` → `sendMessageReplay(...)`) |
| Backend returns INVALID_LAST_MESSAGE_ID | `backend/services/replay.service.js` | `replayMessages` | **88–95** |
| WS trigger for replay (and for error path) | `backend/websocket/handlers/reconnect.js` | `handleResume` / `handleMessageReplay` | RESUME: **109, 136**; MESSAGE_REPLAY: **46** |

No fixes were applied in this phase; this is a proof/audit note only.
