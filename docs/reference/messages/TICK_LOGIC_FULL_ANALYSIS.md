# Tick Logic (Sent/Delivered/Read) — Full Analysis

**Scope:** DM and group chat tick logic only. Analysis only — no implementation, no patches, no file changes.

---

# PHASE 1 — FULL TRACE

## 1.1 Files Involved (by responsibility)

### Backend — Message state storage (DB + in-memory)

| File | Responsibility | State names used |
|------|----------------|------------------|
| `backend/models/message.state.js` | Canonical state machine: **lowercase** `sending`, `sent`, `delivered`, `read`. Used by message.service for message **content** state. | `MessageState.SENT` = `'sent'`, `DELIVERED` = `'delivered'`, `READ` = `'read'` |
| `backend/services/delivery.service.js` | Per-recipient delivery FSM: **uppercase** `PERSISTED`, `SENT`, `DELIVERED`, `READ`. Creates/transitions delivery records. | `DeliveryState.SENT`, `DELIVERED`, `READ` (strings) |
| `backend/websocket/state/directDeliveryStore.js` | Storage for DM delivery records: key `messageId:recipientId` → `{ state, persistedAt, sentAt, deliveredAt, readAt }`. | Record `.state` = one of delivery.service’s uppercase values |
| `backend/websocket/state/deliveryStore.js` | **Room** message delivery state (Tier-2); key = composite. | `SENT`, `DELIVERED`, `READ` (uppercase) |
| `backend/websocket/state/roomDeliveryStore.js` | Aggregate **room** delivery: `deliveredSet`, `totalCount`. Used to decide when to send `ROOM_DELIVERY_UPDATE`. | N/A (counts, not state labels) |
| `backend/websocket/state/messageStore.js` | In-memory message cache (messageId → message data including `state`). | Synced from DB; uses message.state.js **lowercase** |
| DB (e.g. `storage/message.mongo.js`) | Persisted `message.state`. | `'sent'`, `'delivered'`, `'read'` (lowercase) |

**State name mismatch (intentional):**
- **Message state** (message content lifecycle): lowercase (`sent`, `delivered`, `read`) — used in DB, message.service, MESSAGE_STATE_UPDATE payloads.
- **Delivery record state** (per-recipient delivery FSM): uppercase in delivery.service/directDeliveryStore (`SENT`, `DELIVERED`, `READ`, `PERSISTED`). Not sent to client; only message state is.

---

### Backend — WebSocket events for message send and delivery

| File | Responsibility | Events emitted / consumed |
|------|----------------|---------------------------|
| `backend/websocket/handlers/sendMessage.js` | MESSAGE_SEND: validate → `messageService.persistAndReturnAck` → return MESSAGE_ACK; then **async** `attemptDelivery` → send **DELIVERY_STATUS** to sender. | Emits: MESSAGE_ACK (to sender), MESSAGE_RECEIVE (to sender echo + recipient), DELIVERY_STATUS (to sender: `DELIVERED` or `RECIPIENT_OFFLINE`) |
| `backend/websocket/services/message.service.js` | `attemptDelivery(messageId, message, context)`: if recipient has sockets, sends MESSAGE_RECEIVE to them, then `deliveryService.transitionState(messageId, recipientId, DeliveryState.SENT)`. Returns true/false. Does **not** emit MESSAGE_STATE_UPDATE. | Called by sendMessage (send-time) and by replay path |
| `backend/websocket/handlers/deliveredAck.js` | MESSAGE_DELIVERED_CONFIRM: validate → `messageService.markDelivered` → emit `result.senderStateUpdate` to **sender**. | Emits to sender: MESSAGE_STATE_UPDATE `{ messageId, state: MessageState.DELIVERED }` (lowercase) |
| `backend/websocket/handlers/readAck.js` | MESSAGE_READ / MESSAGE_READ_CONFIRM: validate → `messageService.markRead` → emit `result.senderStateUpdate` to **sender**. | Emits to sender: MESSAGE_STATE_UPDATE `{ messageId, state: MessageState.READ }` (lowercase) |

**Flow (DM) — send time:**
1. Sender sends MESSAGE_SEND → persistAndReturnAck → MESSAGE_ACK (state: `sent`) to sender.
2. attemptDelivery(recipient): if online → transitionState(SENT), then sendMessage handler sends **DELIVERY_STATUS** `{ status: 'DELIVERED' }` to sender; if offline → **DELIVERY_STATUS** `{ status: 'RECIPIENT_OFFLINE' }`.
3. No MESSAGE_STATE_UPDATE at send time; only DELIVERY_STATUS carries “delivered” vs “offline”.

---

### Backend — Delivery confirm and state updates (DM)

| File | Responsibility | When MESSAGE_STATE_UPDATE is sent to sender |
|------|----------------|----------------------------------------------|
| `backend/services/message.service.js` | `confirmDeliveredAndReturnAck` / `confirmReadAndReturnAck`: DB transition, return `senderStateUpdate`. **Handlers** do the actual `sendToUserSocket(senderId, senderStateUpdate)`. | When recipient sends MESSAGE_DELIVERED_CONFIRM or MESSAGE_READ; payload `state` is **lowercase** (`MessageState.DELIVERED` / `MessageState.READ`) |
| `backend/services/replay.service.js` | After marking a replayed **DM** as delivered (DB + deliveryService), pushes to `messagesToEmit` and **sends MESSAGE_STATE_UPDATE** to **sender** via `sendToAllUserSockets(msg.senderId, { type: 'MESSAGE_STATE_UPDATE', messageId, state: MessageState.DELIVERED })`. | When replay runs for recipient and message was undelivered; **only** for DM (replayType === 'MESSAGE_RECEIVE') |

---

### Backend — Replay and offline

| File | Responsibility | Tick-related behavior |
|------|----------------|------------------------|
| `backend/services/replay.service.js` | Replay undelivered messages for reconnecting user. For each DM: idempotency checks → mark delivered in DB + deliveryService → push MESSAGE_RECEIVE (state: DELIVERED) to `messagesToEmit`; **and** send MESSAGE_STATE_UPDATE to **sender**. | Replayed DMs: sender gets MESSAGE_STATE_UPDATE(delivered). Replay does **not** send DELIVERY_STATUS. |
| `backend/websocket/handlers/reconnect.js` | RESUME: calls `replayService.replayMessages`; emits `result.messages` **only to reconnecting user** (recipient). MESSAGE_STATE_UPDATE to sender is sent **inside** replay.service, not from reconnect handler. | Sender gets MESSAGE_STATE_UPDATE from replay.service; recipient gets replayed MESSAGE_RECEIVE from reconnect. |
| `backend/websocket/handlers/reconnect.js` (handleMessageReplay) | MESSAGE_REPLAY: same pattern — replay returns messages; handler sends those messages only to `userId` (reconnecting user). | Same as above. |

---

### Backend — Group (room) delivery

| File | Responsibility | Tick-related behavior |
|------|----------------|------------------------|
| `backend/websocket/state/roomDeliveryStore.js` | `recordDelivery(roomMessageId, roomId, senderId, memberId, totalCount)`: adds member to deliveredSet; returns `{ complete, deliveredCount, totalCount }`. `complete === (totalCount > 0 && deliveredCount >= totalCount)`. | Double tick when `deliveredCount === totalCount` (all other members received). |
| `backend/services/replay.service.js` (room branch) | For replayed ROOM_MESSAGE: `roomDeliveryStore.recordDelivery`; if `complete`, `sendToAllUserSockets(senderId, { type: 'ROOM_DELIVERY_UPDATE', roomMessageId, deliveredCount, totalCount })`. | Sender gets ROOM_DELIVERY_UPDATE when all recipients have received (including via replay). |
| Room send path (e.g. room handler) | On ROOM_MESSAGE send/broadcast, room delivery is recorded per recipient; when all received, sender gets ROOM_DELIVERY_UPDATE. | Same deliveredCount/totalCount semantics. |

**Group tick rule:** Backend does **not** send a single “delivered” state for room messages. It sends **ROOM_DELIVERY_UPDATE** with `deliveredCount` and `totalCount`. Frontend derives “delivered” when `deliveredCount === totalCount`.

---

### Frontend — Message state and normalization

| File | Responsibility | State names / flow |
|------|----------------|--------------------|
| `myfrontend/frontend/src/lib/messageStateMachine.js` | FSM: **lowercase** `sending`, `sent`, `delivered`, `read`. `normalizeState()` lowercases; `applyStateUpdate(current, incoming)` returns new state only if transition is allowed (sent→delivered, delivered→read). **sent→read is invalid** → returns null. | All state in UI is lowercase. |
| `myfrontend/frontend/src/features/chat/adapters/ChatAdapterContext.jsx` | `normalizeMessage(m)`: `status: m.state ?? m.status` — normalizes so UI uses single `status` from either backend `state` or existing `status`. | UI message has `.status` (and optionally `.state`); tick reads `.status`. |

---

### Frontend — WebSocket handling and reducer-style updates

| File | Responsibility | Flow |
|------|----------------|------|
| `myfrontend/frontend/src/transport/wsClient.js` | Receives WS frames; dispatches to listeners. DM events (MESSAGE_RECEIVE, MESSAGE_ACK, DELIVERY_STATUS) routed by payload. | No state names; just passes payload. |
| `myfrontend/frontend/src/features/chat/adapters/ChatAdapterContext.jsx` (single big WS handler) | **MESSAGE_ACK** (with state): `updateMessageStatusRef.current(messageId, msg.state)`. **DELIVERY_STATUS**: if `status === 'DELIVERED'` → `updateMessageStatusRef.current(messageId, "delivered", true)`; if `SEEN` → "read"; if `RECIPIENT_OFFLINE` → only sets `deliveryStatus: "offline"` on message (no status change). **MESSAGE_STATE_UPDATE**: `normalizeMessageState(msg.state)` then `updateMessageStatusRef.current(id, status, false, …)`. **ACK_RESPONSE** / **MESSAGE_READ**: same updater with `msg.state` or `"read"`, **forceSync = false**. **ROOM_DELIVERY_UPDATE**: sets `roomDeliveryByRoomMessageId[roomMessageId] = { deliveredCount, totalCount }`. | Backend → WS → handler → `updateMessageStatusByMessageId` → `setMessagesByConversation` (update message `.status`). |
| `updateMessageStatusByMessageId` (same file) | `newStatus = forceSync ? status : applyStateUpdateFsm(beforeStatus, status)`. If `!newStatus` (FSM rejected), returns `prev` and update is skipped. | Reducer-style: one message in one conversation updated by messageId/alternateId. |

**State flow (DM):**  
Backend sends DELIVERY_STATUS (status `DELIVERED`/`RECIPIENT_OFFLINE`) or MESSAGE_STATE_UPDATE (state `delivered`/`read`) → handler normalizes → `updateMessageStatusRef.current(id, status, forceSync, altId)` → `applyStateUpdateFsm` (unless forceSync) → if allowed, `setMessagesByConversation` updates that message’s `status` → UI re-renders.

---

### Frontend — Tick rendering

| File | Responsibility | When single vs double tick |
|------|----------------|----------------------------|
| `myfrontend/frontend/src/features/chat/domain/message.js` | `getStatusIconConfig(status, isMe)`: `sending`/`queued` → spinner; `sent` → single check; `delivered`/`read` → check-check (double); `failed` → alert. | Single tick only for `status === 'sent'`. Double for `delivered` or `read`. |
| `myfrontend/frontend/src/features/chat/ui/ChatWindow.jsx` | DM/room list: `displayStatus = isMe && isRoomMsg && delivery && totalCount > 0 && deliveredCount === totalCount ? "delivered" : msg.status`. Renders `getStatusIcon(displayStatus, isMe)`. “(offline)” when isMe && DM && status not delivered/read && (presence offline or `deliveryStatus === "offline"`). | DM: tick from `msg.status`. Room: tick from `roomDeliveryByRoomMessageId` (deliveredCount === totalCount) else `msg.status`. |
| `myfrontend/frontend/src/features/chat/group/RoomMessageList.jsx` | Same rule: `displayStatus = isMe && delivery && totalCount > 0 && deliveredCount === totalCount ? "delivered" : (msg.status ?? "sent")`. | Group tick depends entirely on `roomDeliveryByRoomMessageId` for “delivered”; otherwise shows `msg.status` (default "delivered" in normalizeMsg for history). |

---

### Frontend — Replay / offline queue

| File | Responsibility | Tick-related behavior |
|------|----------------|------------------------|
| `mergeMessageReceiveRef` (ChatAdapterContext) | On MESSAGE_RECEIVE (including replay): if **we are recipient** and **not** `msg.isReplay`, sends MESSAGE_DELIVERED_CONFIRM once per messageId (`clientAckSentRef`). **Replay messages do not trigger MESSAGE_DELIVERED_CONFIRM** (isReplay true). | Delivery confirm is sent only for “live” MESSAGE_RECEIVE; replayed messages are already marked delivered on server, so no duplicate confirm. |
| Offline queue (pendingOutboxRef, flushPendingOutbox) | When WS is back, sends queued messages. On success, message is replaced with server id and status "sent". No special delivery confirm for previously-offline messages beyond normal send path. | When user comes back online, only new sends go through attemptDelivery → DELIVERY_STATUS. Old messages that were “sent” while offline stay “sent” until DELIVERY_STATUS or MESSAGE_STATE_UPDATE (e.g. from replay) is received. |

---

## 1.2 State name summary and mismatches

| Layer | Names used | Notes |
|-------|------------|--------|
| Backend message state (DB, message.service, MESSAGE_STATE_UPDATE) | `sent`, `delivered`, `read` (lowercase) | Consistent. |
| Backend delivery record (delivery.service, directDeliveryStore) | `PERSISTED`, `SENT`, `DELIVERED`, `READ` (uppercase) | Internal only; not sent to client. |
| Backend DELIVERY_STATUS payload | `status: 'DELIVERED'` or `'RECIPIENT_OFFLINE'` (uppercase) | Frontend maps DELIVERED→"delivered", RECIPIENT_OFFLINE→deliveryStatus "offline" only. |
| Frontend FSM and UI | `sending`, `sent`, `delivered`, `read` (lowercase) | `normalizeState` ensures lowercase. |
| Frontend message object | `status` (primary), `state` (from server), `deliveryStatus` ("offline" for DM when recipient offline) | normalizeMessage: `status: m.state ?? m.status`. |

**Mismatches identified:**
- **DELIVERY_STATUS** uses `status` (DELIVERED/RECIPIENT_OFFLINE); **MESSAGE_STATE_UPDATE** uses `state` (delivered/read). Frontend handles both and normalizes to `status` for the message.
- **sent → read** is invalid in frontend FSM; backend can send read when message was never delivered to sender’s client (e.g. DELIVERY_STATUS lost or recipient was offline and replayed later). So sender’s local state can stay "sent" and FSM rejects "read".

---

# PHASE 2 — BUG ANALYSIS

## 2.1 Why single tick sometimes never converts to double

- **Cause 1 (DM, recipient offline at send):**  
  Send path: attemptDelivery returns false → sender gets **DELIVERY_STATUS** `RECIPIENT_OFFLINE` only. So sender never gets a “delivered” status at send time; message stays **sent**. When recipient later comes online and gets the message via **replay**, replay.service **does** send **MESSAGE_STATE_UPDATE(delivered)** to sender. So after replay, sender should get double tick **if** that MESSAGE_STATE_UPDATE is received. If the sender never gets that frame (e.g. sender tab closed during replay, or WS drop), single tick persists until next source (e.g. STATE_SYNC or history load with server state).

- **Cause 2 (DM, DELIVERY_STATUS lost):**  
  Recipient was online; attemptDelivery succeeded and backend sent DELIVERY_STATUS(DELIVERED), but the frame was lost or sender missed it. Sender’s message stays **sent**. When recipient sends MESSAGE_DELIVERED_CONFIRM, backend sends MESSAGE_STATE_UPDATE(delivered) to sender — so sender would get double tick when that is received. If recipient never sends MESSAGE_DELIVERED_CONFIRM (e.g. client bug or different client), sender has no other path except replay (when recipient reconnects) or sync/history.

- **Cause 3 (Replay not notifying sender — fixed in codebase):**  
  Replay.service **does** send MESSAGE_STATE_UPDATE to sender for replayed DMs. So “replay doesn’t notify sender” is not a current bug in the traced code.

- **Cause 4 (Group):**  
  Group tick is driven by **ROOM_DELIVERY_UPDATE** (deliveredCount, totalCount). If that event is never sent (e.g. roomDeliveryStore not updated for all members, or sender never gets the event), tick stays single. If totalCount is 0 (e.g. room members not set correctly), condition `deliveredCount === totalCount` may never be true.

## 2.2 Do replayed messages send delivery confirm?

- **Backend:** Replay marks the message as delivered in DB and in deliveryService; it does **not** send a separate “DELIVERY_STATUS” to the sender; it sends **MESSAGE_STATE_UPDATE** (state: delivered) to the sender. So replayed messages **do** trigger a sender-side update (MESSAGE_STATE_UPDATE), not DELIVERY_STATUS.
- **Frontend (recipient):** For replayed MESSAGE_RECEIVE, `mergeMessageReceiveRef` sees `msg.isReplay === true`, so it **does not** send MESSAGE_DELIVERED_CONFIRM. That is correct: server already marked it delivered; no need to confirm again.

## 2.3 Offline → online: does it trigger delivery update?

- **Recipient comes online:** Reconnect/RESUME runs replay. Replay marks undelivered messages as delivered and sends MESSAGE_RECEIVE to recipient and **MESSAGE_STATE_UPDATE(delivered)** to sender. So **yes**, offline→online (replay) triggers a delivery update to the sender for those messages.
- **Sender comes online:** No automatic “retroactive” DELIVERY_STATUS for messages sent while recipient was offline. Sender would get MESSAGE_STATE_UPDATE only if replay already ran for the recipient and notified the sender, or if recipient had sent MESSAGE_DELIVERED_CONFIRM earlier and sender had missed it; then STATE_SYNC or history could carry server state (if implemented to push state to sender).

## 2.4 Group delivered logic: deliveredCount vs totalCount

- **Backend:** `roomDeliveryStore.recordDelivery(roomMessageId, roomId, senderId, memberId, totalCount)` adds `memberId` to deliveredSet. It returns `complete = (totalCount > 0 && deliveredCount >= totalCount)`. So “delivered” for the room message means “all `totalCount` other members have received.”
- **Frontend:** ChatWindow and RoomMessageList use:  
  `displayStatus = isMe && delivery && delivery.totalCount > 0 && delivery.deliveredCount === delivery.totalCount ? "delivered" : msg.status`.  
  So group double tick **depends entirely** on `deliveredCount === totalCount`. If totalCount is wrong (e.g. 0 or too small), or ROOM_DELIVERY_UPDATE is never received, tick stays single.

## 2.5 Race between presence and delivery

- **(offline) label:** Rendered when isMe && DM && status not delivered/read && (presence says offline **or** `deliveryStatus === "offline"`). So if presence is slow or wrong, deliveryStatus can override. No direct race that would prevent tick update; the tick itself comes from `msg.status`, which is updated by DELIVERY_STATUS / MESSAGE_STATE_UPDATE. A race could only affect the “(offline)” label, not single vs double tick.

## 2.6 State mismatch: msg.state vs msg.status

- **Backend** sends `state` in MESSAGE_STATE_UPDATE and in message payloads (e.g. MESSAGE_ACK, MESSAGE_RECEIVE). **Frontend** normalizes to `status` in normalizeMessage (`status: m.state ?? m.status`) and in updateMessageStatusByMessageId (writes `status: newStatus`). So in the UI, a single source of truth is `msg.status`; `msg.state` may still be present from server. **No bug** from state vs status for rendering, as long as all code paths that update “tick” go through the same updater and set `status`. The only semantic issue is **sent → read** being rejected by the FSM when the backend sends read and the sender’s message is still sent.

---

# PHASE 3 — DESIGN PLAN (rewrite plan for tick logic)

## 3.1 Requirements (recap)

- Single tick **only** when state = "sent".
- Double tick **only** when state = "delivered" (or "read" — read must render same as delivered, i.e. double).
- Live conversion when receiver comes online (replay already sends MESSAGE_STATE_UPDATE to sender; ensure no regression).
- No other feature touched; no schema change; minimal file changes.

## 3.2 Files that MUST be modified (and why)

| File | Reason |
|------|--------|
| `myfrontend/frontend/src/lib/messageStateMachine.js` | Allow **sent → read** as a valid transition (or treat "read" as "delivered" for display) so that when the backend sends read and the sender’s message is still "sent", the tick can move to double (read). Alternative: in the handler, when incoming state is "read" and current is "sent", first apply "delivered" then "read", or map "read" to "delivered" for display only. |
| `myfrontend/frontend/src/features/chat/adapters/ChatAdapterContext.jsx` | When handling MESSAGE_STATE_UPDATE or MESSAGE_READ with state "read", if FSM is relaxed to allow sent→read, no change; otherwise, either (a) call updater with an intermediate "delivered" then "read", or (b) pass a flag so that "read" is normalized to "delivered" for tick display only (still store "read" for semantics). |

No backend schema or backend state machine change. No change to DELIVERY_STATUS or MESSAGE_STATE_UPDATE payload shapes.

## 3.3 Exact logic rewrite plan (pseudocode)

**Option A — FSM: allow sent → read (minimal change)**  
- In `messageStateMachine.js`:  
  - Add `read` to `VALID_TRANSITIONS[MessageState.SENT]`, e.g. `[MessageState.SENT]: [MessageState.DELIVERED, MessageState.READ]`.  
  - In `applyStateUpdate`, keep same logic: valid transition → return n; no change to STATE_ORDER.  
- In ChatAdapterContext: no change to handler; `updateMessageStatusRef.current(id, readState, false, …)` will now accept sent→read and set status to "read".  
- Tick: getStatusIconConfig already shows double tick for "read". So single tick only for "sent"; double for "delivered" and "read".  

**Option B — FSM: treat "read" as "delivered" for application when current is "sent"**  
- In `messageStateMachine.js`:  
  - In `applyStateUpdate(current, incoming)`: if `c === 'sent'` and `n === 'read'`, return `'delivered'` (so we don’t skip the update and we show double tick; optionally still store "read" in a separate field if needed).  
  - Or: if `c === 'sent'` and `n === 'read'`, return `'read'` (same as Option A — allow transition).  
- No change to VALID_TRANSITIONS if we only special-case in applyStateUpdate.  
- Handler unchanged.  

**Recommended:** Option A (allow sent → read in FSM). One place change, clear semantics: backend is authoritative; if backend says read, we show read (double tick).

## 3.4 What MUST NOT be touched

- Backend: no schema change; no change to message.state.js or delivery.service state names; no change to DELIVERY_STATUS or MESSAGE_STATE_UPDATE contract.
- Frontend: no change to getStatusIconConfig (sent = single, delivered/read = double); no change to ROOM_DELIVERY_UPDATE or roomDeliveryByRoomMessageId logic; no change to mergeMessageReceive (MESSAGE_DELIVERED_CONFIRM for non-replay only); no change to replay.service (already sends MESSAGE_STATE_UPDATE to sender for DM).
- No new APIs, no new WS event types.

## 3.5 Risk assessment

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Allowing sent→read allows out-of-order or duplicate read updates to overwrite "delivered" | Low | FSM still uses STATE_ORDER: if we're already "read", no change; if we're "delivered", delivered→read is already allowed. So we only add sent→read. |
| Other code assumes sent can only go to delivered | Low | Only the tick/status update path uses applyStateUpdate; no other logic in the traced code enforces "sent can only become delivered" in a way that would break. |
| Backend sends "read" before "delivered" in rare cases | Already possible | Backend can send MESSAGE_STATE_UPDATE(read) when DB state is read even if client never got delivered. Option A aligns client with backend. |
| Group tick regression | None | No change to room delivery or ROOM_DELIVERY_UPDATE handling. |

---

# Summary

- **Phase 1:** All files involved in storage (DB + in-memory), WS send/delivery, delivery confirm, MESSAGE_STATE_UPDATE, tick rendering, normalization, and replay are traced. State names: backend message state and frontend FSM use lowercase; backend delivery records use uppercase (internal). DELIVERY_STATUS uses `status` (DELIVERED/RECIPIENT_OFFLINE); MESSAGE_STATE_UPDATE uses `state` (delivered/read).
- **Phase 2:** Single tick can stay because (1) DELIVERY_STATUS was never received, (2) recipient was offline and sender never got MESSAGE_STATE_UPDATE from replay, or (3) group ROOM_DELIVERY_UPDATE not received or totalCount wrong. Replay does send MESSAGE_STATE_UPDATE to sender for DMs. Offline→online (replay) does trigger delivery update to sender. Group double tick depends on deliveredCount === totalCount. sent→read is rejected by frontend FSM when sender’s message is still "sent", which is the main fix target.
- **Phase 3:** Minimal change: allow **sent → read** in the frontend FSM (e.g. in `messageStateMachine.js`). No schema or backend contract change. No change to other features. Low risk.
