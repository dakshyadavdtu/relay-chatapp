# Message Ticks & (offline) — Proof Document

This document traces where ticks and the "(offline)" label are rendered, how delivery status is set/updated (WS + state), how replay marks messages delivered without notifying the sender, how group messages are persisted (roomMessageId vs per-member messageId), and why refresh fixes stale ticks/offline.

---

## A) UI render point(s) for ticks + offline label

### Ticks (status icon)

- **File:** `myfrontend/frontend/src/features/chat/ui/ChatWindow.jsx`
  - **Lines 441–456:** `getStatusIcon(status, isMe)` — maps status to icon (Loader2 / Check / CheckCheck / AlertCircle) using `getStatusIconConfig(status, isMe)`.
  - **Line 679:** For own messages (`isMe`), the status icon is rendered: `{isMe && <span className="ml-1">{getStatusIcon(msg.status, isMe)}</span>}`.
- **File:** `myfrontend/frontend/src/features/chat/domain/message.js`
  - **Lines 61–77:** `getStatusIconConfig(status, isMe)` — returns `{ type, className }` for `sending`/`queued` → spinner, `sent` → single check, `delivered`/`read` → check-check, `failed` → alert-circle; only applies when `isMe` is true.
- **File:** `myfrontend/frontend/src/features/chat/group/RoomMessageList.jsx`
  - **Lines 123–137:** Same `getStatusIcon` / `getStatusIconConfig` pattern for group messages.
  - **Line 214:** `{isMe && <span className="ml-1">{getStatusIcon(msg.status, isMe)}</span>}` — ticks for sender’s group messages (no "(offline)" in group UI).

### "(offline)" label

- **File:** `myfrontend/frontend/src/features/chat/ui/ChatWindow.jsx`
  - **Lines 680–682:** Rendered only for own messages when `msg.deliveryStatus === "offline"`:
    - `{isMe && msg.deliveryStatus === "offline" && (`
    - `<span className="ml-1 text-[10px] text-muted-foreground" title="Recipient offline">(offline)</span>`
  - So: **single tick + "(offline)"** when the message has `status` from sent/delivered/read and `deliveryStatus === "offline"` (DM only; group list does not show this label).

---

## B) Frontend WS handler(s) that set delivered / offline

### DELIVERY_STATUS (DM)

- **File:** `myfrontend/frontend/src/features/chat/adapters/ChatAdapterContext.jsx`
  - **Lines 754–775:** On `msg.type === "DELIVERY_STATUS"` and `msg.messageId != null`:
    - `status === "DELIVERED"` → `updateMessageStatusRef.current(msg.messageId, "delivered", true)`.
    - `status === "SEEN"` → `updateMessageStatusRef.current(msg.messageId, "read", true)`.
    - `status === "RECIPIENT_OFFLINE"` → `setMessagesByConversation` finds the message by `msg.messageId` and sets `deliveryStatus: "offline"` (lines 760–774).

### MESSAGE_STATE_UPDATE / ACK_RESPONSE (DM + room)

- **Lines 776–781:** On `MESSAGE_STATE_UPDATE` or `ACK_RESPONSE` with `messageId` or `roomMessageId` and `state`, the frontend calls `updateMessageStatusRef.current(id, msg.state, false, msg.roomMessageId ?? msg.messageId)` so status (e.g. delivered/read) is applied; for rooms the alternate id is `roomMessageId` for matching the single bubble.

### STATE_SYNC_RESPONSE (delivered/read from sync)

- **Lines 703–711:** On `STATE_SYNC_RESPONSE`, `deliveredMessageIds` and `readMessageIds` are applied:
  - `deliveredIds.forEach((id) => updateMessageStatusRef.current(id, "delivered", true));`
  - `readIds.forEach((id) => updateMessageStatusRef.current(id, "read", true));`

### Status update implementation

- **Lines 2199–2222:** `updateMessageStatusByMessageId(messageId, status, forceSync, alternateId)` updates `messagesByConversation`: finds the message by `messageId` or `alternateId` (e.g. roomMessageId), applies FSM via `applyStateUpdateFsm` unless `forceSync`, and sets `status` on that message. This drives the tick icon and, for DMs, removal of "(offline)" when status becomes delivered/read.

---

## C) Backend send-time delivery emit point(s)

### DM: attemptDelivery → DELIVERY_STATUS to sender

- **File:** `backend/websocket/handlers/sendMessage.js`
  - **Lines 99–132:** After persist and ACK, `receivePayload` (MESSAGE_RECEIVE) is built; recipient is delivered via `wsMessageService.attemptDelivery(ack.messageId, receivePayload, { correlationId })`.
  - **Lines 124–132:** On resolution of `attemptDelivery`:
    - If `delivered === true` → sender gets `DELIVERY_STATUS` with `status: 'DELIVERED'`.
    - If `delivered === false` → sender gets `DELIVERY_STATUS` with `status: 'RECIPIENT_OFFLINE'`.
  - **Lines 133–142:** On `attemptDelivery` rejection, sender gets `DELIVERY_STATUS` with `status: 'RECIPIENT_OFFLINE'`.

### DM: attemptDelivery implementation

- **File:** `backend/websocket/services/message.service.js`
  - **Lines 94–202:** `attemptDelivery(messageId, message, context)` loads message, checks DB/memory idempotency, gets recipient sockets; if no sockets returns `false` (so sendMessage handler sends RECIPIENT_OFFLINE); otherwise sends to all recipient sockets and returns `true` when any queued.

So the only real-time path that tells the sender “delivered” vs “recipient offline” is this `attemptDelivery` → `DELIVERY_STATUS` flow. If that WS frame is lost or the sender never gets it, the sender keeps single tick + (offline) until another source updates status (e.g. STATE_SYNC_RESPONSE or history).

---

## D) Backend replay: where delivered is updated and that sender is NOT notified

### Replay marks messages delivered (DB + memory)

- **File:** `backend/services/replay.service.js`
  - **Lines 198–210:** For each replayed message, after idempotency checks (DB and memory):
    - `await dbAdapter.updateMessageState(msg.messageId, MessageState.DELIVERED);`
    - `await dbAdapter.markMessageDelivered(msg.messageId, userId);`
    - `deliveryService.transitionState(msg.messageId, userId, ...)`
    - In-memory `messageStore` is synced to `MessageState.DELIVERED` (lines 207–209).
  - **Lines 211–224:** A payload is built with `type: replayType` (MESSAGE_RECEIVE or ROOM_MESSAGE), `state: MessageState.DELIVERED`, `isReplay: true`, and pushed to `messagesToEmit`. No `DELIVERY_STATUS` or `MESSAGE_STATE_UPDATE` is created for the sender.

### Replay emit: only to reconnecting user (recipient)

- **File:** `backend/websocket/handlers/reconnect.js`
  - **Lines 57–61:** When `result.type === 'MESSAGE_REPLAY_COMPLETE'` and there are messages, each message is sent only to the reconnecting user: `sendToUserSocket(userId, msg, ...)` (userId = recipient). There is no call to `sendToUserSocket(senderId, ...)` for DELIVERY_STATUS or MESSAGE_STATE_UPDATE.

So: **replay marks messages as delivered in DB and memory and emits only to the recipient. The sender is never notified.** If the sender never received DELIVERY_STATUS at send time (e.g. recipient was offline, then reconnected and replay ran), the sender’s UI stays at single tick + (offline) until the sender gets a source that carries the true state (e.g. STATE_SYNC_RESPONSE or history load).

---

## E) Group message id generation and why sender’s self-copy shows “delivered” immediately

### roomMessageId vs per-member messageId

- **File:** `backend/websocket/services/group.service.js`
  - **Lines 19–21:** `generateMessageId()` returns `rm_${Date.now()}_${random}` — one **roomMessageId** per logical room message.
  - **Lines 91, 112–114:** For each member, a **per-member messageId** is created: `messageId = \`rm_${roomMessageId}_${memberId}\``. So the sender has a row with `messageId = rm_<roomMessageId>_<senderId>`.
  - **Lines 98–105:** One canonical room message is persisted; then **lines 111–128** persist one row per member via `persistRoomMessageForRecipient` (messageId, senderId, recipientId, roomId, roomMessageId).
  - **Lines 129–144:** For each member, `sendToMember(memberId, messageId, payload, { originSocket: memberId === userId ? originSocket : null })` sends ROOM_MESSAGE; for the sender, `originSocket` is passed so the sending tab does not get a duplicate ROOM_MESSAGE (other tabs do).

So: one **roomMessageId** per group message; N **messageId**s of the form `rm_<roomMessageId>_<memberId>` for N members. The UI dedupes by **roomMessageId** (or messageId) so one bubble per logical message.

### Why sender sees double ticks “early” for group messages

- **File:** `myfrontend/frontend/src/features/chat/adapters/ChatAdapterContext.jsx`
  - **Lines 1301–1342:** On `ROOM_MESSAGE_RESPONSE` with `msg.success` and `roomMessageId`, the optimistic message (matched by `clientMessageId`) is reconciled with the server message. The reconciled object is explicitly given **`status: "delivered"`** (line 1334). So as soon as the sender gets ROOM_MESSAGE_RESPONSE, their own group message is shown as delivered (double ticks) **before** any other member has sent CLIENT_ACK. No backend delivery confirmation is required for that UI update.

---

## Summary: current logic (10–20 bullets)

1. Ticks and "(offline)" are rendered in **ChatWindow.jsx**: status icon from `getStatusIcon(msg.status, isMe)` (line 679); "(offline)" only when `isMe && msg.deliveryStatus === "offline"` (lines 680–682).
2. Status → icon mapping is in **message.js** `getStatusIconConfig`: sending/queued → spinner, sent → single check, delivered/read → double check, failed → alert.
3. Group messages use the same icon logic in **RoomMessageList.jsx**; group UI does not show "(offline)".
4. **DELIVERY_STATUS** (DM): frontend sets `delivered`/`read` via `updateMessageStatusRef`, or sets `deliveryStatus: "offline"` for RECIPIENT_OFFLINE (ChatAdapterContext 754–775).
5. **MESSAGE_STATE_UPDATE / ACK_RESPONSE**: frontend updates message status by messageId or roomMessageId (776–781).
6. **STATE_SYNC_RESPONSE**: frontend applies `deliveredMessageIds` and `readMessageIds` to set delivered/read (703–711).
7. **updateMessageStatusByMessageId** (2199–2222) is the single place that writes status into `messagesByConversation` for ticks (and for DMs, removal of "(offline)" when status becomes delivered/read).
8. Backend DM delivery: **sendMessage.js** calls **attemptDelivery** then sends **DELIVERY_STATUS** (DELIVERED or RECIPIENT_OFFLINE) to the sender (124–142).
9. **attemptDelivery** (message.service.js 94–202) returns true only if at least one recipient socket queued the message; otherwise false → RECIPIENT_OFFLINE.
10. Replay (**replay.service.js**): marks messages DELIVERED in DB and memory (198–210), returns payloads to emit; **reconnect.js** emits those only to the reconnecting user (59–60). No DELIVERY_STATUS or MESSAGE_STATE_UPDATE is sent to the sender.
11. So after replay, the sender’s UI is not updated; they can still see single tick + (offline) for a message that is already delivered to the recipient.
12. Group: one **roomMessageId** per message; per-member **messageId** = `rm_<roomMessageId>_<memberId>` (group.service.js 91, 112–113).
13. Sender’s group bubble is reconciled on **ROOM_MESSAGE_RESPONSE** with **status: "delivered"** (ChatAdapterContext 1334), so the sender sees double ticks immediately, without waiting for any CLIENT_ACK from other members.
14. STATE_SYNC_RESPONSE’s deliveredMessageIds come from **offline.service** `buildStateSyncResponse` (offline.service.js 44–61), which derives them from message store state (DELIVERED) for the reconnecting user.

---

## Why refresh fixes it (grounded in code)

1. **Before refresh:** Sender’s state is whatever the client last received over WS: e.g. **DELIVERY_STATUS (RECIPIENT_OFFLINE)** at send time when the recipient was offline. Replay later marks the message delivered in DB and notifies only the **recipient**; the sender never gets DELIVERY_STATUS or MESSAGE_STATE_UPDATE. So the sender keeps single tick + "(offline)" for that message.
2. **STATE_SYNC_RESPONSE and deliveredMessageIds:** In **offline.service.js** `buildStateSyncResponse`, `deliveredMessageIds` is built from `getMessagesForRecipient(userId)` — messages where the **syncing user is the recipient**. So when the **sender** refreshes, their STATE_SYNC_RESPONSE does **not** contain messageIds of messages they **sent**; it only contains messages **addressed to them** that are delivered. So state sync alone does not fix the sender’s view of their own sent message.
3. **Refresh fixes it via history load:** After refresh, when the sender opens the DM again, the frontend calls **loadMessages** (history API). The history API returns messages for that chat, including the sender’s sent message, with **state** coming from the persisted message (e.g. `delivered` after replay). In **ChatAdapterContext** (loadMessages, mergeMessageState, lines 1999–2020), incoming messages are merged by dedupe key (`roomMessageId || messageId || id`); `mergeMessageState` prefers newer edited/deleted state but does not overwrite with older status. The important part is that the **normalized history payload** includes the server’s `state` for each message. When the list is merged and re-sorted, the sent message now has `state: 'delivered'` from the server, so `msg.status` (or the normalized equivalent) shows delivered, the tick icon becomes double check, and the "(offline)" label is not shown (it only shows when `deliveryStatus === "offline"`; after merge the message has the server’s delivery state, not the stale offline label).
4. So “refresh fixes it” because **loading history** after reconnect returns messages (including the sender’s) with the correct persisted **state** from the DB; the frontend merge updates the conversation state, so the sender’s message moves from sent+offline to delivered. The live path (replay) never notifies the sender, so without refresh/history load the sender would never see the update.
