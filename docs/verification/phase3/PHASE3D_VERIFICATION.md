# Phase 3D Typing + Presence for DM Chat – Verification Steps

## Backend schema (discovered)

### TYPING_START / TYPING_STOP (client → server)
- Payload (DM): `{ type: "TYPING_START" | "TYPING_STOP", targetUserId: string }`
- Backend: typing handler → forwards to target user's socket
- Rate limit: 4 events per 2000ms per (userId, roomId)

### Server → client (typing)
- `{ type: "TYPING_START", targetUserId, userId, timestamp }` – userId is typist, targetUserId is recipient (me)
- `{ type: "TYPING_STOP", targetUserId, userId, timestamp }` – same shape

### PRESENCE_PING (client → server)
- Payload: `{ type: "PRESENCE_PING", status?: string }` (optional)
- Backend returns PRESENCE_PONG to sender only; does NOT persist. Presence is connection-lifecycle based.
- No periodic PRESENCE_PING required; backend uses connect/disconnect for presence.

### PRESENCE_UPDATE (server → client)
- `{ type: "PRESENCE_UPDATE", userId, status, previousStatus?, timestamp, version }`
- Emitted to all other connected users when someone connects (online) or disconnects (offline).

---

## Manual verification

### 1. Two-browser typing test
1. Start backend + frontend.
2. Log in as userA in browser 1, userB in browser 2.
3. UserA opens DM with userB (api chat or dm-).
4. UserA types in input (without sending).
5. **Expected**: UserB sees "<name> is typing…" in header within ~300ms.
6. UserA stops typing.
7. **Expected**: Indicator clears within ~2–4s (backend forwards TYPING_STOP; frontend also auto-expires after 4s).

### 2. Presence test (if backend emits PRESENCE_UPDATE)
1. UserA has DM with userB open.
2. UserB closes tab or disconnects.
3. **Expected**: UserA sees presence change (green dot → gray) or "Offline" status.
4. UserB reopens tab.
5. **Expected**: UserA sees "Online" / green dot again.

### 3. PRESENCE_PING (optional)
- Backend does NOT require periodic PRESENCE_PING. Presence comes from connection lifecycle.
- `wsClient.sendPresencePing()` is available for optional heartbeat; no scheduler added.

### 4. Reconnect test
1. UserA and userB both in DM; typing works.
2. Stop backend, wait for disconnect.
3. Restart backend; WS reconnects.
4. **Expected**: Typing still works after reconnect; no console errors.

### 5. No spam / rate limits
- TYPING_START throttled to at most once per 2s while typing.
- TYPING_STOP sent on idle (1200ms), on send, on blur, on conversation switch.
- Backend enforces 4 typing events per 2s; frontend stays within limit.

---

## Event types wired

| Type | Direction | Handler |
|------|-----------|---------|
| TYPING_START | Outgoing | wsClient.sendTypingStart, ChatAdapterContext on DM input |
| TYPING_STOP | Outgoing | wsClient.sendTypingStop, ChatAdapterContext on idle/send/blur |
| TYPING_START | Inbound | ChatAdapterContext → typingByChatId |
| TYPING_STOP | Inbound | ChatAdapterContext → clear typingByChatId |
| PRESENCE_PING | Outgoing | wsClient.sendPresencePing (optional) |
| PRESENCE_UPDATE | Inbound | ChatAdapterContext → presenceByUserId |
| PRESENCE_PONG | Inbound | wsClient emit (optional response) |

---

## Backend events not in CONTRACT

- `PRESENCE_UPDATE` – backend emits on connect/disconnect; not listed in CONTRACT.json outgoing types. Wired and handled.
- `PRESENCE_PONG` – response to PRESENCE_PING; not in CONTRACT. Wired and handled.

## DM-only scope

- Typing and presence indicators are shown only for DM chats (`direct:*` or `dm-*`).
- Room typing/presence not implemented (backend supports roomId; frontend does not use it for this phase).

---

## Runtime test steps (explicit)

### Typing end-to-end
1. Two browsers: userA, userB. Both logged in.
2. UserA opens DM with userB (conversationId `direct:userA:userB` or `dm-{userB}`).
3. UserA types in input (no send). Verify WS frames: `TYPING_START {"targetUserId":"userB",...}`.
4. UserB sees header: "UserA is typing…" within ~300ms.
5. UserA stops typing. After ~1.2s: `TYPING_STOP` sent. UserB indicator clears within ~2–4s.
6. Payload fields: backend emits `{type, userId, targetUserId, timestamp}`; frontend sends `{type, targetUserId}`.

### Presence end-to-end
1. UserA has DM with userB open.
2. DevTools → Network → WS: confirm `PRESENCE_UPDATE` when userB connects/disconnects.
3. If backend sends `PRESENCE_PONG` (response to PRESENCE_PING): frontend updates presenceByUserId.
4. Header shows green dot when other user online, gray when offline.
