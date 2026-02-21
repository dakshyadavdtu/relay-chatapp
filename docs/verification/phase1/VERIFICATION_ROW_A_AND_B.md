# Verification: Row A (Presence) + Row B (Message Delivery) — Hard verify & root cause

**Mode:** Verification and diagnosis only. **NO code changes.**

---

# PHASE A — Row A: Presence spam / stack overflow (hard verify)

## Goal
Verify PRESENCE_OFFLINE is emitted **once per user** when the last socket closes, with no recursion or Maximum call stack error.

## 1. Idempotent guard

| Item | File:line | Detail |
|------|-----------|--------|
| **Guard** | `backend/websocket/connection/lifecycle.js` **50–52** | `if (activeConnectionCount === 0 && (currentPresence === 'offline' \|\| currentPresence === 'OFFLINE')) return;` |
| **Before guard** | **46–49** | `activeConnectionCount = connectionManager.getSockets(userId).length` (47); `currentPresence = presenceStore.getPresence(userId)?.status` (47); `console.log('[TEMP onDisconnect]', ...)` (49). No setPresence, no broadcast. |
| **notifyPresenceChange** | **68** | Called only when guard does **not** return; one broadcast per “last socket closed” transition. |

**Conclusion:** Guard runs before any presence write or broadcast. Second call to `onDisconnect` for same user (e.g. double close) sees `currentPresence === 'offline'` and returns → no second broadcast.

## 2. Cleanup ownership

| Item | File:line | Detail |
|------|-----------|--------|
| **Close handler** | `backend/websocket/connection/connectionManager.js` **165–204** | `socket.once('close', ...)` → `markOffline(sessionId, socket)` (173), `deleteSocketUser(socket)` (174), `getSockets(userId).length` (175), `if (isLastForUser)` → `lifecycle.onDisconnect(userId)` (179). |
| **cleanup()** | **207–238** | Same sequence; called from eviction (130), remove (278), removeSession (302), removeConnection (312). |
| **getSockets(userId)** | **334–341** | Read-only; no markOffline, no onDisconnect. |
| **getSocket(userId)** | **245–266** | Lazy-removes dead sockets only; does **not** call onDisconnect. |

**Conclusion:** Socket removal and onDisconnect only from close handler and cleanup(). getSockets/getSocket do not trigger presence.

## 3. Reproduction checklist

- [ ] (Instrumentation removed: WS_DEBUG_MODE no longer available; use normal server logs.)
- [ ] Two tabs, same user, both on `/chat`
- [ ] **Close tab 1:** Backend: one `active_socket_closed`; `remainingForUser: 1`; **no** `[TEMP onDisconnect]`; **no** PRESENCE_OFFLINE
- [ ] **Close tab 2:** Backend: one `active_socket_closed`; `remainingForUser: 0`; **one** `[TEMP onDisconnect]`; **one** `connection_cleanup`; **exactly one** PRESENCE_OFFLINE
- [ ] No repeated PRESENCE_OFFLINE; no stack overflow / shutdown_error

## 4. Log evidence

| Phase | Log key | Expected |
|-------|---------|----------|
| Close event | `ConnectionManager` / `active_socket_closed` | `userId`, `sessionId`, `code`, `reason` |
| onDisconnect enter | `[TEMP onDisconnect]` | `userId`, `currentPresence`, `activeConnectionCount` |
| Early return | Same line only; no `connection_cleanup` after | When `activeConnectionCount === 0` and `currentPresence === 'offline'` |
| Before broadcast | `ConnectionManager` / `connection_cleanup` | When isLastForUser; `reason: 'natural_close'` |

## 5. Phase A conclusion

**PASS:** One PRESENCE_OFFLINE when last tab closes; none when non-last closes; no recursion/stack error.  
**FAIL:** Duplicate PRESENCE_OFFLINE for same user, or PRESENCE_OFFLINE on non-last close, or stack overflow.

**Full report:** `docs/VERIFICATION_ROW_A_PRESENCE.md`

---

# PHASE B — Row B: Cross-browser message delivery (root cause finder)

## Goal
Diagnose why messages appear only after refresh. Classify root cause A/B/C/D and collect evidence. No code changes.

---

## 1. Receiver WebSocket readiness

| Item | File:line | Evidence |
|------|-----------|----------|
| **Ready definition** | `myfrontend/frontend/src/transport/wsClient.js` **37, 183–185, 584–585** | `ready = true` only on **HELLO_ACK** (184); `isReady()` = `ready && ws?.readyState === WebSocket.OPEN`. |
| **Chat adapter subscribe** | `myfrontend/frontend/src/features/chat/adapters/ChatAdapterContext.jsx` **269–327** | Single `useEffect` (auth + `VITE_ENABLE_WS`): subscribes via `wsClient.subscribe({ onStatus, handleMessage })` (293–303) **then** calls connect. Subscription is registered **before** connect; same handler receives all messages once socket is open. |
| **HELLO_ACK handling** | **316–327** | On HELLO_ACK: `setWsReady(true)`, `sendRoomList(false)`, `sendResume(lastSeen)`. RESUME triggers STATE_SYNC_RESPONSE / MESSAGE_REPLAY; no explicit re-subscribe. |
| **Reconnect** | `wsClient.js` **266–274, 371, 391** | On close: `ready = false`. Reconnect restarts handshake; HELLO → HELLO_ACK again sets `ready = true`. Listener set is persistent; `emit(msg)` (229) runs for every message including MESSAGE_RECEIVE. |

**Evidence checklist (receiver ready):**
- [ ] Receiver tab shows `[wsClient] B1 handshake complete: HELLO -> HELLO_ACK` (or `[ws] connected`) before sender sends.
- [ ] Receiver has `connectionStatus === 'connected'` and `isReady() === true` when message is sent.
- [ ] After reconnect, HELLO_ACK received again and `setWsReady(true)` runs (ChatAdapterContext 320).

---

## 2. Backend sends MESSAGE_RECEIVE to recipient

| Item | File:line | Evidence |
|------|-----------|----------|
| **Target sockets** | `backend/websocket/services/message.service.js` **54, 129** | `sendToUserSocket(userId, message)`: uses `connectionManager.getSockets(userId)` (54). `attemptDelivery`: uses `connectionManager.getSockets(msgData.recipientId)` (129). Recipient is **msgData.recipientId** from DB (intake.message.recipientId from sendMessage handler). |
| **Payload** | `backend/websocket/handlers/sendMessage.js` **87–95, 96** | `receivePayload` = `{ type: 'MESSAGE_RECEIVE', messageId, senderId: intake.message.senderId, recipientId: intake.message.recipientId, content, timestamp, state }`. `attemptDelivery(ack.messageId, receivePayload, ...)` (96). |
| **Logs** | `message.service.js` **55–64, 131–142, 144–145** | This instrumentation was removed. Debug mode flags (WS_DEBUG_MODE) are no longer available. Use normal server logs; delivery path is sendToUserSocket / attemptDelivery. |

**Evidence checklist (backend):**
- [ ] When UserA sends to UserB, backend log shows **MESSAGE_RECEIVE_attemptDelivery** (or **MESSAGE_RECEIVE_send**) with `recipientId: UserB_id`, `socketCount > 0`, non-empty `connectionIds` → delivery path ran and recipient had sockets.
- [ ] If **MESSAGE_RECEIVE_recipient_offline** or **delivery_attempt_failed_recipient_offline** with `recipientId: UserB_id` → backend considers UserB offline (B: targeting / connection state).
- [ ] **delivery_attempt_succeeded** (193): `recipientId`, `sentCount: sockets.length` → message was queued to recipient sockets.

---

## 3. Conversation / chatId consistency

| Layer | Format | File:line |
|-------|--------|-----------|
| **Backend MESSAGE_RECEIVE** | No chatId in frame. Sends `senderId`, `recipientId`, `content`, `messageId`, `timestamp`, `state`. | `sendMessage.js` 87–95 |
| **Frontend derivation** | `chatId = directChatId(msg.senderId, recipientId)` where `recipientId = msg.recipientId ?? me?.id`. `directChatId(a,b)` = `direct:${sorted(a,b)}` (e.g. `direct:userA:userB`). | `ChatAdapterContext.jsx` 47–51, 232–235 |
| **State key** | Messages stored in `messagesByConversation[chatId]`; key is **exactly** the derived `direct:smallId:largeId`. | 246–258 |

**Conclusion:** Backend does not send chatId; frontend derives it from `senderId` + `recipientId`. If backend sends correct `recipientId` (the recipient’s userId), chatId is consistent. **Mismatch risk:** backend using wrong recipientId (e.g. senderId) or frontend `me?.id` wrong at merge time would put message under wrong key (C).

---

## 4. Root cause decision tree (A/B/C/D)

Use this to classify “message only visible after refresh”:

```
1. Is the RECEIVER’s WebSocket connected and ready when the sender sends?
   - Check receiver: HELLO_ACK received, isReady() true, connectionStatus 'connected'.
   - If NO → A (WebSocket readiness: HELLO_ACK / RESUME / reconnect timing).
   - If YES → go to 2.

2. Does the backend have at least one socket for the recipient at delivery time?
   - Check backend logs (instrumentation removed; use normal logs): MESSAGE_RECEIVE delivery path in message.service.js:
     socketCount > 0 and connectionIds non-empty?
   - If NO (socketCount === 0 or MESSAGE_RECEIVE_recipient_offline) → B (Backend targeting: wrong userId or socket list empty).
   - If YES → go to 3.

3. Does the frontend use the same conversation key the UI expects?
   - Backend sends senderId + recipientId; frontend chatId = directChatId(senderId, recipientId).
   - Sidebar/chat list key: direct:u1:u2 or dm-{userId}; ensure messagesByConversation key matches.
   - If key mismatch (e.g. backend recipientId wrong, or frontend me.id stale) → C (Frontend state key mismatch).
   - If keys match → go to 4.

4. Is the receiver’s handleMessage subscribed and invoked for MESSAGE_RECEIVE?
   - Single subscription in ChatAdapterContext useEffect; handleMessage (303) dispatches MESSAGE_RECEIVE to mergeMessageReceiveRef (448).
   - If subscription lost (e.g. unmount/remount, listener cleared) or handleMessage not called → D (Frontend handler lifecycle / subscription).
   - If invoked but UI still not updating → possible React state batching or component not reading from same context (still D or C).
```

**Classification:**
- **A** — WebSocket readiness (HELLO_ACK / RESUME / reconnect).
- **B** — Backend targeting (wrong sockets, wrong userId, recipient not in connectionManager).
- **C** — Frontend state key mismatch (chatId / conversationId).
- **D** — Frontend handler lifecycle (subscription failure, unmount, listener not called).

---

## 5. Evidence summary (file:line + log signature)

| Root cause | File:line | Log / evidence |
|------------|-----------|----------------|
| **A** | wsClient.js 183–185, 584–585; ChatAdapterContext.jsx 316–327 | Receiver: HELLO_ACK received; `[wsClient] READY TRUE via HELLO_ACK`; after reconnect, HELLO_ACK again. |
| **B** | message.service.js 54, 129, 131–145, 193 | **MESSAGE_RECEIVE_attemptDelivery**: `recipientId`, `socketCount`, `connectionIds`. **MESSAGE_RECEIVE_recipient_offline** or **delivery_attempt_failed_recipient_offline** → B. **delivery_attempt_succeeded** → backend believes it delivered. |
| **C** | ChatAdapterContext.jsx 232–258; sendMessage.js 87–95 | Backend payload has `recipientId` = stored message recipient. Frontend `recipientId = msg.recipientId ?? me?.id`; chatId = directChatId(senderId, recipientId). Compare with key used by sidebar (e.g. getConversationId / direct:). |
| **D** | ChatAdapterContext.jsx 269–327, 303, 448 | Single subscribe in useEffect; handleMessage branches to `mergeMessageReceiveRef.current(msg)` for MESSAGE_RECEIVE (448). Add temporary console.log in handleMessage for type MESSAGE_RECEIVE to confirm invocation. |

---

## 6. Minimal patch proposals (DO NOT IMPLEMENT)

- **If A (readiness):** Ensure receiver completes HELLO → HELLO_ACK before sender sends; or add small delay/retry for “deliver when recipient becomes ready” (e.g. queue by recipientId and flush on HELLO_ACK for that user). Optionally log when HELLO_ACK is received per tab.
- **If B (targeting):** Log `getSockets(recipientId)` length and recipientId at attemptDelivery entry; ensure message persist uses correct recipientId from payload; ensure no race where socket is removed between persist and delivery.
- **If C (key mismatch):** Ensure backend MESSAGE_RECEIVE always includes canonical `recipientId` (recipient’s userId). Frontend: ensure `me?.id` is set when merge runs (or always use `msg.recipientId` for DM and derive chatId only from senderId + recipientId).
- **If D (lifecycle):** Ensure ChatAdapterProvider (and thus the subscribe effect) is mounted for the receiver tab and not torn down on route change; ensure one subscription per mount and cleanup on unmount (current code unsubscribes in effect cleanup 287–288). Add defensive log in handleMessage when `msg.type === 'MESSAGE_RECEIVE'` to confirm delivery to handler.

---

## 7. Phase B deliverable summary

- **Root cause classification:** Use the decision tree above to label failure as **A**, **B**, **C**, or **D**.
- **Evidence:** File:line above; use normal server logs. (WS_DEBUG_MODE instrumentation was removed.)
- **Minimal patch proposal:** Section 6 — apply only the branch that matches the chosen root cause; do not implement here.

**Next step:** Run Phase B first (repro + logs), then Phase A (two-tab close). Share Phase B classification (A/B/C/D) and log snippets; then use fix-only prompts for the chosen cause.
