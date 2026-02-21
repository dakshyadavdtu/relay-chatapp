# Deployment Assumptions (AWS)

This document describes infrastructure assumptions for deploying the chat backend. It does **not** change message or replay semantics.

## TLS & WebSocket

- **TLS is terminated at NGINX.** The backend listens on HTTP (e.g. port 3000). NGINX terminates HTTPS (443) and forwards to the backend over HTTP.
- **WebSocket runs over HTTPS (wss).** Clients connect via `wss://<domain>/<WS_PATH>`. NGINX preserves Upgrade and Connection headers for WebSocket.
- **Backend receives plain HTTP from NGINX.** The app does not handle TLS; it listens on HTTP. NGINX performs TLS termination.
- **No sticky sessions assumed.** Replay and message state are DB-backed. Reconnect can hit any instance; replay service reads from DB, not memory.

## Idle & Heartbeat

- **NGINX proxy timeouts must exceed WebSocket heartbeat interval.** If NGINX closes the connection before the server’s heartbeat timeout, clients will see unexpected disconnects. Set proxy_read_timeout / proxy_send_timeout (e.g. 3600s) greater than `WS_HEARTBEAT_TIMEOUT` (ms).

## Replay & Persistence

- **Replay correctness relies on DB, not memory.** After a crash or restart, replay service fetches undelivered messages from the database. No in-memory state is assumed for correctness.
- **Message persistence is DB-first.** ACKs are emitted only after DB write. Idempotent persistence is enforced at the DB layer.
- **Production requires MongoDB message store.** The file-backed message store (`storage/message.store.js`, `_data/messages.json`) is **dev-only**. In `NODE_ENV=production`, the app will throw at startup if `MESSAGE_STORE=file` is set. In dev, file-backed store is used only when explicitly set: `MESSAGE_STORE=file`; otherwise Mongo is used.

## Deployment packaging (zip / rsync / Docker)

**Never ship `backend/storage/_data/`** (local uploads, file-backed dev stores). It is gitignored but must also be excluded from any deployment artifact:

- **Docker:** Use a `.dockerignore` at repo root that includes `backend/storage/_data` and `backend/storage/_data/**` so the build context never sends it.
- **rsync:** Use `--exclude 'backend/storage/_data/**'` (e.g. `rsync -avz --exclude 'backend/storage/_data/**' ./ user@host:/path/`).
- **Zip/tar packaging:** Exclude `backend/storage/_data` when creating the archive (e.g. `zip -r app.zip . -x '*/backend/storage/_data/*'` or equivalent).

---

## Required Production Environment

In `NODE_ENV=production`, the following must be set (no silent defaults):

- `NODE_ENV`
- `PORT`
- `JWT_SECRET`
- `DB_URI`
- `REFRESH_PEPPER` (secret, non-empty; used to harden refresh tokens)
- `COOKIE_DOMAIN`
- `CORS_ORIGIN`
- `WS_PATH`

See `.env.example` and `config/env.validate.js` for validation rules.

## Request body limit (optional)

- **`HTTP_BODY_LIMIT`** — Optional. Max size for JSON and URL-encoded request bodies (e.g. `256kb`, `512kb`, `1mb`). Default: `256kb`. Used by `express.json()` and `express.urlencoded()` in `backend/http/index.js`. This does **not** affect multipart uploads; those are limited by multer `fileSize` (e.g. 2MB for image uploads).

## Metrics (`/metrics` and `/api/metrics`)

- **Default in production:** `GET /metrics` is **not** publicly accessible. It requires the header `x-metrics-key: <METRICS_SECRET>`. Set `METRICS_SECRET` in production (required when mode is `secret`; see env validation). Scrapers and reverse proxies can authenticate with this header (no browser session).
- **Optional admin route:** If `METRICS_ENABLE_ADMIN_ROUTE=true`, `GET /api/metrics` is registered and is **admin-only** (requires auth cookie and admin role). Same response shape as `/metrics`: `{ counters, timestamp }`. Use for browser-based debugging when needed.
- **Warning:** Never set `METRICS_MODE=open` in production unless you intentionally allow public metrics. If you do, you must also set `ALLOW_PUBLIC_METRICS_IN_PROD=true` or validation will fail at startup.

## Cookies

- **Cookies MUST be:** `SameSite=None`, `Secure=true`, and scoped to the correct domain (e.g. `.example.com`). Set these attributes when issuing the JWT cookie so the browser sends it on the WebSocket handshake over HTTPS/WSS.

---

## ⚠️ Warning

**Violating any assumption in this document can break:**

- replay correctness
- delivery guarantees
- ACK ordering

Examples: shortening NGINX proxy timeouts below heartbeat can cause spurious disconnects; relying on in-memory state across restarts can cause duplicate or missing delivery; omitting required env in production can cause the server to exit at startup; wrong cookie attributes can prevent auth on WSS.
