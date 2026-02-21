# AWS Deployment Notes

Infra-only notes. No changes to message or replay semantics.

## EC2 Base Setup

- **AMI:** Ubuntu 22.04 LTS
- **Instance:** t2.micro or larger
- **Security group:** Allow 22 (SSH), 80 (HTTP), 443 (HTTPS). Backend listens on PORT (e.g. 3000); NGINX forwards to it.

Install on EC2:

- Node.js 20.x, npm, git
- PM2: `npm install -g pm2`

Clone repo, then:

- `npm ci` (do not commit node_modules)
- Set production env vars (see .env.example) via EC2 user data, systemd env file, or PM2 ecosystem `env_production`.

## PM2

- Start: `pm2 start ecosystem.config.js --env production`
- Persist: `pm2 save` then `pm2 startup`
- Logs: stdout; no silent failures. Process restarts on crash.

## Application Load Balancer

- **Listener:** HTTPS 443, ACM certificate
- **Target group:** HTTP to EC2 PORT (e.g. 3000)
- **Health check path:** `/health` (returns 200)
- **Idle timeout:** Set greater than `WS_HEARTBEAT_TIMEOUT` (e.g. 60s) so WebSocket connections are not closed early.

Verify: `wss://<domain>/<WS_PATH>` connects; reconnect and replay work; no duplicate messages.

## Cookie & CORS (when frontend is added)

- **CORS:** Set `Access-Control-Allow-Origin` to frontend domain; allow credentials if using cookies.
- **Cookies:** For cross-site WS auth, use `SameSite=None; Secure=true` and set `Domain` to match (e.g. `.example.com`). JWT cookie name is `JWT_COOKIE_NAME` (default `token`).

Configure at NGINX or in app when adding HTTP API; do not change message/replay logic.

## Post-Deploy Verification

- Send message; observe SENT → DELIVERED.
- Force reconnect; confirm replay delivers missed messages exactly once.
- Run `node tests/ack-drop.test.js` (with NODE_ENV not production, or set all required prod vars) to confirm: one DB row, no duplicate delivery.
