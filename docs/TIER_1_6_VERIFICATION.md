# Tier-1.6 Verification — Executable Commands & Failure Signatures

**Single deployment path:** systemd + NGINX. No ALB. **Single authority: systemd** (no PM2 in production boot path).

---

## Boot determinism (proven chain)

If EC2 reboots at 3am, the system comes back without a human:

1. **systemd** starts after multi-user.target.
2. **ExecStartPre** runs `scripts/check-chat-backend-env.sh`: checks `/etc/chat-backend.env` exists and required vars present. Exit 0 → continue; exit 1 → **systemd does not start Node** (service fails).
3. **ExecStart** runs `node server.js`. Node receives env from systemd.
4. If Node exits (crash): **Restart=always** + **RestartSec=10** → systemd restarts Node. No PM2; systemd is the sole lifecycle authority.

**Failure escalation:**

- ExecStartPre fails (env missing) → service stays failed; no Node process. Operator fixes env and runs `systemctl start chat-backend`.
- Node crashes → systemd restarts Node after RestartSec. No zombie; deterministic restart.
- NGINX down → clients get connection error; client reconnect logic reconnects when NGINX/Node are back.

---

## Commands

### systemd (exact)

```bash
sudo systemctl daemon-reload
sudo systemctl enable chat-backend
sudo systemctl start chat-backend
sudo systemctl status chat-backend
```

### Env check (ExecStartPre) — manual run

```bash
/home/ubuntu/backend/scripts/check-chat-backend-env.sh
# Exit 0 = ok; exit 1 = fail (same as ExecStartPre)
```

### /health through NGINX

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost/health
# Expected: 200

curl -s -o /dev/null -w "%{http_code}" https://YOUR_DOMAIN/health
# Expected: 200 (with valid TLS)
```

### WSS test (browser or wscat)

```bash
wscat -c wss://YOUR_DOMAIN/ws -H "Cookie: token=YOUR_JWT"
# Expected: Connected
```

---

## Expected output

| Command | Expected |
|--------|----------|
| `sudo systemctl status chat-backend` | `active (running)` |
| `curl -s -o /dev/null -w "%{http_code}" http://localhost/health` | `200` |
| `sudo nginx -t` | `syntax is ok` |

---

## Failure signatures

### Env missing (ExecStartPre fails)

- **Symptom:** `systemctl start chat-backend` fails; status shows failed; journal shows "Missing env file" or "Missing or empty required variable: VAR".
- **Check:** `sudo cat /etc/chat-backend.env`; run `scripts/check-chat-backend-env.sh` manually.
- **Fix:** Add missing var or create file; `sudo systemctl start chat-backend`. systemd does not start Node until ExecStartPre passes.

### Node crash

- **Symptom:** Node process exits; systemd restarts it after RestartSec (10s).
- **Check:** `sudo journalctl -u chat-backend -n 100` for stack trace or "Missing required environment variable".
- **Fix:** Fix env or code; systemd will keep restarting (Restart=always).

### NGINX misconfig

- **Symptom:** 502 Bad Gateway, or WSS fails to connect.
- **Check:** `sudo nginx -t`; `curl http://127.0.0.1:3000/health` (backend up?).
- **Fix:** Fix config in `infra/nginx/chat-backend.conf`, reload: `sudo systemctl reload nginx`. NGINX is the only HTTPS/WSS entry; backend binds 127.0.0.1:PORT only.

### /health not reachable through NGINX

- **Symptom:** `curl http://localhost/health` returns 502 or connection refused.
- **Check:** Backend: `curl http://127.0.0.1:3000/health`. If 200, backend is up; NGINX upstream or config wrong. If connection refused, backend or PORT wrong.
- **Fix:** Start backend (systemd); ensure NGINX upstream `server 127.0.0.1:3000` matches PORT in env.

---

## Invariants preserved

- No message / replay / DB logic modified.
- Tier-0.7 and Tier-1 invariants unchanged.
