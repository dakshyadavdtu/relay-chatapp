# Application-Level Chat Protocol

Contract between chat clients and server. This document defines application semantics only.

---

## Scope & Non-Goals

**Scope:** Application-level chat messages, delivery and read acknowledgements, reconnect and replay.

**Non-goals:** Transport framing, handshake details, encryption. Wire format and WebSocket details are out of scope.

---

## Message Types

| Name | Direction | Required fields | Optional fields | Description |
|------|-----------|-----------------|-----------------|-------------|
| **send** | Client → Server | recipientId, content | clientMessageId | User sends a message. Server persists then emits sent ACK; may attempt delivery to recipient. |
| **sent** | Server → Client | messageId, state: "sent", timestamp | clientMessageId | Message was persisted. Emitted only after successful DB write. |
| **delivered** | Server → Client | messageId, state: "delivered", timestamp | — | Recipient explicitly confirmed delivery. Emitted only after confirmation. |
| **read** | Server → Client | messageId, state: "read", timestamp | — | Recipient explicitly marked as read. Emitted only after confirmation. |
| **error** | Server → Client | error (human), code (machine) | messageId, clientMessageId, details | Request failed: validation, persistence, rate limit, backpressure, or state error. |

Additional application types (e.g. MESSAGE_RECEIVE to recipient, MESSAGE_DELIVERED_CONFIRM from recipient) exist; the above are the core send/ack/error contract.

---

## Idempotency Rule

- **Idempotency key:** Server treats `(senderId, clientMessageId)` as the idempotency key for sends.
- If the client sends again with the same `clientMessageId`, the server returns the existing `messageId` and current state; no second message row, no duplicate delivery.
- Replay on reconnect uses `messageId` and server-side ordering; messages after `lastSeenMessageId` are replayed in order. Duplicate prevention is via `lastSentMessageId` and delivery state.

---

## ACK Rules

| ACK | When emitted | When NOT emitted |
|-----|----------------|-------------------|
| **Sent** | Only after the message is successfully persisted. | If persistence fails → error to sender; no ACK. |
| **Delivered** | Only after the recipient explicitly confirms delivery (e.g. MESSAGE_DELIVERED_CONFIRM). | If recipient never confirms, or ACK is lost → sender does not get "delivered" until resync. |
| **Read** | Only after the recipient explicitly confirms read and server updates state. | No read ACK before read confirmation. |

No optimistic or inferred ACKs. Each ACK reflects a completed server-side action (persist or confirm).

---

## Reconnect & Replay Flow

- Client reconnects and sends **RESUME** with `lastSeenMessageId` (last message it knows, or null).
- Server fetches messages **strictly after** `lastSeenMessageId` from the database, ordered by the server’s order key.
- Server sends them **sequentially** in ascending order to that client. No parallel replay for the same session.
- Server skips messages already sent to this session (e.g. via `lastSentMessageId`) and messages already delivered per DB state. No duplication guarantee is given beyond this deterministic, ordered replay.

---

## Guarantees vs Non-Guarantees

**Guarantees:**

- Sent ACK only after successful persist.
- Delivered/read ACK only after explicit confirmation and server update.
- Idempotent send for same `clientMessageId`; same `messageId`, no duplicate row.
- Replay after RESUME: messages after `lastSeenMessageId`, in order, without duplicating already-sent/already-delivered messages for that session.

**Non-Guarantees:**

- Exactly-once delivery over the wire; ACKs can be lost.
- Automatic retransmission of ACKs or messages.
- Real-time latency or global ordering across all users.
- Delivery to a recipient who never reconnects; messages remain undelivered until they do.
