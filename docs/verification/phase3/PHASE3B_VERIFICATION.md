# Phase 3B Delivered/Read Confirmations – Verification Steps

## Backend schema (discovered)

### MESSAGE_DELIVERED_CONFIRM (client → server)
- Payload: `{ type: "MESSAGE_DELIVERED_CONFIRM", messageId: string }`
- Backend: deliveredAck handler → messageService.markDelivered
- Sender receives: MESSAGE_ACK { messageId, state: "delivered" }, MESSAGE_STATE_UPDATE { messageId, state: "delivered" }

### MESSAGE_READ / MESSAGE_READ_CONFIRM (client → server)
- Payload: `{ type: "MESSAGE_READ", messageId: string }` (MESSAGE_READ_CONFIRM routes to same handler)
- Backend: readAck handler → messageService.markRead
- Sender receives: MESSAGE_READ { messageId, state: "read", timestamp }, MESSAGE_STATE_UPDATE { messageId, state: "read" }

### CLIENT_ACK (client → server)
- Payload: `{ type: "CLIENT_ACK", messageId: string, ackType?: "delivered" | "read" }`
- Same effect as MESSAGE_DELIVERED_CONFIRM (ackType=delivered) or MESSAGE_READ (ackType=read)

---

## Manual verification

### 1. Two-browser test: delivered then read
1. Log in as userA in browser 1.
2. Log in as userB in browser 2.
3. UserA sends message to userB.
4. UserA sees: sent (✓) → delivered (✓✓) after userB receives.
5. UserB opens the DM; messages are visible.
6. UserB triggers MESSAGE_READ for latest unread (debounced).
7. UserA sees: delivered (✓✓) → read (✓✓ blue).
8. Badges: single check = sent, double check = delivered, double check blue = read.

### 2. Delivered flow
- UserB receives MESSAGE_RECEIVE → frontend sends MESSAGE_DELIVERED_CONFIRM.
- UserA (sender) receives MESSAGE_ACK / MESSAGE_STATE_UPDATE with state "delivered".
- UserA message status updates; badge shows delivered.

### 3. Read flow
- UserB opens DM → markAsReadForConversation runs (400ms debounce).
- Frontend sends MESSAGE_READ for latest unread from userA.
- UserA receives MESSAGE_READ / MESSAGE_STATE_UPDATE with state "read".
- UserA message status updates; badge shows read (blue checkmarks).

### 4. No spam
- markAsReadForConversation debounced 400ms.
- lastSent prevents duplicate MESSAGE_READ for same message.

---

## Log locations
- MESSAGE_DELIVERED_CONFIRM sent in mergeMessageReceive (ChatAdapterContext) on MESSAGE_RECEIVE.
- MESSAGE_READ sent in markAsReadForConversation when user opens DM (ChatWindow useEffect).
- MESSAGE_ACK, MESSAGE_STATE_UPDATE, MESSAGE_READ handled in ChatAdapterContext handleMessage.
