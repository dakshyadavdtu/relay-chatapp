# WebSocket Failure Cases & Backpressure Policy

## Tier-1: MESSAGE_RESULT Enum (Deterministic)
- `OK` — message accepted
- `FAILED` — handler must mark state FAILED; client receives failure ack
- `DROPPED` — message ignored; no response

## Safety Gate Policy Mapping
- rate limit → FAIL
- payload overflow (with shouldClose) → DROP
- queue overflow → FAIL

## Backpressure Policy (Canonical)

### Max BufferedAmount / Queue Threshold
- **MAX_OUTBOUND_QUEUE_SIZE**: from config.BACKPRESSURE.maxQueueSize (default 200)
- When queue is full: **fail-fast**, no silent buffering

### Deterministic Return Contract
`socketSafety.sendMessage(ws, message)` NEVER throws. Returns exactly one of:
- `{ ok: true, queued: true }` — message accepted
- `{ ok: false, reason: 'BACKPRESSURE', bufferedAmount, threshold, queueFull, shouldClose? }` — rejected

### Handlers / Services
- On `ok: false`: treat as **message FAILED**
- Send MESSAGE_ERROR to sender (e.g. RECIPIENT_BUFFER_FULL)
- Do not retry into the same socket; client must reconnect

### No Silent Buffering
- Caller receives explicit result; must handle failure

---

## Rate Limiting

- Enforced at **single entry point**: `ws.on('message')` → `socketSafety.validateIncomingMessage` **before** routing
- Every incoming WS message passes through rate limiter before any handler runs
- Handlers assume: "If this function runs, rate-limit already passed"
- No per-handler rate-limit checks

---

## Connection Lifecycle

- Presence is mutated **only** in: onConnect, onDisconnect, heartbeat timeout
- Handlers never mutate presence stores
