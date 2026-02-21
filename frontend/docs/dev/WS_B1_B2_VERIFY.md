# B1/B2 verification runbook

Deterministic dev checklist to prove **WS readiness (HELLO/HELLO_ACK)**, **send reliability (ACK/RECEIVE)**, and **reconnect behavior (no drops/duplicates)** in under 5 minutes.

---

## 1. Required environment

### Frontend (myfrontend/frontend)

| Variable | Purpose | Example |
|----------|---------|---------|
| `VITE_BACKEND_PORT` | Port the Vite proxy uses for `/api` and `/ws`. Must match backend `PORT`. | `8000` (default in vite.config if unset) or `3001` |
| `VITE_DEV_BYPASS_AUTH` | If `"true"`, WS URL gets `?dev_user=dev_admin` (dev bypass). Must align with backend. | `true` for quick dev; unset for cookie auth |

- See `docs/dev/DEV_AUTH_MATRIX.md` and `docs/dev/WS_DEV_SETUP.md` for port and auth alignment.

### Backend (backend)

| Variable | Purpose | Example |
|----------|---------|---------|
| `PORT` | Port the backend listens on. Must equal frontend `VITE_BACKEND_PORT`. | `8000` or `3001` |
| `ALLOW_BYPASS_AUTH` | If `true` (and `NODE_ENV !== 'production'`), upgrade accepts `?dev_user=` without cookie. | `true` for dev bypass |

- For bypass: `NODE_ENV=development` and `ALLOW_BYPASS_AUTH=true`.
- Optional: `WS_LOG_LEVEL=debug` to see backend WS logs (e.g. `ws_hello_decision`, `ws_upgrade_bypass`).

---

## 2. Start commands

**Backend (from repo root or backend dir):**

```bash
cd backend
PORT=8000 NODE_ENV=development ALLOW_BYPASS_AUTH=true node server.js
# or: npm run dev (if it sets PORT/ALLOW_BYPASS_AUTH)
```

**Frontend (separate terminal):**

```bash
cd myfrontend/frontend
# If backend is on 8000, leave VITE_BACKEND_PORT unset (default 8000)
# If backend is on 3001: VITE_BACKEND_PORT=3001
npm run dev
```

Confirm in logs:

- Backend: `B1 DEV: PORT=... | ws path=/ws | ALLOW_BYPASS_AUTH=...` — PORT must match frontend.
- Frontend: `[vite-proxy] B1` shows `VITE_BACKEND_PORT`, `bypassEnabled` — port must match backend; bypass must match backend ALLOW_BYPASS_AUTH.

---

## 3. Browser verification — B1 (WS readiness)

1. Open the app in the browser (e.g. `http://localhost:5173`).
2. **DevTools → Network → WS**  
   - Select the `/ws` request (or the WS connection).
   - Open **Messages / Frames**.
3. **Frames to see:**
   - **Outbound:** `{"type":"HELLO","version":1}` (or current protocol version).
   - **Inbound:** `{"type":"HELLO_ACK",...}` (e.g. `version: 1`).
4. **Console log markers (frontend dev build):**
   - `[wsClient] WS OPEN -> sending HELLO`
   - `[wsClient] READY TRUE via HELLO_ACK`
   - Optionally: `[wsClient] B1 handshake complete: HELLO -> HELLO_ACK`

If you see HELLO then HELLO_ACK in the WS frames and the console markers above, **B1 is satisfied** (WS ready; no “WebSocket not ready” toasts after load). Keep chat open 2 min: WS stays connected, isReady true, no reconnect storm; queue flushes only after HELLO_ACK.

---

## 4. Messaging verification — B2 (ACK/RECEIVE)

**Two browsers (or two profiles / incognito):**

- **Browser A:** Log in as user A (or use dev bypass so A is `dev_admin`).
- **Browser B:** Log in as user B (different user).

**Steps:**

1. In both, ensure WS is ready (B1 checklist above; no “WebSocket not ready” toasts).
2. In A: open a DM (or conversation) with B.
3. From A, send a message: “Test 1”.
4. **In A — DevTools → Network → WS → Frames:**
   - Outbound: `MESSAGE_SEND` with `recipientId`, `content`, `clientMessageId`.
   - Inbound: `MESSAGE_ACK` with `messageId` and same `clientMessageId`.
5. **In B — same WS Frames:**
   - Inbound: `MESSAGE_RECEIVE` with same message (e.g. same `messageId`/content).
6. In B’s UI: the message “Test 1” appears exactly once.
7. Repeat a few times (e.g. 5–10 messages). All show MESSAGE_ACK in A and MESSAGE_RECEIVE in B; no duplicates in B’s thread.

**Console (optional):** In dev, `[wsClient] protocol MESSAGE_ACK` and `[wsClient] protocol MESSAGE_RECEIVE` may appear for these frames.

If A gets ACK and B gets RECEIVE and the thread has no duplicates, **B2 send/ACK/RECEIVE path is verified**.

---

## 5. Reconnect verification — B2 (no drops, no duplicates)

**Goal:** After a hard refresh of the sender mid-send, the message either becomes **ACKed** (after reconnect + outbox flush) or is **marked failed** with a clear error; it must **never** disappear silently or duplicate.

**Steps:**

1. **Browser A** and **Browser B** both on the app, WS ready, DM (or conversation) open between A and B.
2. In A, type a message but **do not send yet** (or send and immediately continue).
3. **While A’s message is “in flight” (or right after send):** In A, perform a **hard refresh** (e.g. Ctrl+Shift+R / Cmd+Shift+R) or close the tab and reopen the app and open the same conversation.
4. **Expected outcomes (one of):**
   - After reconnect, A’s message appears in the thread with a **server-confirmed state** (e.g. tick/ACK); **or**
   - The message is **marked failed** (e.g. red/failed state) with a clear error (e.g. toast or inline error).
5. **Not acceptable:**
   - Message **disappears** with no error and no trace.
   - **Duplicate** of the same message in the thread (e.g. same content twice with different IDs or same ID twice).

**Optional:** Repeat 2–3 times (refresh at different moments: before send, right after send, during outbox flush). Each run: message either ACKed after reconnect or explicitly failed; no silent drop and no duplicates.

If every run meets the expected outcomes, **B2 reconnect behavior is verified**.

---

## 6. Optional: Backend-only smoke (port/proxy check)

Without opening the UI, you can check that the backend accepts a WS connection and responds to HELLO with HELLO_ACK:

```bash
cd backend
PORT=8000 NODE_ENV=development ALLOW_BYPASS_AUTH=true node scripts/ws-smoke.js
```

- **Success:** Script exits 0 and prints that HELLO_ACK was received.
- **Failure:** Script exits 1 and prints why (e.g. connection refused, no HELLO_ACK within 1s). Use this to confirm port, bypass, and that the backend is up before testing in the browser.

---

## Summary

| Check | What to verify |
|-------|----------------|
| **B1** | WS frames: HELLO → HELLO_ACK. Console: `[wsClient] WS OPEN -> sending HELLO`, `[wsClient] READY TRUE via HELLO_ACK`. No “WebSocket not ready” toasts. |
| **B2 send** | A sends → A sees MESSAGE_ACK in WS frames; B sees MESSAGE_RECEIVE and message in UI; no duplicates. |
| **B2 reconnect** | Refresh A mid-send; message either ACKed after reconnect or marked failed; never silently dropped or duplicated. |

Follow this doc to reproduce successful B1/B2 in under 5 minutes.
