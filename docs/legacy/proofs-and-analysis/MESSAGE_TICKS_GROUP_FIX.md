# Message Ticks Group Fix (Phase 2)

Double tick for **my** group message only when **all other** group members have received it. No refresh required. DM logic unchanged.

---

## Exact semantics

- **totalCount** = room members **excluding the sender** (number of “other” recipients).
- **deliveredCount** = number of those recipients who have received the message (queued to at least one socket, or delivered via replay).
- **Delivered (double tick)** for the sender’s room message iff an entry exists for that `roomMessageId` with `totalCount > 0` and `deliveredCount === totalCount`.
- **Sent (single tick)** otherwise: initial state after send, or when at least one other member has not yet received.
- Sender is **never** counted in totalCount or deliveredCount.

---

## File / line changes

### Part A — Frontend: stop lying ("delivered" on send success)

**File:** `myfrontend/frontend/src/features/chat/adapters/ChatAdapterContext.jsx`

- **~Line 1334:** On `ROOM_MESSAGE_RESPONSE` success, reconciled message status changed from `"delivered"` to `"sent"`. All other fields (id, roomMessageId, dedupe, etc.) unchanged. Sender sees single tick immediately after send.

---

### Part B — Backend: aggregate delivery tracking keyed by roomMessageId

**New file:** `backend/websocket/state/roomDeliveryStore.js`

- In-memory store: key = `roomMessageId`, value = `{ roomId, senderId, totalCount, deliveredSet }`.
- **setTotal(roomMessageId, roomId, senderId, totalCount)** — initialize or set total recipients (members excluding sender).
- **recordDelivery(roomMessageId, roomId, senderId, memberId, totalCount?)** — add `memberId` to delivered set (idempotent); optional `totalCount` for replay-created entries. Returns `{ complete, deliveredCount, totalCount }`. `complete === true` when `totalCount > 0` and `deliveredCount >= totalCount`.

**File:** `backend/websocket/services/group.service.js`

- **Requires:** `roomDeliveryStore`, `sendToUserSocket` (from `./message.service`).
- **Before send loop (~line 113):** `totalRecipients = members.filter((m) => m !== userId).length`; `roomDeliveryStore.setTotal(roomMessageId, roomId, userId, totalRecipients)`.
- **Inside send loop (~lines 151–163):** After `sendToMember(memberId, ...)`, if `memberId !== userId` and `socketsSent > 0`, call `roomDeliveryStore.recordDelivery(roomMessageId, roomId, userId, memberId)`. If `complete`, emit to sender: `sendToUserSocket(userId, { type: 'ROOM_DELIVERY_UPDATE', roomId, roomMessageId, deliveredCount, totalCount }, …)`.

**File:** `backend/services/replay.service.js`

- **Requires:** `roomManager`, `roomDeliveryStore`.
- **After handling each replayed message (~lines 241–262):** If `replayType === 'ROOM_MESSAGE'` and `msg.roomId`, `msg.roomMessageId`, `msg.senderId` exist: get `members = roomManager.getRoomMembers(msg.roomId)`, `totalRecipients = members.filter((m) => m !== msg.senderId).length`. Call `roomDeliveryStore.recordDelivery(msg.roomMessageId, msg.roomId, msg.senderId, userId, totalRecipients)`. If `complete`, `sendToUserSocket(msg.senderId, { type: 'ROOM_DELIVERY_UPDATE', roomId, roomMessageId, deliveredCount, totalCount }, …)`.

**Sender update event**

- **type:** `"ROOM_DELIVERY_UPDATE"`
- **payload:** `{ roomId, roomMessageId, deliveredCount, totalCount }`
- Emitted when `deliveredCount` reaches `totalCount` (all other members received), so the sender sees double tick in realtime.

---

### Part C — Frontend: consume ROOM_DELIVERY_UPDATE and drive ticks

**File:** `myfrontend/frontend/src/features/chat/adapters/ChatAdapterContext.jsx`

- **State (~line 149):** `roomDeliveryByRoomMessageId` = `{ [roomMessageId]: { deliveredCount, totalCount } }`.
- **WS handler (~lines 775–784):** On `msg.type === "ROOM_DELIVERY_UPDATE"` and `msg.roomMessageId`, set `roomDeliveryByRoomMessageId[roomMessageId] = { deliveredCount: msg.deliveredCount, totalCount: msg.totalCount }`.
- **Context value & useChatStore:** Expose `roomDeliveryByRoomMessageId`.
- **resetAllState:** Clear `roomDeliveryByRoomMessageId` to `{}`.

**File:** `myfrontend/frontend/src/features/chat/ui/ChatWindow.jsx`

- **useChatStore:** Destructure `roomDeliveryByRoomMessageId`.
- **Per message in list (~lines 607–614):** For each message, compute `isRoomMsg`, `roomMsgId`, `delivery = roomDeliveryByRoomMessageId[roomMsgId]`, and `displayStatus = (isMe && isRoomMsg && delivery && delivery.totalCount > 0 && delivery.deliveredCount === delivery.totalCount) ? "delivered" : msg.status`. Use `displayStatus` for `getStatusIcon(displayStatus, isMe)` so room messages show double tick only when all others received.

**File:** `myfrontend/frontend/src/features/chat/group/RoomMessageList.jsx`

- **useChatStore:** Destructure `roomDeliveryByRoomMessageId`.
- **Per message (~lines 169–173):** `roomMsgId = msg.roomMessageId ?? msg.id`, `delivery = roomDeliveryByRoomMessageId[roomMsgId]`, `displayStatus = (isMe && delivery && delivery.totalCount > 0 && delivery.deliveredCount === delivery.totalCount) ? "delivered" : (msg.status ?? "sent")`. Use `displayStatus` for `getStatusIcon(displayStatus, isMe)`.

---

## Manual tests

### 1) Room with 3 members; 1 offline → send → single tick until offline member reconnects → then double tick

1. Create or use a room with **3 members** (e.g. A, B, C). A = sender for this test.
2. Have **B** and **C** online; **A** sends a message.  
   **Expect:** A sees **single tick** (sent); B and C receive the message.
3. Take **C** offline (close tab or disconnect). **A** sends another message.  
   **Expect:** A sees **single tick** (only B received; C has not).
4. Bring **C** back online (reconnect / open app). Replay delivers the message to C.  
   **Expect:** **Without refreshing A’s tab**, A’s message updates to **double tick** (ROOM_DELIVERY_UPDATE received: deliveredCount === totalCount).

### 2) Sender excluded from totalCount

1. Room with **2 members** (A and B). **A** sends a message.  
   **Expect:** totalCount = 1 (only B). When B has received, A gets ROOM_DELIVERY_UPDATE with deliveredCount=1, totalCount=1 → double tick.
2. Room with **1 member** (only A). **A** sends a message (if allowed).  
   **Expect:** totalCount = 0; no ROOM_DELIVERY_UPDATE; A sees **single tick** (displayStatus stays "sent" because delivery.totalCount > 0 is false).

---

## Summary

- **Part A:** Reconcile status on ROOM_MESSAGE_RESPONSE set to `"sent"` so sender starts with single tick.
- **Part B:** roomDeliveryStore tracks delivered count per roomMessageId (excluding sender). group.service records delivery when message is queued to each other member and emits ROOM_DELIVERY_UPDATE when complete; replay.service does the same when replay delivers to a member.
- **Part C:** Frontend keeps `roomDeliveryByRoomMessageId`, handles ROOM_DELIVERY_UPDATE, and derives display status for **my** room messages: double tick only when `deliveredCount === totalCount` and `totalCount > 0`.
