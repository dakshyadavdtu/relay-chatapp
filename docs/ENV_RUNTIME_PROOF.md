# ENV Runtime Proof — Tier-1.6

**Single deployment path:** systemd + NGINX. No ALB. No PM2 in production boot path.

Runtime env is **hard-bound**: systemd MUST refuse to start if env file or any required var is missing. No silent defaults.

---

## Exact variable list

| Variable       | Required (prod) | Example value                          |
|----------------|-----------------|----------------------------------------|
| NODE_ENV       | Yes             | `production`                           |
| PORT           | Yes             | `3000`                                 |
| JWT_SECRET     | Yes (min 32 ch) | `<strong-secret>`                      |
| DB_URI         | Yes             | `mongodb://user:pass@host:27017/db`    |
| COOKIE_DOMAIN  | Yes             | `.example.com`                         |
| CORS_ORIGIN    | Yes             | `https://app.example.com`              |
| WS_PATH        | Yes             | `/ws`                                  |

---

## Example prod values (no secrets)

```bash
# /etc/chat-backend.env
# One KEY=VALUE per line, no quotes, no spaces around =
# Comments start with #

NODE_ENV=production
PORT=3000
JWT_SECRET=replace-with-strong-secret-minimum-32-characters
DB_URI=mongodb://localhost:27017/chat
COOKIE_DOMAIN=.example.com
CORS_ORIGIN=https://app.example.com
WS_PATH=/ws
```

---

## Which service reads this file

- **systemd** reads it via `EnvironmentFile=/etc/chat-backend.env` in `infra/systemd/chat-backend.service`.
- **ExecStartPre** runs `scripts/check-chat-backend-env.sh`, which sources this file and verifies all required vars exist and NODE_ENV=production. If the script exits non-zero, **systemd does not start the main process** (no Node started).
- **Node (server.js)** receives env from systemd (only after ExecStartPre passes).

---

## What happens if ONE variable is missing

1. **File missing**  
   `systemctl start chat-backend` runs ExecStartPre; script exits 1 ("Missing env file"). **systemd does not start Node.** Service state: failed. Operator must create `/etc/chat-backend.env` and `systemctl start chat-backend` again.

2. **One variable missing (e.g. PORT)**  
   ExecStartPre runs; script sources file and checks vars; finds PORT missing/empty; exits 1. **systemd does not start Node.** No Node process is started; no silent default.

3. **Empty value (e.g. PORT=)**  
   Same as missing: script treats empty as missing and exits 1. systemd refuses to start.

**Enforced behavior:** systemd refuses to start if env file or required var missing. PM2 does not run in this path; no process manager can inject defaults. Fix env, then start again.

---

## File creation (not committed)

```bash
sudo nano /etc/chat-backend.env
# Paste contents above, replace placeholder values

sudo chmod 640 /etc/chat-backend.env
sudo chown root:ubuntu /etc/chat-backend.env
```

Never commit `/etc/chat-backend.env` to git.
