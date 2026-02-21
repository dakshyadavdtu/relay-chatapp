# Presence debug — User shown offline when online (WS presence bug)

**Note:** This instrumentation was removed. Debug mode flags (WS_DEBUG_MODE, PresenceTrace, WS_CONN_TRACE) are no longer available. `npm run dev:presence` is an alias for `npm run dev`. This doc is kept for root-cause analysis and historical reference only.

## Root cause

1. **getSocket() lazy cleanup treated CLOSING as dead**  
   When diagnostics (or any caller) called `connectionManager.isUserConnected(userId)` → `getSocket(userId)`, the code removed any socket with `readyState === CLOSING` or `CLOSED` from the store. If the user’s only socket was in CLOSING state (e.g. network toggle, refresh, code 1005/1001), it was removed before the socket `close` event ran. Then `getSocket()` returned `null` → **online: false** even though the connection was still in the process of closing.

2. **isUserConnected() relied on getSocket()**  
   So a single call to the diagnostics endpoint (or any code path that called `getSocket()` / `isUserConnected()`) could clear the only socket from the store and then report offline.

3. **Reconnect / multi-tab ordering**  
   The close handler itself was correct: it removes the socket, then checks `getSockets(userId).length`. The bug was only in the **read path** (getSocket lazy cleanup and isUserConnected), not in the write path.

## Fix summary

- **Lazy cleanup only for CLOSED:** In `connectionManager.getSocket()`, only remove sockets that are **CLOSED** (`readyState === 3`), not CLOSING. So the close event remains the sole path that removes a socket that is still in CLOSING.
- **Presence = OPEN or CLOSING:** Added `getActiveConnectionCount(userId)` that counts sockets with `readyState !== CLOSED`. `isUserConnected(userId)` now uses this count so a user is considered online until the last socket is CLOSED.
- **Diagnostics:** `online` and new fields `activeConnectionCount` and `connectionKeys` (redacted) are derived from this same source of truth.

Invariants enforced:

- If `activeConnectionCount(userId) > 0` → `online === true`.
- PRESENCE_OFFLINE only when the last active connection is removed (in the close handler, after removal, when count becomes 0).
- Closing an older socket during reconnect does not flip the user offline if a newer socket is already in the store.

## How to reproduce (before vs after)

### Before (bug)

1. Open app in 2 tabs as the same user.
2. Hard refresh tab A; keep tab B idle.
3. Toggle network offline/online once in DevTools.
4. Observe: Admin diagnostics can show `online: false` for that user even while they are still connected (e.g. tab B or a new socket). Backend may log rapid connect → close (1005/1001) and reconnect; a diagnostics request during CLOSING could clear the socket and report offline.

### After (fix)

1. Same steps: 2 tabs, hard refresh one, network toggle.
2. Diagnostics and presence stay **online** until the last socket is fully CLOSED. No false offline from getSocket() lazy cleanup. Reconnect race (old socket closes after new one opens) keeps user online.

## Repro steps (deterministic)

1. Open the app in **2 tabs** as the **same user** (same account).
2. In **tab A**: do a **hard refresh** (e.g. Cmd+Shift+R). Leave **tab B** idle.
3. In DevTools (either tab): open **Network** tab, set **Offline** for a few seconds, then set **Online** again.
4. Observe:
   - UI presence (e.g. “Online” badge) and Admin → User → **Diagnostics** (`online` and `activeConnectionCount`).
   - Backend logs: `[PRESENCE_DBG]` lines and any `active_socket_closed` / `connection_cleanup` with codes 1005/1001.

## Relevant logs (sample)

To debug presence again, add temporary `console.log('[PRESENCE_DBG]', JSON.stringify({...}))` in connectionManager (on open/close/cleanup) and lifecycle (onConnect/onDisconnect), then capture backend stdout and grep for `[PRESENCE_DBG]` and `active_socket_closed`. Example pattern:

```
[PRESENCE_DBG] {"userId":"...","sessionId":"...","connectionId":"...","activeConnectionsForUser":1,"chosenState":"online","reason":"connection_open"}
[PRESENCE_DBG] {"userId":"...","sessionId":"...","connectionId":"...","activeConnectionsForUser":0,"isLastForUser":true,"chosenState":"offline","reason":"natural_close"}
[PRESENCE_DBG] {"userId":"...","activeConnectionCount":0,"chosenState":"offline","reason":"last_connection_closed"}
```

Paste 20–30 lines of the most relevant logs from a repro run below (optional):

```
( Paste logs here after reproducing )
```

## Source of truth

- **Online:** Derived from `connectionManager.getActiveConnectionCount(userId) > 0` (OPEN or CLOSING sockets). Not from “last event” or presence store alone.
- **Diagnostics `online`:** `connectionManager.isUserConnected(userId)` (uses `getActiveConnectionCount`).
- **Presence broadcast:** Still driven by lifecycle `onConnect` / `onDisconnect`; `onDisconnect` is only called when, after removing the closing socket, `getSockets(userId).length === 0`.

---

## Phase 2: Refresh race (old close before new register)

### Bug to prove

Old socket CLOSE path emits OFFLINE because new socket REGISTER has not happened yet. User B sees A go offline briefly when A refreshes.

### How to run backend

- **Run backend:** `npm run dev` or `npm run dev:presence` (alias of `dev`). This instrumentation was removed. Debug mode flags are no longer available.

### Reproduction (2 users)

1. Start backend: `npm run dev` (or `npm run dev:presence`).
2. Log in as **User A** in one browser/tab and **User B** in another (or second device).
3. Keep **User B**'s screen open (watching presence/list).
4. **Refresh User A** (F5 or hard refresh).
5. Observe: On B's UI, A may briefly show OFFLINE then back ONLINE (or only OFFLINE/only one update).

### 1) Run backend in dev

- **Run:** From the **backend** directory: `npm run dev` or `npm run dev:presence`.

### 2) Reproduce (2 users: A and B)

1. Start backend (see above).
2. Log in as **User A** in one browser/tab and **User B** in another (or second device).
3. Keep **User B**'s screen open (watching presence/list).
4. **Refresh User A** (F5 or hard refresh).
5. In the terminal where the backend is running (with the filter below), capture the output.

### Terminal filter command (run from backend dir)

To filter standard connection/presence logs:

```bash
npm run dev 2>&1 | rg -n "active_socket_closed|PRESENCE_(ONLINE|OFFLINE)|connection_established|ws_closed|user_reconnected|user_disconnected"
```

Requires [ripgrep](https://github.com/BurntSushi/ripgrep) (`rg`).

### 3) Expected log ordering when the race happens (bug)

When the **old** socket's close runs **before** the **new** socket is registered, you get this ordering (correlate by **connKey**; old socket has earlier timestamp in connKey):

| # | Timestamp (order) | Event | connKey / notes |
|---|--------------------|--------|------------------|
| 1 | T1 | **ConnectionManager** active_socket_closed | Old socket |
| 2 | T2 | **Transition** PRESENCE_OFFLINE | User A → offline (B sees OFFLINE) |
| 3 | T3 | *(later)* New socket registers | New connKey |
| 4 | T4 | **Transition** PRESENCE_ONLINE | User A → online again (B sees ONLINE) |

**Proof:** OFFLINE is emitted when the old socket closes and remainingForUser becomes 0, before the new socket has registered. This instrumentation was removed. Debug mode flags are no longer available.

### Example log excerpt (bug ordering)

With instrumentation removed, look for **ConnectionManager** `active_socket_closed` and **Transition** `PRESENCE_OFFLINE` before any new connection register. Then **Transition** `PRESENCE_ONLINE` when the new socket is up. Old socket closes → OFFLINE emitted → new socket registers → ONLINE.

### Single condition that makes it wrong

**OFFLINE is emitted when remainingForUser becomes 0 (after the grace timer fires), but during refresh a reconnect is in-flight, so remainingForUser temporarily hits 0 and we emit OFFLINE before the new socket has registered.**

### Fix strategy (chosen)

- **S1 — OFFLINE grace window (debounce) + cancel onConnect:** When the last socket closes, do not emit OFFLINE immediately; wait a grace window (e.g. 500–800 ms). If `onConnect(userId)` runs within that window (same user reconnected), cancel the pending OFFLINE and leave user ONLINE. If the window expires with no reconnect, then emit OFFLINE. Minimal diff, no session-level reconnect flag. **Preferred.** (Current code already has `requestDisconnect(graceMs)` and `onConnect` cancels the timer; if the race still appears, increase `PRESENCE_OFFLINE_GRACE_MS` or ensure the new upgrade completes before the grace expires.)
- ~~S2 — Session-level reconnect intent flag~~ (more complex; not chosen).

---

## Files touched

- `backend/websocket/connection/connectionManager.js`: `isSocketTrulyClosed`, lazy cleanup only CLOSED; `getActiveConnectionCount`, `getConnectionKeys`; `isUserConnected` uses `getActiveConnectionCount`; stable `connectionId` / `_connectionKey`. (Instrumentation flags were removed; use normal logs + tests.)
- `backend/websocket/connection/lifecycle.js`: onConnect/onDisconnect.
- `backend/http/controllers/admin.controller.js`: diagnostics response includes `activeConnectionCount` and `connectionKeys` (redacted).
