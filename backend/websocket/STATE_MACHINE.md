# Message State Machine

Formal message lifecycle. Invalid transitions are rejected by the server.

---

## States

| State | Meaning |
|-------|--------|
| **sending** | Transient: server accepted the send request but has not yet persisted. |
| **sent** | Message persisted. May or may not have been delivered to the recipient. |
| **delivered** | Recipient explicitly confirmed delivery (e.g. MESSAGE_DELIVERED_CONFIRM). |
| **read** | Recipient explicitly marked the message as read. |

There is no separate **failed** state: persistence failure results in an error response and no message or state transition (message is not created).

---

## Events

| Event | Description |
|-------|-------------|
| **Send accepted** | Client send request accepted; message created in sending state. |
| **Persist success** | Message written to database; transition sending → sent. |
| **Delivery confirm** | Recipient confirmed delivery; transition sent → delivered. |
| **Read confirm** | Recipient confirmed read; transition delivered → read. |
| **Reconnect replay** | On RESUME, server may replay undelivered messages; no state transition for already-sent/delivered/read. |
| **Persistence failure** | DB write failed; no message created, no transition, error to sender. |

---

## Valid Transitions

| Current state | Event | Next state |
|---------------|--------|------------|
| (none) | Send accepted | sending |
| sending | Persist success | sent |
| sent | Delivery confirm | delivered |
| delivered | Read confirm | read |
| read | — | (terminal) |

---

## Invalid Transitions

- **sent → sending**
- **sent → read** (read before delivered)
- **delivered → sent**
- **delivered → sending**
- **read → any other state**
- **sending → delivered**
- **sending → read**

If the client sends a confirmation that would imply an invalid transition, the server returns an error (e.g. INVALID_TRANSITION) and does not change state. Idempotent cases (e.g. confirm delivery when already delivered) may return success and current state without changing state.

---

## Invariants

- A message cannot be **read** unless it has been **delivered**.
- A "sent" ACK is emitted only after the message is in the **sent** state (persisted).
- A "delivered" ACK is emitted only after the recipient’s explicit delivery confirmation (state **delivered**).
- State is authoritative on the server; the client cannot force an illegal transition.
