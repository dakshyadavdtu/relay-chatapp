# PHASE 4 — Rate limit: ERROR before close (no logout / no drop by default)

## Summary

When a WebSocket message is rate-limited:
- **Default:** Send an ERROR frame; do **not** close the socket. Connection stays open.
- **Sustained abuse (shouldClose):** Send the ERROR frame **first**, then close the socket after a short delay so the client always receives the ERROR.

No auth/session/JWT or frontend logic was changed. Non–rate-limit policy violations still close immediately (unchanged).

---

## Step 1 — Locations (identified)

| What | File | Details |
|------|------|--------|
| Rate-limit decision | `backend/websocket/safety/socketSafety.js` | `checkRateLimit(ws)` returns `{ allowed, remaining, resetAt, shouldClose? }`. `validateIncomingMessage` uses it; `checkMessage()` returns `policy: FAIL`, `meta: { code, shouldClose, resetAt, remaining }`. |
| Router FAIL handling | `backend/websocket/router.js` | Lines 68–117: on `result.policy === FAIL`, previously called `closeAbusiveConnection` then returned `{ policy: 'FAIL', response }`. Dispatcher then called `sendResponse(ws, result.response)` but socket was already CLOSING so send was skipped. |
| Dispatcher send | `backend/websocket/protocol/dispatcher.js` | `sendResponse(ws, response)` returns early if `ws.readyState !== 1` (line 29). So any close before send prevents the ERROR from being sent. |
| Close codes | `backend/websocket/connection/wsServer.js` | `CloseCodes.RATE_LIMIT = 4008`, `CloseCodes.POLICY_VIOLATION = 1008`. |

---

## Step 2 & 3 & 4 — Implementation

**File changed:** `backend/websocket/router.js` only.

1. **Build ERROR once:** For every FAIL we build a single `errorResponse` object with `type: 'ERROR'`, `code`, `error`, and for rate limit: `message: 'Slow down'`, `retryAfterMs` (from `resetAt` or `config.RATE_LIMIT.windowMs`), plus `resetAt`, `remaining`, `version`.

2. **Rate limit + shouldClose:**  
   - Call **`sendResponse(ws, errorResponse)`** immediately (so the ERROR is sent while the socket is still OPEN).  
   - **`setTimeout(() => socketSafety.closeAbusiveConnection(ws, 'RATE_LIMIT', CloseCodes.RATE_LIMIT), 100)`** so the close happens after the frame is flushed.  
   - **Return `{ policy: 'FAIL' }`** (no `response`) so the dispatcher does not call `sendResponse` again (avoids duplicate and avoids sending after close).

3. **Non–rate-limit shouldClose:** Unchanged: call `closeAbusiveConnection` immediately, then return `{ policy: 'FAIL', response: errorResponse }`. Dispatcher may still not send if readyState is already not OPEN; this phase does not change that.

4. **FAIL without shouldClose:** Return `{ policy: 'FAIL', response: errorResponse }` as before; dispatcher sends the ERROR, socket stays open.

5. **Close code/reason for rate limit:** Already use `CloseCodes.RATE_LIMIT` (4008) and reason `'RATE_LIMIT'`; no change.

---

## Why the dispatcher no longer misses the final ERROR

- **Before:** Router called `closeAbusiveConnection(ws, ...)` then returned `{ policy: 'FAIL', response }`. Dispatcher then ran `sendResponse(ws, result.response)`, but the socket was already in CLOSING state, so `sendResponse` exited early and the client never got the ERROR.
- **After (rate limit + shouldClose only):** Router sends the ERROR via `sendResponse(ws, errorResponse)` **before** any close. Then it schedules `closeAbusiveConnection` 100 ms later. So the ERROR is sent while `readyState === OPEN` and can be flushed; the close happens after.

---

## What was not changed

- **Auth / session / JWT:** No edits to `wsServer.js` upgrade auth, `sessionStore`, `tokenService`, or any HTTP auth. No logout or session invalidation on rate limit.
- **Non–rate-limit policy violations:** PAYLOAD_TOO_LARGE, INVALID_JSON, etc. with `shouldClose` still close immediately and then return response; behavior unchanged.
- **Safety layer:** No changes to `socketSafety.js` (thresholds, warn/throttle/close semantics) or to `flowControl.js`, `backpressure.js`.
- **Frontend:** No changes; client already handles ERROR with `RATE_LIMIT_EXCEEDED` and `retryAfterMs`.

---

## Manual verification (Step 6)

1. Start backend with WS logging (if supported): e.g. `WS_LOG_LEVEL=debug` or existing ws logs.
2. Open app, log in, open `/chat`.
3. Trigger rate limit (for test only):
   - Set `WS_RATE_LIMIT_MESSAGES=10`, restart backend.
   - Exceed limit (e.g. switch chats and send quick bursts).
4. **Expected:**
   - When rate limited **without** sustained abuse: client receives ERROR with `code: "RATE_LIMIT_EXCEEDED"`, `retryAfterMs`, socket **stays open**.
   - When sustained abuse triggers **shouldClose**: client receives the same ERROR, then after ~100 ms the socket closes with code **4008** and reason **RATE_LIMIT**.
   - No logout and no auth-failed side effects.
5. Restore `WS_RATE_LIMIT_MESSAGES` to normal (e.g. 100) after testing.

---

## Diff summary

**backend/websocket/router.js**

- For FAIL: build one `errorResponse` (with `retryAfterMs` for rate limit).
- If `result.meta?.shouldClose` and **rate limit**: call `sendResponse(ws, errorResponse)`, then `setTimeout(..., 100)` to `closeAbusiveConnection(ws, 'RATE_LIMIT', CloseCodes.RATE_LIMIT)`, then `return { policy: 'FAIL' }`.
- If `result.meta?.shouldClose` and **not** rate limit: keep previous behavior (close then return with response).
- Otherwise: return `{ policy: 'FAIL', response: errorResponse }` as before.

No other files modified.
