# WS ready — end-to-end verification

Use this checklist to confirm: **messages are not queued; they are sent.** (HELLO_ACK received, `wsClient.isReady()` true, DM send does not show "Message queued…", admin shows online users > 0.)

---

## PASS — observed evidence (0W-2 cookie Path fix)

After fixing auth cookie Path from `/api` to `/` (0W-2):

- **Login Set-Cookie:** `curl` and smoke script show `Path=/` for `token` and `refresh_token` (e.g. `Set-Cookie: token=...; Path=/; ...`).
- **Browser cookies:** Application → Cookies for localhost shows auth cookies with **Path** = `"/"`.
- **WS request:** DevTools → Network → WS → `/ws` request headers include `Cookie: token=...` (and `refresh_token=...`), so the backend can authenticate the upgrade.
- **Console:** After opening /chat, logs show WS open → HELLO sent → **HELLO_ACK received** and `wsClient.isReady()` is true.
- **Send DM:** Sending a direct message does **not** show the toast "Message queued, will send when connected." Message is sent and delivered immediately (no queue).
- **Admin Dashboard:** ONLINE USERS > 0 (at least the current user). LATENCY shows samples; System Activity does not spam reconnect bursts.
- **Automated smoke:** `backend/scripts/ws_smoke.js` passes (HELLO_ACK within 2s) and logs `Cookie Path in Set-Cookie: /`.

**Stop condition met:** You can send a message and it is delivered without queuing.

---

## Manual checklist

### 1) Start backend + frontend

- **Backend:** From repo root, e.g. `cd backend && PORT=8000 node server.js` (or `npm run dev`). Ensure no port conflict.
- **Frontend:** From frontend dir, e.g. `cd myfrontend/frontend && npm run dev`. Ensure `VITE_ENABLE_WS=true` and `VITE_BACKEND_PORT` matches backend port (e.g. 8000).

### 2) Open /chat and check devtools console

- Log in if needed, then open **/chat**.
- Open **DevTools → Console**.
- Confirm:
  - **HELLO sent then HELLO_ACK received:** You should see logs like `[ws] connecting to …`, then `[wsClient] WS OPEN -> sending HELLO`, then `[wsClient] READY TRUE via HELLO_ACK` (or similar).
  - **wsClient.isReady() true:** After HELLO_ACK, the client is ready. You can type `wsClient.isReady()` in the console (if `wsClient` is exposed) or infer from the absence of "WebSocket not ready" toasts.

### 3) Send a DM message

- In the chat UI, send a **direct message** to another user (or a test user).
- Confirm:
  - **Must NOT show toast "Message queued, will send when connected."** If you see that toast, the WebSocket is not ready or the fix did not apply.
  - **Message must go through immediately:** It should appear with a sending → delivered/seen (or your UI’s equivalent) flow, not stuck in a queue.

### 4) Open Admin Dashboard

- As an admin user, open the **Admin Dashboard** (e.g. /admin or /admin/dashboard).
- Confirm:
  - **ONLINE USERS > 0** (at least 1 while you have /chat open).
  - **Messages per second** (or equivalent) updates after you send messages.
  - **System Activity** (or activity feed) shows recent events and does **not** show a repeated "reconnect burst" spam (many reconnect/close entries in a short time).

---

## Optional: automated smoke (backend)

A small Node script verifies **login → WS with cookie → HELLO → HELLO_ACK within 2s**. Optionally it can send one DM and expect MESSAGE_ACK.

**Script:** `backend/scripts/ws_smoke.js`

**How to run:**

```bash
cd backend
PORT=8000 node scripts/ws_smoke.js
```

- Backend must be running on the given port (default 8000).
- Uses `dev_admin` / `dev_admin` by default (or set `WS_SMOKE_USER`, `WS_SMOKE_PASS`).
- **Pass:** Prints `Cookie Path in Set-Cookie: /`, then `HELLO_ACK received. WS smoke OK.` and exits 0.
- **Fail:** No HELLO_ACK within 2s (or login/connect error) → exit 1. If it prints `Cookie Path in Set-Cookie: not /`, fix backend cookie Path (0W-2).

**Optional: send one message and expect ACK**

- Set `RECIPIENT_ID` to a valid user id (e.g. another test user’s UUID). The script will send one `MESSAGE_SEND` and wait for `MESSAGE_ACK` (2s); if received, prints `MESSAGE_ACK received. Send smoke OK.`
- Example (replace with real UUID):  
  `RECIPIENT_ID=some-user-uuid PORT=8000 node scripts/ws_smoke.js`

---

## Stop condition (what “verified” looks like)

You can consider the flow verified when:

- **Console/log:** HELLO_ACK is received (e.g. `[wsClient] READY TRUE via HELLO_ACK` or smoke script: `HELLO_ACK received. WS smoke OK.`).
- **Send behavior:** Sending a DM does **not** show "Message queued, will send when connected" and the message is sent immediately (sending → delivered/seen as per your UI).

Screenshot or log showing HELLO_ACK + one successful send without queue toast is sufficient proof.
