# Phase 4.5: Room Replay/Resume/State Sync – Verification

**Backend supports room replay.** RESUME uses a global `lastSeenMessageId`; the backend replays both DM and room messages after that ID. Room messages are emitted as `ROOM_MESSAGE` during replay.

---

## Backend Behavior (Source of Truth)

| Message    | roomId field? | Behavior                                                                 |
|------------|---------------|---------------------------------------------------------------------------|
| RESUME     | No            | Payload: `{ lastSeenMessageId?, limit? }`. Replays all undelivered messages (DM + room) after that ID. |
| MESSAGE_REPLAY | No         | Same as RESUME; used when `STATE_SYNC_RESPONSE.hasMoreMessages` is true. |
| STATE_SYNC | No            | Payload: `{ lastMessageId?, lastReadMessageId? }`. Returns state sync response. |

- **Room replay:** `replay.service.js` emits `ROOM_MESSAGE` for room messages (with `roomId`, `roomMessageId`, `messageId`).
- **Per-recipient IDs:** Room messages use per-recipient `messageId` (e.g. `rm_xxx_userId`) for ordering and delivery tracking.
- **No room-specific RESUME:** One global `lastSeenMessageId` covers all conversations.

---

## Frontend Implementation

1. **Track lastSeenMessageId (global):**
   - `resume.state.js` stores one `lastSeenMessageId` for RESUME.
   - Updated on `MESSAGE_RECEIVE` (DM) and `ROOM_MESSAGE` (room).

2. **On reconnect:**
   - `HELLO_ACK` → `sendResume(getLastSeenMessageId())`.
   - Backend sends `RESYNC_START` → N× `ROOM_MESSAGE` / `MESSAGE_RECEIVE` → `RESYNC_COMPLETE`.

3. **Merge replay messages:**
   - `ROOM_MESSAGE` handler merges into `messagesByConversation[roomId]` with dedupe by `roomMessageId`.
   - Append order matches backend (ordered by `messageId`).
   - Calls `updateLastSeenMessageId(msg.messageId)` on each `ROOM_MESSAGE`.

4. **MESSAGE_STATE_UPDATE for rooms:**
   - Room messages store `messageId` (per-recipient) for status updates.
   - `updateMessageStatusByMessageId` matches by `m.id` or `m.messageId` so room messages are updated correctly.

---

## Verification Steps

### 1. Disconnect/reconnect in a room – no missing messages

1. Open a room and receive at least 3 messages.
2. Disconnect WebSocket (network off or dev tools).
3. Have another user send 2–3 more messages while you are disconnected.
4. Reconnect (network on).
5. **Expect:** All messages appear, including those sent during disconnect.
6. **Expect:** No gaps in the message list.

### 2. No duplicates

1. Open a room and receive messages.
2. Disconnect, then reconnect quickly.
3. **Expect:** Each room message appears exactly once (no duplicates).
4. **Expect:** Deduplication by `roomMessageId` prevents duplicates on replay.

### 3. lastSeenMessageId updates on ROOM_MESSAGE

1. In DevTools console: `localStorage.getItem('chat:lastSeenMessageId')`.
2. Receive new room messages.
3. Check again – value should advance (string compare).
4. Reconnect – replay should not re-send messages already in view.

### 4. MESSAGE_STATE_UPDATE for room messages

1. If backend sends `MESSAGE_STATE_UPDATE` for room messages (delivered/read).
2. **Expect:** Room message status updates (e.g. delivered → read) in the UI.
3. `updateMessageStatusByMessageId` should update by `messageId` or `id`.

---

## Files Changed

| File | Change |
|------|--------|
| `ChatAdapterContext.jsx` | `updateLastSeenMessageId(msg.messageId)` on `ROOM_MESSAGE`; store `messageId` in normalized room message; `updateMessageStatusByMessageId` matches by `m.messageId` for rooms. |

---

## Coverage

- `ROOM_MESSAGE` (live + replay): handled; updates lastSeen, merges with dedupe.
- `RESUME`: unchanged; uses global lastSeenMessageId.
- `MESSAGE_STATE_UPDATE`: now applies to room messages via `messageId` match.
