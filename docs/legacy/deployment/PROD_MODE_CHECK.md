# Production Mode Check (Tier-0.7) — Runbook

Step-by-step verification that the backend runs correctly in production mode and that Tier-0 invariants hold. This is a **runbook**, not notes.

---

## Step 1 — Start backend in production mode locally

1. Change directory to `backend/`.
2. Set all required production environment variables (see table below). Example:

   ```bash
   export NODE_ENV=production
   export PORT=3000
   export JWT_SECRET=your-secret-here
   export DB_URI=placeholder-or-real-uri
   export COOKIE_DOMAIN=.localhost
   export CORS_ORIGIN=http://localhost:3000
   export WS_PATH=/ws
   ```

3. Run:

   ```bash
   npm run start:prod
   ```

   Or in one line:

   ```bash
   NODE_ENV=production PORT=3000 JWT_SECRET=secret DB_URI=mem COOKIE_DOMAIN=.localhost CORS_ORIGIN=http://localhost:3000 WS_PATH=/ws npm run start:prod
   ```

4. Server must listen on `PORT`. WebSocket is available at `ws://localhost:<PORT>/<WS_PATH>` (e.g. `ws://localhost:3000/ws`).

---

## Step 2 — Full required env variable table (production)

| Variable      | What it controls              | Example production value     | SECRET / NON-SECRET | Where injected (AWS)   |
|---------------|-------------------------------|------------------------------|----------------------|-------------------------|
| NODE_ENV      | Runtime mode                  | `production`                 | NON-SECRET           | EC2 env / PM2          |
| PORT          | HTTP listen port              | `3000`                       | NON-SECRET           | EC2 env / PM2          |
| JWT_SECRET    | JWT signing key               | Strong random string         | SECRET               | EC2 env / PM2          |
| DB_URI        | Database connection           | `mongodb://...` or similar   | SECRET               | EC2 env / PM2          |
| COOKIE_DOMAIN | Cookie domain for browser     | `.example.com`               | NON-SECRET           | EC2 env / PM2          |
| CORS_ORIGIN   | Allowed CORS origin           | `https://app.example.com`    | NON-SECRET           | EC2 env / PM2          |
| WS_PATH       | WebSocket path (match NGINX)  | `/ws`                        | NON-SECRET           | EC2 env / PM2; NGINX path |

**Metrics (production default: secret):** When `NODE_ENV=production` and metrics mode is `secret` (default), `METRICS_SECRET` is **required**. `GET /metrics` then requires header `x-metrics-key: <METRICS_SECRET>`. Optional: set `METRICS_ENABLE_ADMIN_ROUTE=true` to enable `GET /api/metrics` (admin-only, same JSON). **Never** set `METRICS_MODE=open` in production unless you explicitly allow public metrics and set `ALLOW_PUBLIC_METRICS_IN_PROD=true`.

---

## Step 3 — What FAILS when an env var is missing

- **Production with any required var missing:** Process exits with code **1**. `console.error('Missing required environment variable for production: <NAME>')`. Server does **not** listen.
- **JWT_SECRET missing (any mode):** Throws: `JWT_SECRET is required and must be a non-empty string.` Process exits before server starts.

---

## Step 4 — What MUST still work (when env is valid)

When all required vars are set (production) or when running in development with at least `JWT_SECRET` set:

- ✔ **WebSocket connect** — Client can connect to WS path and authenticate via JWT cookie.
- ✔ **Message send** — Client A sends message to B; server persists (DB-first), returns SENT ACK.
- ✔ **Reconnect** — Client B disconnects and reconnects.
- ✔ **Replay** — Reconnect handler calls replay service; missed messages are re-delivered exactly once.
- ✔ **Deterministic ack-drop test** — Must pass (see proof below).

---

## Step 5 — Invariant re-verification (proof)

### Command used

From `backend/`:

```bash
JWT_SECRET=test node tests/ack-drop.test.js
```

### Exit code

**0** (success). Any other exit code = failure; do not proceed to AWS.

### Captured test output (proof)

```
PASS: DB contains exactly one message
PASS: messageId unchanged
PASS: Message content unchanged
PASS: Message marked DELIVERED for B
PASS: Delivery marked exactly once
PASS: No duplicate rows, no duplicate delivery entries
PASS: Second reconnect returns zero messages; DB unchanged
Tier-0.6: ACK-drop test passed — exactly-once persistence and delivery; CI gate OK
```

### Assertions (proof in writing)

- ✔ **DB row count === 1** — After send, idempotent persist, and replay, the database contains exactly one message row. No duplicates. Enforced in test via `dbAdapter.getMessageCount() === 1` and `persistCount === 1`.
- ✔ **messageId unchanged** — The `messageId` before and after reconnect/replay is the same. Enforced by comparing `messageIdBefore` and `messageIdAfter` (from replay result).
- ✔ **State upgraded only after replay** — Delivery is marked exactly once; second reconnect returns zero messages. Enforced by `deliveryCount === 1` and second replay `messageCount === 0`.

If ack-drop fails: **STOP. Do NOT proceed to AWS.** Fix Tier-0 invariants before deployment.
