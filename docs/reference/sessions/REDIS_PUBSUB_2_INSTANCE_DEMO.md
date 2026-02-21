# Redis Pub/Sub — 2-Instance Demo & Verification

Repeatable proof that **chat.message** (cross-instance DM delivery) and **admin.kick** (cross-instance ban/revoke) work across two backend instances sharing one Redis and one DB.

---

## 1. Prerequisites

- Docker (for Redis)
- Node.js (backend + frontend)
- Same DB and auth config for both backends (see below)

---

## 2. Start Redis

```bash
docker run --rm -p 6379:6379 redis:7
```

Leave this running. Both backends will use `REDIS_URL=redis://localhost:6379`.

---

## 3. Shared DB and env (both instances)

Both backends **must** use the same database and auth so users and messages are shared:

- `DB_URI` — same MongoDB connection string
- `JWT_SECRET` — same secret so tokens work on both instances
- Any other DB/auth env your app uses (e.g. `COOKIE_DOMAIN`, `ALLOWED_ORIGINS`) should be consistent

Use the same `.env` in the backend directory for both, or set these explicitly when starting each process.

---

## 4. Start backend A and backend B

**Terminal 1 — Backend A (port 8000):**

```bash
cd backend
PORT=8000 INSTANCE_ID=A REDIS_URL=redis://localhost:6379 NODE_ENV=development npm run dev
```

**Terminal 2 — Backend B (port 8001):**

```bash
cd backend
PORT=8001 INSTANCE_ID=B REDIS_URL=redis://localhost:6379 NODE_ENV=development npm run dev
```

Ensure both load the same DB/auth env (e.g. from `backend/.env` or `dotenv`). Default `npm run dev` is `NODE_ENV=development node server.js`; PORT/INSTANCE_ID/REDIS_URL can be set in the same env or on the command line.

---

## 5. Connect two clients (two frontends, two backend ports)

The frontend proxies `/api` and `/ws` to the backend port set by `VITE_BACKEND_PORT`. Run **two** frontend dev servers, each pointing at a different backend.

**Terminal 3 — Frontend for Backend A (app on 5173, proxy to 8000):**

```bash
cd myfrontend/frontend
VITE_BACKEND_PORT=8000 npm run dev
```

Open **http://localhost:5173** — this talks to Backend A.

**Terminal 4 — Frontend for Backend B (app on 5174, proxy to 8001):**

```bash
cd myfrontend/frontend
VITE_BACKEND_PORT=8001 npm run dev -- --port 5174
```

Open **http://localhost:5174** — this talks to Backend B.

**Option B (alternative):** Use two browser profiles (e.g. Chrome + Chrome Incognito, or Chrome + Firefox), each using one of the above URLs. No extra frontend process; just two tabs/windows on 5173 and 5174 with different users.

---

## 6. DM test (chat.message) — A → B and B → A

1. **User 1 on Instance A:** Log in at http://localhost:5173 (backend A).
2. **User 2 on Instance B:** Log in at http://localhost:5174 (backend B).
3. **A → B:** From 5173 (User 1), send a DM to User 2.  
   - **Expect:** Message appears in real time on 5174 (User 2) without refresh. Backend B receives `chat.message` from Redis and delivers via local sockets.
4. **B → A:** From 5174 (User 2), send a DM to User 1.  
   - **Expect:** Message appears in real time on 5173 (User 1). Backend A receives `chat.message` and delivers locally.

Sending via **WebSocket** (chat UI) or **HTTP** (e.g. POST send message) both persist and publish; the other instance delivers if the recipient is connected there.

---

## 7. Admin test (admin.kick) — ban and revoke

1. **User 2 connected on B:** User 2 is logged in at http://localhost:5174 (WebSocket to backend B).
2. **Admin on A:** Log in as admin at http://localhost:5173. Go to admin → Users, find User 2, click **Ban** (or **Revoke all sessions** / **Revoke one session**).
3. **Expect:**  
   - Backend A performs the action and publishes `admin.kick` to Redis.  
   - Backend B receives `admin.kick`, disconnects User 2’s local sockets:  
     - **BAN:** ERROR payload + close code 4003 `ACCOUNT_SUSPENDED`.  
     - **REVOKE_ALL:** close 1000 `Removed`.  
     - **REVOKE_ONE:** close 1000 `Session revoked` for that session.  
   - User 2’s session on 5174 disconnects immediately (same UX as if banned/revoked on B).

Repeat with **admin on B** and **user on A** to confirm the reverse direction.

---

## 8. Expected logs (redacted — IDs only, no content)

Use these as a checklist; exact format may vary (e.g. structured JSON or plain text).

**Redis connected and subscribed (both instances):**

- `[Redis]` / `RedisBus` — initialized, channels `chat.message`, `admin.kick`
- Instance ID in logs (e.g. `instanceId: "A"` / `"B"`)

**Publish (instance that did the action):**

- `RedisBus` — `chat_message_published` (messageId, recipientId, originInstanceId)
- `RedisBus` — `admin_kick_published` (action, targetUserId, originInstanceId)

**Receive (other instance):**

- `RedisBus` / `RedisBusHandler` — `chat_message_delivered` or handler receipt (messageId, recipientId, originInstanceId)
- `RedisBusHandler` — `admin_kick_ban_applied` / `admin_kick_revoke_all_applied` / `admin_kick_revoke_one_applied` (targetUserId, targetSessionId if REVOKE_ONE, originInstanceId)

**Delivery / kick execution (redacted):**

- Message delivery: `attemptDelivery` or message lifecycle log with **messageId** (no message content).
- Kick: logs with **userId** and, for REVOKE_ONE, **sessionId** only.

No log line should contain message content or secrets.

---

## 9. Hard verification checklist

Use this to confirm behavior and safety; no new production features required.

| # | Check | How to verify |
|---|--------|----------------|
| 1 | **Redis down in dev — backend still boots** | Stop Redis (or do not start it). Start backend with `NODE_ENV=development` (no `REDIS_URL` or with Redis unreachable). Backend should start after init timeout (~5s), log **bus_disabled** / init_timeout, and show “Backend listening”. |
| 2 | **Local delivery still works when bus disabled** | With Redis down, single instance: send DM. Sender gets ACK; recipient gets MESSAGE_RECEIVE if on same instance. No Redis publish; no cross-instance path. |
| 3 | **No unhandledRejection from subscriber handlers** | All Redis subscriber handlers (onChatMessage, onAdminKick) are wrapped in try/catch (and bus-level catch). Trigger chat.message and admin.kick; process must not exit with unhandledRejection. |
| 4 | **Publish failures never change ACK/HTTP response** | WS sendMessage: ACK and local attemptDelivery are independent of `publishChatMessage` (fire-and-forget, catch errors). HTTP send message: response is sent before publish; publish in try/catch. Disable Redis or break publish and confirm: ACK/201 and local delivery unchanged. |
| 5 | **Self-origin ignored (INSTANCE_ID)** | With two instances A and B: send DM from User 1 on A to User 2 on B. On backend A logs you should **not** see delivery of that message to User 2 (User 2 is on B). On A you may see `chat_message_self_origin_ignored` or no delivery log for that messageId; delivery happens only on B. Same idea for admin.kick: kick from A should not be “applied” on A for the same reason. |

---

## 10. Quick reference — env summary

| Env | Backend A | Backend B | Notes |
|-----|-----------|-----------|--------|
| `PORT` | `8000` | `8001` | HTTP + WS listen port |
| `INSTANCE_ID` | `A` | `B` | Required for self-origin ignore and logs |
| `REDIS_URL` | `redis://localhost:6379` | same | Both use same Redis |
| `NODE_ENV` | `development` | `development` | Enables graceful Redis degradation if Redis down |
| `DB_URI` / `JWT_SECRET` etc. | same | same | Shared DB and auth |

Frontend:

| Env | Frontend 1 (for A) | Frontend 2 (for B) |
|-----|---------------------|---------------------|
| `VITE_BACKEND_PORT` | `8000` | `8001` |
| Vite dev server port | default 5173 | `--port 5174` |

---

*No new production features. Demo and verification only.*
