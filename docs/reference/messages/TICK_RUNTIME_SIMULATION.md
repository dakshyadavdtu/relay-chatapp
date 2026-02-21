# Runtime Simulation — DM & Group Tick Transitions

Simulation using actual repository logic. No code modified.

**References:**
- FSM: `myfrontend/frontend/src/lib/messageStateMachine.js` (VALID_TRANSITIONS, applyStateUpdate, STATE_ORDER)
- Handler: `ChatAdapterContext.jsx` (WS branch for MESSAGE_ACK, DELIVERY_STATUS, MESSAGE_STATE_UPDATE, MESSAGE_READ; updateMessageStatusByMessageId)
- Tick: `getStatusIconConfig` in `features/chat/domain/message.js` (sent → check, delivered/read → check-check)
- Backend: `sendMessage.js` (ACK then attemptDelivery → DELIVERY_STATUS), `replay.service.js` (MESSAGE_STATE_UPDATE to sender)
- Room: `roomDeliveryStore.js` (recordDelivery → complete when deliveredCount >= totalCount), ChatWindow displayStatus for room

---

## Scenario 1: Sender sends message, recipient online

**Actors:** Sender A, Recipient B (online). Message M.

### Step-by-step (sender A side)

| Step | Event | Code path | Sender local state (message M) | Tick shown |
|------|--------|-----------|--------------------------------|------------|
| 0 | (none) | — | — | — |
| 1 | A submits send | addMessage(conversationId, { ..., status: "sending" }) | **sending** | Spinner (getStatusIconConfig: "sending" → spinner) |
| 2 | WS: MESSAGE_SEND | — | sending | Spinner |
| 3 | WS: **MESSAGE_ACK** (from sendMessage handler return) | Handler: `msg.type === "MESSAGE_ACK"` with `msg.message` → replaceMessageRef.current(chatId, clientId, { ...m, status: m.state ?? "sent" }). Backend ack.state = MessageState.SENT = 'sent'. | **sent** | Single check (getStatusIconConfig: "sent" → check) |
| 4 | WS: MESSAGE_RECEIVE (echo to sender) | mergeMessageReceiveRef: for sender, upsert with state from payload (ack.state = 'sent'). normalizeMessage: status = m.state ?? m.status → "sent". | sent | Single check |
| 5 | attemptDelivery(B) resolves true; backend sends **DELIVERY_STATUS** { status: 'DELIVERED' } | Handler: `msg.type === "DELIVERY_STATUS"`, status === "DELIVERED" → updateMessageStatusRef.current(msg.messageId, "delivered", **true**). forceSync=true → newStatus = status (no FSM). | **delivered** | Double check (getStatusIconConfig: "delivered" → check-check) |

**Expected transitions on sender side:**  
sending → sent → delivered.  
Tick: spinner → single → double.

**Code references:**
- sendMessage.js: return MESSAGE_ACK (state: ack.state); then .then(delivered => sendToUserSocket(senderId, { type: 'DELIVERY_STATUS', status: delivered ? 'DELIVERED' : 'RECIPIENT_OFFLINE' })).
- ChatAdapterContext: MESSAGE_ACK branch (805–808 or 810–822), DELIVERY_STATUS branch (825–827 with forceSync true).

---

## Scenario 2: Sender sends message, recipient offline, then recipient reconnects

**Actors:** Sender A, Recipient B (offline at send, then reconnects). Message M.

### Step-by-step (sender A side)

| Step | Event | Code path | Sender local state (message M) | Tick shown |
|------|--------|-----------|--------------------------------|------------|
| 1 | A submits send | addMessage(..., status: "sending") | **sending** | Spinner |
| 2 | WS: MESSAGE_ACK | replaceMessage(..., { status: m.state ?? "sent" }) | **sent** | Single check |
| 3 | MESSAGE_RECEIVE (echo) | mergeMessageReceiveRef; status from state 'sent' | sent | Single check |
| 4 | attemptDelivery(B) resolves false (sockets.length === 0); backend sends **DELIVERY_STATUS** { status: 'RECIPIENT_OFFLINE' } | Handler: status === "RECIPIENT_OFFLINE" → setMessagesByConversation: find message by messageId, set **deliveryStatus: "offline"** only. No updateMessageStatusRef call. | **sent** (unchanged); message.deliveryStatus = "offline" | Single check + "(offline)" label |
| 5 | B reconnects; RESUME/MESSAGE_REPLAY | Backend: replay.service.replayMessages(B, lastSeenMessageId). For M: idempotency checks → mark DELIVERED in DB → push to messagesToEmit; **sendToAllUserSockets(A, { type: 'MESSAGE_STATE_UPDATE', messageId: M, state: MessageState.DELIVERED })**. Reconnect handler sends replayed messages only to B. | — | — |
| 6 | A receives **MESSAGE_STATE_UPDATE** { messageId: M, state: "delivered" } | Handler: msg.type === "MESSAGE_STATE_UPDATE" → normalizeMessageState(msg.state) → "delivered"; updateMessageStatusRef.current(id, "delivered", **false**, ...). forceSync=false → newStatus = applyStateUpdateFsm("sent", "delivered"). VALID_TRANSITIONS["sent"] includes "delivered" → valid; STATE_ORDER delivered (3) > sent (2) → return "delivered". Message updated to status "delivered". | **delivered** | Double check; "(offline)" no longer shown (status is delivered/read) |

**Expected transitions on sender side:**  
sending → sent (then deliveryStatus "offline") → delivered after reconnect.  
Tick: spinner → single (+ offline) → double.

**Code references:**
- replay.service.js: after marking DM delivered, sendToAllUserSockets(msg.senderId, { type: 'MESSAGE_STATE_UPDATE', messageId, state: MessageState.DELIVERED }).
- ChatAdapterContext: MESSAGE_STATE_UPDATE branch (847–851); updateMessageStatusByMessageId (2449–2456) with forceSync false and applyStateUpdateFsm.

---

## Scenario 3: Recipient reads message while sender local state is still "sent"

**Actors:** Sender A (message M still "sent", e.g. DELIVERY_STATUS was lost or B was offline at send and A never got MESSAGE_STATE_UPDATE(delivered)). Recipient B opens chat and reads M.

### Step-by-step (sender A side) — after FSM change

| Step | Event | Code path | Sender local state (message M) | Tick shown |
|------|--------|-----------|--------------------------------|------------|
| 0 | (prior) | A’s message M has status "sent" (e.g. never got delivered update). | **sent** | Single check |
| 1 | B sends MESSAGE_READ(M); backend confirmReadAndReturnAck; backend sends to A: **MESSAGE_READ** and/or **MESSAGE_STATE_UPDATE** { messageId: M, state: "read" } | readAck handler: sendToUserSocket(A, result.senderStateUpdate). senderStateUpdate = { type: 'MESSAGE_STATE_UPDATE', messageId, state: MessageState.READ }. | — | — |
| 2 | A receives **MESSAGE_STATE_UPDATE** { messageId: M, state: "read" } | Handler: updateMessageStatusRef.current(id, normalizeMessageState("read"), **false**, ...). forceSync=false. beforeStatus = "sent", status = "read". newStatus = applyStateUpdateFsm("sent", "read"). **After FSM change:** VALID_TRANSITIONS["sent"] = ["delivered", "read"] → isValidTransition("sent", "read") = true. STATE_ORDER read (4) > sent (2) → return "read". Message updated to status "read". | **read** | Double check (getStatusIconConfig: "read" → check-check) |
| (alt) | A receives **MESSAGE_READ** { messageId: M, state: "read" } | Handler: readState = msg.state \|\| "read"; updateMessageStatusRef.current(id, readState, false, ...). Same as above: applyStateUpdateFsm("sent", "read") → "read". | **read** | Double check |

**Expected transitions after FSM change:**  
sent → read.  
Tick: single → double.

**Without FSM change (before):**  
applyStateUpdate("sent", "read") would call isValidTransition("sent", "read") → false (read not in VALID_TRANSITIONS["sent"]) → return null → updateMessageStatusByMessageId skips update (if (!newStatus) return prev) → tick stays single.

**Code references:**
- messageStateMachine.js: VALID_TRANSITIONS[MessageState.SENT] = [MessageState.DELIVERED, MessageState.READ]; applyStateUpdate uses isValidTransition(c, n).
- ChatAdapterContext: MESSAGE_STATE_UPDATE (847–851), MESSAGE_READ (865–868); updateMessageStatusByMessageId (2449–2456).

---

## Scenario 4: Group message with 3 members

**Actors:** Room R with members A (sender), B, C. totalCount = 2 (members excluding sender). Message M (roomMessageId = rm1).

### Backend / store

- roomDeliveryStore: initOrGet(rm1, roomId, A, 2) → totalCount = 2, deliveredSet = {}.
- recordDelivery(rm1, roomId, A, memberId, 2): adds memberId to deliveredSet; complete = (totalCount > 0 && deliveredCount >= totalCount).

### Step-by-step (sender A side) — when single vs double tick

| Step | Event | roomDeliveryStore (rm1) | roomDeliveryByRoomMessageId[rm1] (frontend) | displayStatus (ChatWindow) | Tick |
|------|--------|--------------------------|---------------------------------------------|----------------------------|------|
| 1 | A sends room message | setTotal(rm1, roomId, A, 2). deliveredSet size 0. | (not yet; no ROOM_DELIVERY_UPDATE) | msg.status (e.g. "sent") | Single (sent → check) |
| 2 | ROOM_MESSAGE_RESPONSE; optimistic replaced with server message; status "sent" | — | — | "sent" | Single |
| 3 | B receives ROOM_MESSAGE (or replays); backend recordDelivery(rm1, roomId, A, B, 2) | deliveredSet = {B}. deliveredCount=1, totalCount=2. complete = false. | — | "sent" | Single |
| 4 | C receives ROOM_MESSAGE (or replays); backend recordDelivery(rm1, roomId, A, C, 2) | deliveredSet = {B,C}. deliveredCount=2, totalCount=2. complete = true → sendToAllUserSockets(A, ROOM_DELIVERY_UPDATE { roomMessageId: rm1, deliveredCount: 2, totalCount: 2 }). | — | "sent" | Single |
| 5 | A receives **ROOM_DELIVERY_UPDATE** { roomMessageId: rm1, deliveredCount: 2, totalCount: 2 } | — | setRoomDeliveryByRoomMessageId(prev => ({ ...prev, [rm1]: { deliveredCount: 2, totalCount: 2 } })) | **displayStatus:** isMe && isRoomMsg && delivery && totalCount > 0 && deliveredCount === totalCount → **"delivered"** (ChatWindow.jsx 613–615) | **Double** (check-check) |

So: **single tick** until A receives ROOM_DELIVERY_UPDATE with deliveredCount === totalCount; then **double tick**.

**Code references:**
- ChatWindow.jsx: displayStatus = isMe && isRoomMsg && delivery && delivery.totalCount > 0 && delivery.deliveredCount === delivery.totalCount ? "delivered" : msg.status; getStatusIcon(displayStatus, isMe).
- roomDeliveryStore.js: recordDelivery returns { complete, deliveredCount, totalCount }; complete = total > 0 && deliveredCount >= total.
- replay.service.js (room): if complete, sendToAllUserSockets(senderId, { type: 'ROOM_DELIVERY_UPDATE', roomMessageId, deliveredCount, totalCount }).
- ChatAdapterContext: ROOM_DELIVERY_UPDATE branch (852–860) only updates roomDeliveryByRoomMessageId; no change to message.status for room messages. Group tick is purely from roomDeliveryByRoomMessageId + deliveredCount/totalCount.

---

## Summary table

| Scenario | Sender-side state sequence | Tick sequence |
|----------|----------------------------|---------------|
| 1. DM, recipient online | sending → sent → delivered | spinner → single → double |
| 2. DM, recipient offline then reconnect | sending → sent (+ offline) → delivered | spinner → single (+ offline) → double |
| 3. DM, recipient reads while sender "sent" (after FSM change) | sent → read | single → double |
| 4. Group, 3 members | msg.status "sent" until ROOM_DELIVERY_UPDATE; displayStatus = "delivered" when deliveredCount === totalCount | single until ROOM_DELIVERY_UPDATE(2/2); then double |
