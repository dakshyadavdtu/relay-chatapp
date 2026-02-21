# Phase 4 Potholes + Phase 3 Regressions — Completion Report

## 1) Files Changed (path + 1-line why)

| File | Change |
|------|--------|
| `src/hooks/useWebSocket.js` | Added dev-only throw to block legacy WS hook; chat uses transport/wsClient via adapters |
| `src/http/client.js` | Added dev-only throw to block legacy HTTP client; use apiFetch from lib/http.js |
| `src/http/chat.api.js` | Added dev-only throw to block legacy chat API; use features/chat/api/chat.api.js |
| `src/http/user.api.js` | Added dev-only throw to block legacy user API; use apiFetch |
| `src/contracts/coverage.json` | Added hardDisabledFiles list for legacy WS; phase flags |

**Pre-existing (no edits this pass):**
- `src/websocket/index.js` — already had dev throw
- `src/websocket/connection/core.js` — already had dev throw
- `src/features/chat/ui/ChatWindow.jsx` — already WS-only send, blocks on !isWsReady
- ROOM_* handlers, STATE_SYNC_RESPONSE, PRESENCE_PONG — already implemented

---

## 2) Coverage Stats

- **ROOM_* handled:** 7 (ROOM_CREATE, ROOM_JOIN, ROOM_LEAVE, ROOM_MESSAGE, ROOM_INFO, ROOM_LIST, ROOM_MEMBERS) — all handled via wsClient + ChatAdapterContext
- **DM WS types handled:** MESSAGE_SEND, MESSAGE_ACK, MESSAGE_RECEIVE, MESSAGE_READ, MESSAGE_STATE_UPDATE, RESUME, MESSAGE_REPLAY, STATE_SYNC_RESPONSE, etc.
- **Error codes:** AUTH_REQUIRED, UNAUTHORIZED, INVALID_PAYLOAD, CONTENT_TOO_LONG, RATE_LIMIT_EXCEEDED, INVALID_CREDENTIALS, INVALID_TRANSITION handled

---

## 3) Manual Verification Checklist

### DM realtime, offline replay, state sync
- [ ] Open DM, send message — appears realtime
- [ ] Disconnect WS, receive message, reconnect — message appears (replay)
- [ ] STATE_SYNC_RESPONSE updates delivered/read states

### Room create/join/leave/message
- [ ] A creates room → appears in Sidebar
- [ ] B joins room → members list updates
- [ ] A sends room msg → B receives realtime
- [ ] Leave room, try send → error surfaced
- [ ] Room list refresh works

### WS single-connection proof
- [ ] `grep -R "new WebSocket" src/` — only wsClient.js reachable (core.js throws before execution)
- [ ] Open /chat in DevTools Network → exactly ONE WebSocket connection to /ws
- [ ] With WS killed: send blocked, toast "Connecting…", input kept; no HTTP POST /api/chat/send

### Legacy stack proof
- [ ] No import of @/websocket, @/http/client, @/http/chat.api, @/http/user.api from chat route tree
- [ ] Build succeeds (`npm run build`)

---

## 4) Ready for Phase 4?

**YES** — if room flows run end-to-end (create, join, message, leave) and only one WS connection is used.

**Run before claiming:**
1. Start backend
2. Start frontend (`npm run dev`)
3. Login, create room, join from second session, send messages, leave
4. Verify DevTools shows single WS to /ws
5. Kill WS, try send — toast appears, no HTTP send
