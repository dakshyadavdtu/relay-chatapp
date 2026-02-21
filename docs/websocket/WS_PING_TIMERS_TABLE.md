# WS PING / PRESENCE_PING Timer Audit

## Table (BEFORE)

| File | Line | Purpose | Interval ms | Clear logic location |
|------|------|---------|-------------|----------------------|
| wsClient.js | 123 | PING keepalive | 30000 | clearPingTimer() at 114; called in onclose (314), scheduleWsReauthReconnect (404), disconnect (460), shutdown (477) |
| ChatAdapterContext.jsx | 230 | PRESENCE_PING | 60000 | Effect cleanup `return () => clearInterval(presencePingInterval)` (233); deps `[]` |

## Duplication conditions identified

1. **Reconnect race:** In `scheduleWsReauthReconnect` we do sync cleanup (`ws = null`, `clearPingTimer()`, `connect()`). The **old** socket’s `onclose` fires later and calls `clearPingTimer()` again, which can clear the **new** connection’s timer (started on HELLO_ACK). So one PING interval per connection was not guaranteed.
2. **PRESENCE_PING in React:** The interval lives in ChatAdapterContext with `deps []`. In Strict Mode (dev) the effect can run twice (mount → unmount → mount); cleanup runs on unmount so normally only one interval. But the interval is **not** tied to WS lifecycle: it keeps running after disconnect and only skips sending when `!wsClient.isReady()`. So we can have an interval per mount, not per WS connection, and it’s never cleared on WS close/reconnect.
3. **Multiple listeners:** `wsClient.subscribe()` is used by http.js and ChatAdapterContext; each adds a listener. Subscribing does not create timers; timers are created in wsClient (PING) and ChatAdapterContext (PRESENCE_PING). So no duplication from listeners.
4. **Connect idempotence:** `connect()` already guards with `if (ws != null && ws.readyState !== CLOSED && ws.readyState !== CLOSING) return;` so we do not create parallel WebSocket instances.

## Table (AFTER)

| File | Line | Purpose | Interval ms | Clear logic location |
|------|------|---------|-------------|----------------------|
| wsClient.js | startPingKeepalive | PING keepalive | 30000 | clearPingTimer(closedWs) in onclose; clearPingTimer() in disconnect, shutdown, scheduleWsReauthReconnect. Owner-based clear in onclose so old onclose does not clear new connection’s timer. |
| wsClient.js | startPresenceKeepalive | PRESENCE_PING | 60000 | clearPresenceTimer(closedWs) in onclose; clearPresenceTimer() in disconnect, shutdown, scheduleWsReauthReconnect. Same owner-based clear. |
| ChatAdapterContext.jsx | — | PRESENCE_PING | — | **Removed.** PRESENCE_PING is sent only from wsClient’s presence timer (one per connection, cleared on close). |

## Guarantees after fix

- **Exactly one PING interval per WS connection:** Started on HELLO_ACK; cleared only when that connection closes (owner-based clear in onclose) or on disconnect/shutdown/reconnect sync cleanup.
- **Exactly one PRESENCE_PING interval per WS connection:** Same; moved into wsClient, started on HELLO_ACK, 60s; cleared on close/disconnect/shutdown.
- **Intervals always cleared on close/reconnect/unmount:** onclose clears if owner matches; disconnect/shutdown and scheduleWsReauthReconnect clear unconditionally.
- **Reconnect never creates parallel WS:** Unchanged; `connect()` idempotence guard remains.
- **connectionGeneration:** Used for diagnostics (PING_TIMER_START/CLEAR with generation). Timer callbacks can optionally no-op if generation changed (self-stop).

## Presence correctness

- PRESENCE_PING is still sent every 60s while connected (same as before).
- One immediate PRESENCE_PING on HELLO_ACK is still sent from ChatAdapterContext when handling HELLO_ACK; the **interval** is now only in wsClient. So presence remains correct; only the source of the periodic send moved from React effect to wsClient.

## Strict mode double-mount

- The PRESENCE_PING interval no longer lives in ChatAdapterContext, so React Strict Mode (double mount/unmount) does not create duplicate presence intervals. Only wsClient starts the presence timer, and only once per HELLO_ACK per connection.

## Evidence (tests)

- **tests/transport/wsClient.timers.test.js**: "connect() is idempotent when ws already OPEN" — second connect() when socket is OPEN does not create another WebSocket. Run: `npm run test -- --run tests/transport/wsClient.timers.test.js`

## Evidence (tests)

- **`tests/transport/wsClient.timers.test.js`**: `connect() is idempotent when ws already OPEN` — second `connect()` when socket is OPEN does not create another WebSocket (constructor called once). Run: `npm run test -- --run tests/transport/wsClient.timers.test.js`
