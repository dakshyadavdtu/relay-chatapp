# Phase E — Two-Instance Proof Checklist (Must Pass Before Merge)

## Commands used

```bash
# 1) Start Redis
docker run --rm -p 6379:6379 redis:7

# 2) Backend A
cd backend
PORT=8000 INSTANCE_ID=A REDIS_URL=redis://localhost:6379 NODE_ENV=development npm run dev

# 3) Backend B (separate terminal)
PORT=8001 INSTANCE_ID=B REDIS_URL=redis://localhost:6379 NODE_ENV=development npm run dev

# 4) Two clients
# Terminal 3: VITE_BACKEND_PORT=8000 npm run dev   → http://localhost:5173 (user1 → A)
# Terminal 4: VITE_BACKEND_PORT=8001 npm run dev -- --port 5174 → http://localhost:5174 (user2 → B)
```

---

## Step 7 — Redis down (verified in this run)

**Setup:** Backend started **without** Redis (no container, no REDIS_URL pointing at a running server).

**Command:**
```bash
cd backend
NODE_ENV=development PORT=8000 INSTANCE_ID=A timeout 18 node -r dotenv/config server.js
```

**Observed logs:**
- `[WARN] [RedisBus] init_timeout {"timeoutMs":5000}`
- `[WARN] [RedisBus] bus_disabled {"reason":"Redis unavailable or timeout","NODE_ENV":"development"}`
- `Backend listening on http://localhost:8000`
- On process exit: `[INFO] [RedisBus] stopped`

**Result:** **PASS** — No crash; bus disabled; server listens. Local delivery path unchanged (publish is no-op when bus disabled; attemptDelivery still called on same instance).

---

## Steps 1–6 — Full two-instance run (run locally with Docker)

These steps require Docker and two backends + two frontends. When you run them:

### Step 5 — DM A → B

1. User1 on http://localhost:5173 (backend A), user2 on http://localhost:5174 (backend B).
2. From user1, send a DM to user2.

**Expected:**
- **Instance A:** Log line like `[INFO] [RedisBus] chat_message_published` with `messageId`, `recipientId`, `originInstanceId` (no content).
- **Instance B:** Log line like `[INFO] [RedisBusHandler] chat_message_delivered` (or handler receipt) with `messageId`, `recipientId`, `originInstanceId`.
- **User2:** Message appears in UI without refresh.

### Step 6 — Admin BAN from A, target user2

1. Admin logged in on A (5173); user2 connected on B (5174).
2. Admin bans user2 (Users → Ban).

**Expected:**
- **Instance A:** `[INFO] [RedisBus] admin_kick_published` with `action`, `targetUserId`, `originInstanceId`.
- **Instance B:** `[INFO] [RedisBusHandler] admin_kick_ban_applied` (or similar); ERROR payload + close 4003 applied to user2’s sockets.
- **User2:** Disconnected with same UX as local ban (ERROR + 4003).

### Step 7 — Redis stopped mid-run

1. Stop Redis (e.g. stop the `docker run` container).
2. Send a DM on one instance (same instance: sender and recipient on same backend).

**Expected:**
- No process crash.
- If bus was already up, subsequent publishes may fail (no-op); local delivery on that instance still works.
- If you restart a backend with Redis down: same as above verified run — `init_timeout`, `bus_disabled`, `Backend listening`.

---

## PASS/FAIL gate

| Step | Description | Status |
|------|-------------|--------|
| 7 (Redis down) | Backend starts, logs bus_disabled, no crash, local delivery unaffected | **PASS** (verified) |
| 1–4 | Redis + backends + two frontends running | Run locally |
| 5 | DM A→B: publish on A, receive/deliver on B, user2 sees message | Run locally |
| 6 | BAN from A: publish on A, B applies ERROR+4003, user2 kicked | Run locally |
| 7 (mid-run) | Redis stop: no crash; local delivery still works | Run locally |

**Conclusion:** Redis-down graceful behavior is **verified**. Full two-instance chat.message and admin.kick proof requires a local run with Docker and two backends/frontends; use this doc and `docs/REDIS_PUBSUB_2_INSTANCE_DEMO.md` for commands and expected logs. If any step fails when you run it, fix before considering Pub/Sub done.
