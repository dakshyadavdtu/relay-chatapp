# Message Ticks DM Fix (Phase 1)

Realtime update of sender-side ticks and "(offline)" for **DM only**, without refresh. Group logic unchanged.

---

## What changed

### Part A — Backend: notify sender when replay delivers DM messages

**File:** `backend/services/replay.service.js`

- **~Line 41 (new require):**  
  `const { sendToUserSocket } = require('../websocket/services/message.service');`

- **~Lines 227–237 (after pushing to messagesToEmit, inside the replay loop):**  
  For each replayed message that is DM (`replayType === 'MESSAGE_RECEIVE'`) and has `msg.senderId`, emit a sender-facing update:
  - Build payload: `{ type: 'MESSAGE_STATE_UPDATE', messageId: msg.messageId, state: MessageState.DELIVERED }`
  - Call `sendToUserSocket(msg.senderId, senderUpdate, { correlationId, messageId: msg.messageId })` so **all** of the sender’s sockets (tabs/devices) receive it.

Idempotency: this runs only when the message has actually been transitioned to DELIVERED (after DB + memory guards and successful `updateMessageState` / `markMessageDelivered`). No change to room replay; only DM messages trigger this emit.

---

### Part B — Frontend: "(offline)" derived from presence + status

**File:** `myfrontend/frontend/src/features/chat/ui/ChatWindow.jsx`

- **~Lines 679–688 (replaced previous 680–682):**
  - **Old:** Show "(offline)" only when `isMe && msg.deliveryStatus === "offline"`.
  - **New:** Show "(offline)" only when **all** of:
    - `isMe`
    - `isDmChat`
    - Message not delivered/read: `msg.status !== "delivered" && msg.status !== "read"`
    - Recipient considered offline:
      - If presence for `dmOtherUserId` exists: `presence.status === "offline" || presence.online === false`
      - If presence unknown: fallback `msg.deliveryStatus === "offline"`

So "(offline)" is driven by **recipient presence** and **message status**; `deliveryStatus` is only a fallback when presence is unknown. When `MESSAGE_STATE_UPDATE` (from Part A) sets `msg.status` to `"delivered"` via `updateMessageStatusByMessageId` (ChatAdapterContext 2199–2222), the tick becomes double and the "(offline)" condition becomes false, so the label disappears without refresh.

---

## DM rules for ticks / offline (after fix)

1. **Ticks (status icon)**  
   - Still from `msg.status`: sending/queued → spinner, sent → single check, delivered/read → double check (from `getStatusIcon` / `getStatusIconConfig`).

2. **When status updates in realtime**  
   - Send-time: existing `DELIVERY_STATUS` (DELIVERED / RECIPIENT_OFFLINE) still updates status / deliveryStatus.  
   - After replay: backend sends `MESSAGE_STATE_UPDATE` (state: delivered) to the sender; frontend handler (ChatAdapterContext 776–778) calls `updateMessageStatusRef.current(messageId, "delivered", …)`, so the sender’s message moves to double tick without refresh.

3. **"(offline)" label**  
   - Shown only for **my** messages in a **DM** when:
     - Message is not delivered or read (`status !== "delivered"` and `status !== "read"`), and  
     - Recipient is offline: from presence when available, else from `deliveryStatus === "offline"`.  
   - Disappears when:
     - Status becomes `delivered` or `read` (e.g. after `MESSAGE_STATE_UPDATE` from replay), or  
     - Recipient is considered online (presence or fallback).

4. **Group**  
   - Unchanged: no "(offline)" in group UI; group ticks/status logic not modified.

---

## Manual test steps

### a) Recipient offline → send → single tick + offline label

1. Use two users (e.g. two browsers or incognito): **A** (sender) and **B** (recipient).
2. Log in as **B**, then disconnect or close the tab so **B** is offline (presence shows offline for A).
3. As **A**, open the DM with **B** and send a message.
4. **Expect:**  
   - Single tick (sent).  
   - "(offline)" label next to the message (recipient offline, message not delivered).

### b) Recipient comes online → replay → sender sees double tick and no "(offline)" without refresh

1. Keep the same setup; **A** has sent a message while **B** was offline (single tick + "(offline)").
2. As **B**, open the app (or reconnect) so **B** is online. Ensure replay runs (e.g. MESSAGE_REPLAY or RESUME with lastMessageId so backend replays the message to B).
3. **Do not refresh A’s tab.**
4. **Expect on A’s screen (without refresh):**  
   - The same message updates to **double tick** (delivered).  
   - The **(offline)** label **disappears**.  
5. Optional: confirm in network/console that A received a `MESSAGE_STATE_UPDATE` with `state: "delivered"` for that messageId after B reconnected/replay.

---

## Summary

- **Backend:** Replay, when it marks a DM message as DELIVERED for the recipient, now also sends `MESSAGE_STATE_UPDATE` (messageId, state: delivered) to the sender via `sendToUserSocket`, so all sender sockets get the update.  
- **Frontend:** "(offline)" is derived from DM + message not delivered/read + recipient offline (presence-first, `deliveryStatus` as fallback). Status updates from `MESSAGE_STATE_UPDATE` (including from replay) drive ticks and removal of "(offline)" in realtime.  
- **Scope:** DM only; group logic untouched.
