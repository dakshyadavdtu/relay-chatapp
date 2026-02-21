# Verification Report: Row A — Presence spam / stack overflow

**Scope:** Prove PRESENCE_OFFLINE is emitted once per user when the last socket closes, with no recursion or Maximum call stack error.  
**Mode:** Verification only. No code changes.

---

## 1. Idempotent guard (lifecycle.js)

| Item | Location | Detail |
|------|----------|--------|
| **Guard condition** | `backend/websocket/connection/lifecycle.js` **50–52** | `if (activeConnectionCount === 0 && (currentPresence === 'offline' \|\| currentPresence === 'OFFLINE')) { return; }` |
| **Before guard** | **46–49** | `activeConnectionCount = connectionManager.getSockets(userId).length` (47); `currentPresence = presenceStore.getPresence(userId)?.status` (47); TEMP debug log (49). No state change, no broadcast. |
| **After guard (when not returning)** | **54–68** | `deliveryService.recordFailuresForDisconnectedUser`, `presenceStore.setPresence(userId, 'offline')`, `transition(PRESENCE_OFFLINE)`, **`presenceNotifier.notifyPresenceChange(userId, 'offline', previousStatus)`** (68). |

**Conclusion:** The guard runs **before** any presence write or broadcast. The only code before the guard is reading count/presence and the TEMP log. Early return when `activeConnectionCount === 0` and presence is already `'offline'`/`'OFFLINE'` prevents a second broadcast.

---

## 2. Cleanup ownership (connectionManager.js)

| Item | Location | Detail |
|------|----------|--------|
| **Close handler** | **165–204** | `_attachCloseAndHeartbeat`: `socket.once('close', ...)`. On close: `sessionStore.markOffline(sessionId, socket)` (173), `connectionStore.deleteSocketUser(socket)` (174), `remainingForUser = this.getSockets(userId).length` (175), then `if (isLastForUser)` → `lifecycle.onDisconnect(userId)` (179). |
| **Explicit cleanup** | **207–238** | `cleanup(userId, sessionId, socket, reason)`: same sequence — `markOffline` (209), `deleteSocketUser` (210), `getSockets(userId).length` (211), `if (isLastForUser)` → `lifecycle.onDisconnect(userId)` (215). Called from: eviction (130), `remove()` (278), `removeSession()` (302), `removeConnection()` (312). |
| **markOffline / socket removal** | **173, 209** | Socket is removed only in (1) the close handler and (2) `cleanup()`. `getSocket()` (245–266) can call `markOffline` only for **already dead** sockets (lazy cleanup at 251) when iterating; it does not run on normal close path. |
| **getSockets(userId)** | **334–341** | Read-only: builds array from `sessionStore.getSessionsByUserId(userId)` and filters by `!isSocketDead(ws)`. No `markOffline`, no `onDisconnect`. |
| **getSocket(userId)** | **245–266** | Has side effect: lazy-removes dead sockets (markOffline + deleteSocketUser) when it encounters them (246–254). Does **not** call `onDisconnect`. Comment at 264: presence OFFLINE is handled only in ws close handlers. |

**Conclusion:** Socket removal for a normal tab close happens only in the close handler (and in `cleanup()` for forced removal). `onDisconnect` is invoked only when that removal leaves the user with zero live sockets. Getters: `getSockets` is read-only; `getSocket` can lazy-clean dead sockets but never triggers presence.

---

## 3. Reproduction observations checklist

- [ ] **Env:** This instrumentation was removed. Debug mode flags (WS_DEBUG_MODE, etc.) are no longer available; use normal server logs.
- [ ] **Setup:** Two tabs, same user, both on `/chat` (both sockets registered).
- [ ] **Close tab 1:**  
  - Backend: one `active_socket_closed`; `remainingForUser === 1`; **no** `onDisconnect` (not last).  
  - **No** PRESENCE_OFFLINE broadcast.
- [ ] **Close tab 2:**  
  - Backend: one `active_socket_closed`; `remainingForUser === 0`; **one** `onDisconnect`; **one** `notifyPresenceChange` (PRESENCE_OFFLINE).  
  - **Exactly one** PRESENCE_OFFLINE to other clients.
- [ ] **No** repeated PRESENCE_OFFLINE for that user.
- [ ] **No** `Maximum call stack size exceeded` or `shutdown_error` in logs.

---

## 4. Expected log lines / keys (backend)

| Phase | Log / key | When / meaning |
|-------|-----------|----------------|
| **Close event** | `ConnectionManager` / `active_socket_closed` | Once per socket close; payload: `userId`, `sessionId`, `code`, `reason`. |
| **onDisconnect enter** | `[TEMP onDisconnect]` | Once per `onDisconnect(userId)` call; payload: `userId`, `currentPresence`, `activeConnectionCount`, `connectionId: null`. |
| **Early return path** | Same `[TEMP onDisconnect]` line, then **no** later `connection_cleanup` or presence broadcast | When guard fires: `activeConnectionCount === 0` and `currentPresence === 'offline'` (or `'OFFLINE'`). No `transition(PRESENCE_OFFLINE)`, no `notifyPresenceChange`. |
| **Before broadcast** | `ConnectionManager` / `connection_cleanup` | When `isLastForUser` and lifecycle ran; payload: `userId`, `sessionId`, `reason: 'natural_close'` (or forced). |
| **notifyPresenceChange** | No dedicated backend log key | Implied by single PRESENCE_OFFLINE to other clients; no extra log in `presence.js`. |

**Two-tab close sequence (expected):**

1. Close tab 1:  
   `active_socket_closed` → cleanup start with `isLastForUser: false`, `remainingForUser: 1` → `socket_removed_user_still_connected`. **No** `[TEMP onDisconnect]`, **no** `connection_cleanup`. (DBG_LEAVE_TRACE instrumentation was removed; use normal logs.)
2. Close tab 2:  
   `active_socket_closed` → cleanup start with `isLastForUser: true`, `remainingForUser: 0` → **one** `[TEMP onDisconnect]` with `activeConnectionCount: 0`, `currentPresence` not yet `'offline'` → **one** `connection_cleanup` → single PRESENCE_OFFLINE broadcast.

If `onDisconnect` were called again (e.g. from a second close handler), the second `[TEMP onDisconnect]` would show `currentPresence: 'offline'` and `activeConnectionCount: 0` → guard returns → no second broadcast.

---

## 5. PASS / FAIL conditions

**PASS:**

- Closing the last tab produces exactly one `[TEMP onDisconnect]` with `activeConnectionCount: 0` and (that one time) `currentPresence !== 'offline'`, followed by one `connection_cleanup` and one PRESENCE_OFFLINE to other clients.
- Closing a non-last tab produces **no** `[TEMP onDisconnect]` and **no** PRESENCE_OFFLINE.
- No duplicate PRESENCE_OFFLINE for the same user in a single “last tab close” scenario.
- No stack overflow or `shutdown_error` in backend logs.

**FAIL:**

- More than one PRESENCE_OFFLINE for the same user when only the last tab is closed.
- PRESENCE_OFFLINE when a non-last tab is closed.
- Any `Maximum call stack size exceeded` or recursion in presence/close path.
- Repeated `[TEMP onDisconnect]` with same `userId` and `activeConnectionCount: 0` **without** the guard preventing a second broadcast (second log line should show `currentPresence: 'offline'` and then no `connection_cleanup` / broadcast).

---

## 6. Conclusion

- **Guard:** `lifecycle.js` **50–52** runs before any presence write or `notifyPresenceChange` (**68**); early return when already offline and zero connections prevents duplicate broadcast.
- **Cleanup:** Socket removal and `onDisconnect` are only triggered from the close handler and `cleanup()` in `connectionManager.js`; `getSockets` is read-only; `getSocket` does not trigger presence.
- **Repro:** Two tabs same user → close first (no offline) → close second (exactly one offline); no recursion, no stack error.

**Verdict:** Implementation satisfies “PRESENCE_OFFLINE once per user when last socket closes” and “no recursion / stack overflow” provided the repro checklist and PASS conditions above are met in a manual run.
