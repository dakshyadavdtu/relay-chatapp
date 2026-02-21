# Phase 5.2: Message State Machine

Frontend state machine mirrors `backend/models/message.state.js` and `backend/websocket/STATE_MACHINE.md`.

---

## States

| State     | Meaning                                                                 |
|-----------|-------------------------------------------------------------------------|
| **sending** | Transient: client sent, server accepted but not yet persisted.          |
| **sent**    | Message persisted. May or may not have been delivered.                  |
| **delivered** | Recipient confirmed delivery (MESSAGE_DELIVERED_CONFIRM / CLIENT_ACK delivered). |
| **read**     | Recipient marked as read. Terminal.                                     |

---

## Transition Table

| Current   | Event            | Next      | Allowed |
|-----------|------------------|-----------|---------|
| (none)    | Send accepted    | sending   | ✓       |
| sending   | Persist success  | sent      | ✓       |
| sent      | Delivery confirm | delivered | ✓       |
| delivered | Read confirm     | read      | ✓       |
| read      | —                | —         | terminal |

### Invalid Transitions (ignored by frontend)

| From      | To        | Reason                        |
|-----------|-----------|-------------------------------|
| sent      | read      | Must be delivered first       |
| sent      | sending   | Cannot roll back              |
| delivered | sent      | Cannot roll back              |
| delivered | sending   | Cannot roll back              |
| read      | any       | Terminal state                |
| sending   | delivered | Must persist first            |
| sending   | read      | Must persist and deliver first|

---

## Backend Handlers

| Handler                     | Payload          | Effect                                  |
|-----------------------------|------------------|-----------------------------------------|
| MESSAGE_DELIVERED_CONFIRM   | { messageId }    | sent → delivered (or idempotent)        |
| MESSAGE_READ / MESSAGE_READ_CONFIRM | { messageId } | delivered → read (or idempotent)        |
| CLIENT_ACK                  | { messageId, ackType } | delivered or read (ackType: "delivered" \| "read") |

---

## Frontend Behavior

### Delivery confirmations (idempotent)

- **DM**: `clientAckSentRef` tracks messageIds we've sent `MESSAGE_DELIVERED_CONFIRM` for.
- Send exactly once per message per client.
- Do not send for replayed messages (`msg.isReplay === true`).

### Read confirmations

- Only send `MESSAGE_READ` when message is delivered or read (can transition to read).
- On `INVALID_TRANSITION`: schedule retry with bounded backoff (300, 600, 900, 1200, 2000 ms, max 5 attempts).

### State updates

- `updateMessageStatusByMessageId` uses `applyStateUpdate` from `messageStateMachine.js`.
- Stale transitions (e.g., read after already read) are ignored.
- `STATE_SYNC_RESPONSE` delivered/read arrays: applied directly (authoritative).

### ACK reconciliation

- Optimistic messages reconcile by `clientMessageId` only (never by content).
- `replaceMessage(chatId, clientMessageId, newMessage)` replaces by client ID.
- Duplicates dropped: same `messageId` or `roomMessageId` = skip insert.

### Replay / Resume

- Replayed messages have `isReplay: true`, state `delivered`.
- No `MESSAGE_DELIVERED_CONFIRM` sent for replayed messages.
- `STATE_SYNC_RESPONSE` `deliveredMessageIds` / `readMessageIds` reconcile local store fully.

---

## Files

- `src/lib/messageStateMachine.js` – transition helpers
- `src/features/chat/adapters/ChatAdapterContext.jsx` – DM/room message updates
