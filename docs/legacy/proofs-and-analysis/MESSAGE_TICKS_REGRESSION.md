# Message Ticks — Regression & Robustness (Phase 3)

Summary of race conditions addressed, what is authoritative, and remaining limitations after Phase 3.

---

## What race conditions were addressed

1. **Multiple tabs / sockets per user (sender fanout)**  
   - **DM:** `MESSAGE_STATE_UPDATE` (e.g. from replay) is sent via `sendToUserSocket(senderId, payload)`, which iterates over **all** sockets for `senderId` (`connectionManager.getSockets(userId)`). So every tab/device of the sender receives the update.  
   - **Group:** `ROOM_DELIVERY_UPDATE` is sent the same way. No single-socket path.

2. **Reconnect / resume**  
   - **DM:** Replay marks messages delivered and notifies the sender with `MESSAGE_STATE_UPDATE`; frontend applies it via `updateMessageStatusRef`, so ticks and "(offline)" update without refresh.  
   - **Group:** Replay records room delivery (with DB hydration when cache is missing), and when complete sends `ROOM_DELIVERY_UPDATE` to the sender; frontend updates `roomDeliveryByRoomMessageId` and derived status.

3. **Server restart (aggregation cache loss)**  
   - In-memory `roomDeliveryStore` is lost on restart.  
   - **Fallback:** When replay delivers a room message and the store has no entry (or `totalCount === 0`), we **hydrate from DB** before recording:  
     - `getDeliveredRecipientIdsForRoomMessage(roomMessageId)` (query scoped to that `roomMessageId`: messages with `state` in `['delivered','read']`).  
     - `roomDeliveryStore.hydrate(roomMessageId, roomId, senderId, deliveredIds, totalRecipients)`.  
     - Then `recordDelivery` runs as usual and may emit `ROOM_DELIVERY_UPDATE` if completion is reached.  
   - So after a restart, the first time a member gets that room message (e.g. via replay), we rebuild the aggregate from DB and sender still gets the correct update when all others have received.

4. **Refresh correctness**  
   - **Room:** History API includes `deliverySummary: { deliveredCount, totalCount }` for **sender’s** room messages (computed from DB + room members). On load, the frontend merges these into `roomDeliveryByRoomMessageId`, so after refresh the derived status (single vs double tick) is correct without any special casing.  
   - **DM:** Unchanged: history still returns message `state`; merge preserves it.

---

## What is authoritative (backend)

- **DM delivery state:** DB message `state` and delivery records. Replay and send-time flow write to DB; `MESSAGE_STATE_UPDATE` / `DELIVERY_STATUS` are derived from that.  
- **Room delivery aggregate:**  
  - **Primary:** In-memory `roomDeliveryStore` (per `roomMessageId`: `totalCount`, `deliveredSet`).  
  - **Fallback after cache loss:** DB: messages with same `roomMessageId` and `state` in `['delivered','read']` → delivered recipient IDs; `totalCount` from room members (excluding sender).  
- **History:** Always from DB. Room history includes `deliverySummary` for sender’s messages so the client can restore tick state after refresh.

---

## Remaining limitations

1. **Room delivery store is in-memory**  
   - If no replay (and no new send) happens after a restart, the in-memory aggregate is empty until the next delivery path runs and triggers hydration. So a sender who never refreshes and doesn’t receive any new room delivery event may not get a late `ROOM_DELIVERY_UPDATE` for pre-restart messages until they load history (which now includes `deliverySummary`) or a replay runs.

2. **History deliverySummary only for current page**  
   - Only messages in the loaded history page get `deliverySummary`. Older pages (e.g. "Load older") will add summaries when loaded; if the user never scrolls up, very old sender messages might not get a summary until they’re in a requested page.

3. **No client ACK for room messages**  
   - Delivery is “queued to socket(s)” (or replayed). We do not wait for an explicit client ACK for room messages. So “delivered” means “server has queued to at least one socket for that member,” not “client has rendered/acknowledged.”

4. **DM deliveryStatus vs presence**  
   - Phase 1 made "(offline)" derived from presence + status; `deliveryStatus` is only a fallback when presence is unknown. So if presence is wrong or missing, the label can be wrong.

---

## Manual verification checklist

- [ ] **Multi-tab sender (DM):** Send DM with recipient offline; in another tab open same chat; recipient comes online and replay runs → both tabs show double tick and no "(offline)" without refresh.  
- [ ] **Multi-tab sender (group):** Send room message; in another tab open same room; when all others have received → both tabs show double tick.  
- [ ] **Reconnect:** Recipient disconnects, sender sends; recipient reconnects and gets replay → sender sees double tick (DM) or room double tick (group) without refresh.  
- [ ] **Server restart (group):** Send room message, all others receive; restart server; have one member reconnect and trigger replay → sender (without refresh) gets `ROOM_DELIVERY_UPDATE` and sees double tick (hydration from DB used).  
- [ ] **Refresh (room):** Send room message, all others receive, sender sees double tick; refresh sender page → still double tick (history `deliverySummary` restores `roomDeliveryByRoomMessageId`).  
- [ ] **Sender excluded:** Room with only sender (or 1 member); send message → single tick (totalCount 0, no completion).

---

## Tests added

- **Backend:** `backend/tests/delivery/room-delivery-aggregate.test.js`  
  - Completion only after all other members marked delivered; sender excluded from count; idempotent record.

- **Frontend:** `myfrontend/frontend/tests/chat/roomDeliveryDerivedStatus.test.js`  
  - Derived status: delivered when `deliveredCount === totalCount` and `totalCount > 0`; sent otherwise; `ROOM_DELIVERY_UPDATE`-style map update yields delivered; totalCount 0 never yields delivered.
