# Multi-tab WebSocket repro and instrumentation

**Note:** This instrumentation was removed. Debug mode flags (WS_DEBUG_MODE, PresenceTrace, WS_CONN_TRACE) are no longer available. This doc is kept for understanding multi-tab behavior only.

## Env

- **Backend:** No debug env vars; run with `npm run dev`.
- **Frontend:** Run with Vite dev for normal dev behavior.

## What to verify

1. **Multi-tab uses SAME sessionId (sid) for both tabs**  
   Cookie-based auth: same cookie in both tabs → same `sid`. Verify via normal connection/presence logs.

2. **Backend enforces 1 active socket per (userId, sessionId) and closes old with code=4000**  
   When the backend uses single-socket-per-session logic, the old socket gets `closeCode: 4000`, `closeReason: "Replaced by new connection"`. With multi-socket (WS-MULTI-1) both tabs stay connected. Use normal logs to verify.

3. **Reconnect loop prevents ensureSessionReady from succeeding → "Session not ready within timeout" → close 1011**  
   During the window where tabs flip (one closed 4000, one open), HELLO_ACK/replay can run before the session is ready → `ensureSessionReady` times out → backend closes with 1011 "Session not ready".

4. **WS auth failed on logout**  
   After logout, cookies are cleared; client keeps reconnecting; upgrade has no token → 401/1006. Frontend emits `WS_AUTH_FAILED`.

---

## Repro script (cookie mode, single-socket backend)

Steps to observe alternating 4000 closes and resync timeout:

1. **Login tab A**  
   Open app → Login as userA → ensure cookie is set.

2. **Open /chat in tab A**  
   Navigate to /chat → WS connects. In console you should see normal wsClient connect behavior.

3. **Login tab B (same account)**  
   Open a **new tab** → same origin → Login as userA again (or already logged in via shared cookie).

4. **Open /chat in tab B**  
   Navigate to /chat → second WS connection.
   - **If backend enforces 1 socket per (userId, sessionId):**  
     Tab A's socket closes with code 4000; tab A console: `[wsClient] onclose` with `code: 4000`, `reason: "Replaced by new connection"`.
   - **If backend allows multiple sockets (WS-MULTI-1):**  
     Both tabs stay connected.

5. **Observe alternating 4000 and resync**  
   With single-socket enforcement, tab A reconnects → tab B gets 4000 → tab B reconnects → tab A gets 4000 → … During the flip, one tab may get 1011 "Session not ready". Use normal backend logs to verify.

---

## Evidence checklist (copy/paste)

Use these to confirm behavior from one run/screenshot.

### 1) Same sessionId in both tabs (backend)

Multi-tab with shared cookie uses one auth session; verify via normal connection/presence logs.

### 2) Replaced by new connection (single-socket backend only)

```text
(In frontend: onclose with code 4000, reason "Replaced by new connection".)
```

And in frontend (tab that was closed):

```text
[wsClient] onclose { code: 4000, reason: "Replaced by new connection" }
```

**Meaning:** Backend closed the old socket with 4000 when the new one registered.

### 3) ensureSessionReady timeout → 1011

WS close to client: `code=1011` `reason="Session not ready within timeout"`. Replay/HELLO path ran before the session had a socket registered (e.g. during the 4000 flip).

### 4) WS auth failed on logout

Frontend (after logout, when reconnect runs without cookie):

```text
[wsClient] onclose { code: 1006, reason: "" }
```

And app shows WS_AUTH_FAILED / “Session invalid” (or similar).

**Meaning:** Upgrade had no token (cookies cleared); server rejected or connection failed; client treats as auth failure and can show one toast and stop reconnect storm.

---

## Files touched (historical)

This instrumentation was removed. Debug mode flags are no longer available. Behavior and this doc remain for reference only.
