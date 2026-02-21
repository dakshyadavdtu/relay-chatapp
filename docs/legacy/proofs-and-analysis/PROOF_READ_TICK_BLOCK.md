# Proof: Why Sender Ticks Don’t Update When Receiver Reads

**Root cause:** The frontend FSM only allows **sent → delivered** and **delivered → read**. It does **not** allow **sent → read**. When the sender never got a delivered update (e.g. DELIVERY_STATUS was missed or B was offline at send time), the message stays in **sent**. When B later reads, the backend sends **MESSAGE_READ** (or MESSAGE_STATE_UPDATE) with state **read**. `applyStateUpdateFsm("sent", "read")` returns **null** because the transition is invalid, so the status update is skipped and the sender’s tick never moves to “read”.

---

## 1. Targeted logs added (temporary)

**File:** `myfrontend/frontend/src/features/chat/adapters/ChatAdapterContext.jsx`

- **WS inbound handler**
  - **MESSAGE_STATE_UPDATE** (around 773–777): logs `[READ_TICK_PROOF] WS MESSAGE_STATE_UPDATE <messageId> <msg.state>` before calling `updateMessageStatusRef.current`.
  - **ACK_RESPONSE** (around 786–790): logs `[READ_TICK_PROOF] WS ACK_RESPONSE <messageId> <msg.state>`.
  - **MESSAGE_READ** (around 789–794): logs `[READ_TICK_PROOF] WS MESSAGE_READ <messageId> <readState>` (readState = `msg.state || "read"`).
- **updateMessageStatusByMessageId** (around 2233–2242): logs `[READ_TICK_PROOF] updateMessageStatusByMessageId` with `{ messageId, status, forceSync, beforeStatus, newStatus, skipped }` where `skipped === !newStatus`. When the FSM rejects the transition, `newStatus` is `null` and `skipped` is `true`.

---

## 2. Evidence logs (expected excerpts after repro)

Repro: A sends DM, B offline at send time; B comes online and opens DM (triggers read); watch **A’s** console.

**A’s console (expected):**

```
[READ_TICK_PROOF] WS MESSAGE_READ <messageId> read
[READ_TICK_PROOF] updateMessageStatusByMessageId { messageId: "<id>", status: "read", forceSync: false, beforeStatus: "sent", newStatus: null, skipped: true }
```

- **beforeStatus: "sent"** — sender’s message never moved to delivered (e.g. DELIVERY_STATUS was missed or B was offline).
- **newStatus: null** — FSM rejected **sent → read**.
- **skipped: true** — the code does `if (!newStatus) return prev`, so the status is not updated and the tick does not change.

If the backend sends **MESSAGE_STATE_UPDATE** with state **read** instead of **MESSAGE_READ**, you will see:

```
[READ_TICK_PROOF] WS MESSAGE_STATE_UPDATE <messageId> read
[READ_TICK_PROOF] updateMessageStatusByMessageId { messageId: "<id>", status: "read", forceSync: false, beforeStatus: "sent", newStatus: null, skipped: true }
```

Same cause: **sent → read** is invalid, so the update is skipped.

---

## 3. File + line references where the FSM blocks the transition

### 3.1 FSM: allowed transitions

**File:** `myfrontend/frontend/src/lib/messageStateMachine.js`

- **Lines 14–19 — VALID_TRANSITIONS**
  - `sent` → only `[delivered]` (no `read`).
  - `delivered` → `[read]`.
  So **sent → read** is not in the table.

- **Lines 66–79 — applyStateUpdate (exported as applyStateUpdateFsm)**
  - Uses `isValidTransition(c, n)` (lines 29–35). For `current = "sent"` and `next = "read"`, `allowed = VALID_TRANSITIONS["sent"]` is `["delivered"]`, so `allowed.includes("read")` is false → returns **null**.

### 3.2 Handler calls the updater with forceSync = false

**File:** `myfrontend/frontend/src/features/chat/adapters/ChatAdapterContext.jsx`

- **MESSAGE_READ** (around 789–794): `updateMessageStatusRef.current(id, msg.state || "read", false, ...)` — third argument is **false**, so the FSM is used.
- **MESSAGE_STATE_UPDATE** (around 773–776): `updateMessageStatusRef.current(id, msg.state, false, ...)` — **false**.
- **ACK_RESPONSE** (around 786–788): `updateMessageStatusRef.current(id, msg.state, false, ...)` — **false**.

So for all three, **forceSync** is false and **applyStateUpdateFsm** is used.

### 3.3 Update skipped when FSM returns null

**File:** `myfrontend/frontend/src/features/chat/adapters/ChatAdapterContext.jsx`

- **Lines 2233–2240 (updateMessageStatusByMessageId)**
  - `newStatus = forceSync ? status : applyStateUpdateFsm(beforeStatus, status)`.
  - When `beforeStatus === "sent"` and `status === "read"`, `applyStateUpdateFsm` returns **null**.
  - **Line 2240:** `if (!newStatus) return prev;` — the state update is skipped and the sender’s message status (and tick) stay unchanged.

---

## 4. Summary

| What happens | Where |
|--------------|--------|
| Backend sends read state to sender | MESSAGE_READ or MESSAGE_STATE_UPDATE with state `"read"` |
| Handler calls updater with forceSync=false | ChatAdapterContext.jsx ~773–776, ~786–788, ~789–794 |
| FSM rejects sent→read | messageStateMachine.js VALID_TRANSITIONS (sent→[delivered] only), applyStateUpdate ~77 |
| Updater skips apply when newStatus is null | ChatAdapterContext.jsx ~2240 `if (!newStatus) return prev` |

**Conclusion:** Sender ticks don’t update to “read” when the receiver reads **if the sender’s message is still in "sent"** (e.g. DELIVERY_STATUS was never applied). The FSM only allows **sent → delivered → read**, so a direct **sent → read** is rejected and the update is skipped.
