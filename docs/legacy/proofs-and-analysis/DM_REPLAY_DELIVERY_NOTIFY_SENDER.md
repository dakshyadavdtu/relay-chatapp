# DM replay: notify sender on delivery (double tick)

## Problem

When the recipient was offline at send time, the sender saw a single tick. When the recipient came online and received messages via replay, the sender was **not** notified, so the tick did not become double without a refresh.

**Root cause:** The replay service marked messages as DELIVERED and emitted only to the reconnecting user (recipient). The sender was never sent a `MESSAGE_STATE_UPDATE`.

---

## Solution summary

1. After marking a replayed DM as delivered, **also** emit `MESSAGE_STATE_UPDATE` to **all** of the sender’s active sockets (all tabs).
2. Use a socket fan-out helper so every connection for the sender gets the update.
3. Emit only when we actually transition from non-delivered to DELIVERED (idempotent).
4. Frontend: ensure `MESSAGE_STATE_UPDATE` is handled and state is normalized to `"delivered"`.

---

## Exact file and line changes

### 1. `backend/websocket/services/message.service.js`

- **After** `sendToUserSocket` (around line 84): add a new function:
  - `sendToAllUserSockets(userId, message, context = {})`  
  - Implementation: `return sendToUserSocket(userId, message, context);`  
  - (Same behaviour; name makes “all sockets” intent explicit.)
- **Exports:** add `sendToAllUserSockets` to `module.exports`.

### 2. `backend/services/replay.service.js`

- **Require (line 42):**  
  - From: `const { sendToUserSocket } = require('../websocket/services/message.service');`  
  - To: `const { sendToAllUserSockets } = require('../websocket/services/message.service');`

- **Loop after building payload for recipient (after `messagesToEmit.push(payload)` and `lastReplayedId = msg.messageId`):**
  - Add a DM-only block that runs only when `replayType === 'MESSAGE_RECEIVE' && msg.senderId`.
  - **Idempotency:** This block runs only when we did **not** `continue` earlier (i.e. we passed both `alreadyDeliveredInDb` and `isDeliveredInMemory` checks), so we only emit when we actually transitioned to DELIVERED. No extra guard needed.
  - **Emit to sender:**  
    - Build payload: `{ type: 'MESSAGE_STATE_UPDATE', messageId: msg.messageId, state: MessageState.DELIVERED }`.  
    - Call: `sendToAllUserSockets(msg.senderId, senderUpdate, { correlationId, messageId: msg.messageId });`  
  - So the sender is notified on **all** their sockets, not the reconnecting user.

- **Room path:** For consistency, the existing room sender notification can use `sendToAllUserSockets` instead of `sendToUserSocket` (same behaviour; one import).

### 3. `myfrontend/frontend/src/features/chat/adapters/ChatAdapterContext.jsx`

- **Import:** Add `normalizeState as normalizeMessageState` from `@/lib/messageStateMachine`.
- **WS handler for `MESSAGE_STATE_UPDATE`:**  
  - Ensure it calls `updateMessageStatusRef.current(id, status, false, msg.roomMessageId ?? msg.messageId)` with:
    - `id = msg.messageId ?? msg.roomMessageId`
    - `status = normalizeMessageState(msg.state) ?? msg.state`  
  - So both `"DELIVERED"` and `"delivered"` from the backend map to the canonical `"delivered"` used by the FSM and ticks.

---

## Event shape

**Emitted to sender (all of sender’s sockets):**

- **Type:** `MESSAGE_STATE_UPDATE`
- **Payload (top-level, same object sent over the wire):**
  - `type`: `"MESSAGE_STATE_UPDATE"`
  - `messageId`: `<msg.messageId>` (string)
  - `state`: `"delivered"` (backend `MessageState.DELIVERED`)

No nested `payload` property; the frontend reads `msg.messageId` and `msg.state` directly.

---

## Repro steps

1. **B offline, A sends DM**
   - Log in as A in one tab/window; log in as B in another (or same browser, different user).
   - Take B offline (close tab, disconnect, or simulate offline).
   - From A, send a DM to B.
   - **Expected:** A sees a **single tick** (sent, not delivered).

2. **B comes online and opens DM (replay)**
   - Bring B back online and open the DM with A (or trigger resume/replay so B receives the replayed message).
   - **Expected:**  
     - B receives the message (replay).  
     - **A’s UI updates to double tick without refresh** (A receives `MESSAGE_STATE_UPDATE` on their socket(s) and the tick goes from single to double).

3. **Idempotency**
   - If the same message is replayed again (e.g. duplicate reconnect or replay), the backend skips it (already delivered in DB/memory) and does **not** emit another `MESSAGE_STATE_UPDATE` for that message.

---

## Files touched

| File | Change |
|------|--------|
| `backend/websocket/services/message.service.js` | Add `sendToAllUserSockets`, export it. |
| `backend/services/replay.service.js` | Use `sendToAllUserSockets`; after marking replayed DM delivered, emit `MESSAGE_STATE_UPDATE` to sender; room path use same helper. |
| `myfrontend/frontend/src/features/chat/adapters/ChatAdapterContext.jsx` | Handle `MESSAGE_STATE_UPDATE` with `updateMessageStatusRef.current(messageId, status, …)` and normalize `msg.state` via `normalizeMessageState`. |
