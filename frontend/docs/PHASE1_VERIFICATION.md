# Phase 1 — Deterministic Messaging Contract (Verification)

## Contract summary

For every **MESSAGE_SEND** from a client, the server sends the **sender** exactly one terminal result:

1. **MESSAGE_ACK** — message persisted  
   - `clientMsgId` / `clientMessageId` (echoed from send)  
   - `messageId` (server-generated)  
   - `status: "PERSISTED"`  
   - `serverTs`  
   - `recipientId` / `roomId` optional  
   - Full `message` object for UI replacement  

2. **MESSAGE_NACK** — request failed  
   - `clientMsgId` / `clientMessageId`  
   - `code`: `VALIDATION_ERROR` | `UNAUTHORIZED` | `FORBIDDEN` | `RATE_LIMITED` | `INTERNAL_ERROR`  
   - `message` (human-readable)  
   - `serverTs`  

**Delivery** is separate and best-effort:

- **DELIVERY_STATUS** (optional): `messageId`, `recipientId`, `status`: `RECIPIENT_OFFLINE` | `DELIVERED` | `SEEN`, `ts`  
- ACK is sent as soon as the message is persisted; it is **not** gated on delivery.  
- If the recipient is offline, the sender still gets **MESSAGE_ACK** and later **DELIVERY_STATUS** with `RECIPIENT_OFFLINE`.

## Backend behaviour

- **Protocol types**: `MESSAGE_ACK`, `MESSAGE_NACK`, `DELIVERY_STATUS` (in `backend/websocket/protocol/types.js`).  
- **MESSAGE_SEND handler** (`backend/websocket/handlers/sendMessage.js`):  
  - On success: returns **MESSAGE_ACK** with `status: "PERSISTED"`, `serverTs`, `clientMessageId`, `messageId`, `message`.  
  - On validation/persistence error: returns **MESSAGE_NACK** with contract `code` and `message`.  
- **Delivery**: After sending ACK, the server attempts delivery. When the attempt finishes (success or not), it sends **DELIVERY_STATUS** to the sender (`RECIPIENT_OFFLINE` or `DELIVERED`).  
- **Idempotency**: Same `(senderId, clientMessageId)` returns the same **MESSAGE_ACK** and `messageId` (no duplicate message).

## Frontend behaviour

- **Send**: Every send includes `clientMessageId` (e.g. `c_<timestamp>_<random>`).  
- **Optimistic message**: Added with `status: "sending"` (spinner).  
- **On MESSAGE_ACK** (matching `clientMessageId` / `clientMsgId`):  
  - Message is replaced with server payload; `status` set to `"sent"` (spinner stops).  
- **On MESSAGE_NACK**:  
  - Message is marked `status: "failed"` and a toast is shown.  
- **On DELIVERY_STATUS**:  
  - `RECIPIENT_OFFLINE`: message gets `deliveryStatus: "offline"`; UI shows “(offline)” without reverting to spinner.  
  - `DELIVERED` / `SEEN`: message status updated to delivered/read.  
- **Timeout**: Messages stuck in `"sending"` for 15s are marked failed with “Tap to retry”.

## Smoke script

From repo root (or `backend`):

```bash
cd backend
PORT=8000 node scripts/message_ack_smoke.js
```

With a recipient (e.g. another user id):

```bash
RECIPIENT_ID=<user-uuid> PORT=8000 node scripts/message_ack_smoke.js
```

- Asserts: HELLO → HELLO_ACK within 2s.  
- If `RECIPIENT_ID` is set: MESSAGE_SEND with `clientMessageId` → **MESSAGE_ACK** within 2s, with echoed `clientMessageId`/`clientMsgId` and `messageId`; optional **DELIVERY_STATUS** within 2.5s.

## Manual tests

### 1. Online DM

- **Setup**: Two browsers (or tabs): user A and user B, both logged in and with WS connected.  
- **Steps**: User A sends a message to user B.  
- **Expected**:  
  - Spinner stops as soon as **MESSAGE_ACK** is received.  
  - Message shows as sent (single check).  
  - If supported, **DELIVERY_STATUS** `DELIVERED` (and later `SEEN`) updates the tick.

### 2. Offline DM

- **Setup**: User A logged in; user B’s browser closed or not connected.  
- **Steps**: User A sends a message to user B.  
- **Expected**:  
  - Spinner stops on **MESSAGE_ACK** (no infinite “sending”).  
  - Message shows as “Sent” with “(offline)” or equivalent.  
  - No regression: no “queued will send when connected” instead of ACK.

### 3. Failure case

- **Steps**: Force an invalid send (e.g. empty `recipientId` or empty `content` if the client allows, or use devtools to send a malformed payload).  
- **Expected**:  
  - Server responds with **MESSAGE_NACK** with an appropriate `code` and `message`.  
  - UI shows the message as failed and a toast (or equivalent).

### 4. Two-browser reliability

- **Steps**: 50 sends from user A to user B (both online).  
- **Expected**:  
  - Every send gets **MESSAGE_ACK**; spinner stops each time; no failures in the 50 sends.

## Done when (strict)

Phase 1 is complete only when:

- For every **MESSAGE_SEND**, the sender receives **MESSAGE_ACK** or **MESSAGE_NACK**.  
- UI spinner stops on **MESSAGE_ACK** (PERSISTED) even when the recipient is offline.  
- Offline recipient results in **DELIVERY_STATUS** `RECIPIENT_OFFLINE` and UI shows it without spinning.  
- No regressions: HELLO/HELLO_ACK and DM persistence remain stable.  
- Two-browser DM: 50/50 sends succeed with no failures.

## Log excerpts (reference)

**Backend (success, then delivery offline):**

- `MESSAGE_CREATED` / `PERSISTED` for the message.  
- Handler returns **MESSAGE_ACK** to sender.  
- `delivery_attempt_failed_recipient_offline` (when recipient has no socket).  
- **DELIVERY_STATUS** sent to sender with `status: "RECIPIENT_OFFLINE"`.

**Frontend (success):**

- Outbound: `MESSAGE_SEND` with `clientMessageId`.  
- Inbound: `MESSAGE_ACK` with `status: "PERSISTED"`, `messageId`, `clientMessageId`; then optional `DELIVERY_STATUS`.
