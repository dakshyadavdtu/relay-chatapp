# Phase 3C RESUME + Replay/Sync – Verification Steps

## Backend schema (discovered)

### RESUME (client → server)
- `{ type: "RESUME", lastSeenMessageId?: string, limit?: number }`
- Server: sends RESYNC_START → N× MESSAGE_RECEIVE → RESYNC_COMPLETE { messageCount }

### MESSAGE_REPLAY (client → server)
- `{ type: "MESSAGE_REPLAY", lastMessageId?: string, limit?: number }`
- Server: pushes N× MESSAGE_RECEIVE, then MESSAGE_REPLAY_COMPLETE { messageCount, lastMessageId, requestedAfter }

### STATE_SYNC (client → server)
- `{ type: "STATE_SYNC", lastMessageId?: string, lastReadMessageId?: string }`
- Server: returns STATE_SYNC_RESPONSE { presence, undeliveredCount, hasMoreMessages, deliveredMessageIds, readMessageIds }

### CLIENT_ACK (client → server)
- `{ type: "CLIENT_ACK", messageId: string, ackType?: string }`
- Backend: implemented in readAck handler

---

## Manual verification

### 1. RESUME flow (reconnect)
1. Log in as userA in browser 1.
2. Log in as userB in browser 2.
3. UserB sends message to userA; userA receives.
4. Stop backend (Ctrl+C).
5. UserB sends another message (will fail).
6. Restart backend.
7. Frontend auto-reconnects; HELLO → HELLO_ACK → RESUME(lastSeenMessageId).
8. Verify: userA receives the message userB sent while backend was down (after reconnect).
9. Console: `[ws] connected`; no duplicate messages.

### 2. No gaps
- Send messages from userB while userA’s tab is open but disconnected.
- Reconnect.
- userA must see all missed messages in order.

### 3. No dupes
- After reconnect + replay, count messages in the thread.
- Compare with expected count (no duplicate rows).
- Dedupe: `list.some((x) => String(x.id) === String(msg.messageId))` prevents duplicates.

### 4. lastSeen persistence
- Receive messages, note last message id.
- Refresh page.
- On connect, RESUME is sent with lastSeenMessageId (from localStorage if used).
- Backend should not replay messages already received.

### 5. Replay loading indicator
- During RESUME replay, `isReplaying` is true.
- RESYNC_START → setIsReplaying(true); RESYNC_COMPLETE → setIsReplaying(false).
- Optional: show “Syncing…” in UI when `isReplaying`.

---

## Log locations
- `[ws] connected` – wsClient on HELLO_ACK
- RESUME sent immediately after HELLO_ACK (ChatAdapterContext)
- RESYNC_START / RESYNC_COMPLETE – handled in ChatAdapterContext
