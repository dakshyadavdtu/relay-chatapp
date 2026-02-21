# AWS Deployment — Tier-1.6 Executable Runbook

**Single path:** systemd + NGINX. No ALB. **Single authority: systemd** (no PM2 in production boot path). Commands + explanations only.

> **Paths:** Nginx and systemd configs are under **`infra/legacy/nginx/`** and **`infra/legacy/systemd/`** (not under `backend/infra/`). Adjust clone path below if your repo root differs.

---

## EC2 setup commands

```bash
# Ubuntu 22.04; SSH as ubuntu
sudo apt update && sudo apt upgrade -y
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs git nginx certbot python3-certbot-nginx
```

---

## Directory layout

```
/home/ubuntu/                  # Repo root (clone here)
├── backend/                   # App root for Node
│   ├── server.js
│   └── scripts/
│       └── check-chat-backend-env.sh   # ExecStartPre env check (must be executable)
├── infra/legacy/
│   ├── systemd/chat-backend.service
│   └── nginx/chat-backend.conf
/etc/chat-backend.env          # Env file (create; do not commit)
```

---

## Env file creation

```bash
sudo nano /etc/chat-backend.env
```

Paste (replace values):

```
NODE_ENV=production
PORT=3000
JWT_SECRET=your-strong-secret-minimum-32-characters-long
DB_URI=mongodb://user:pass@host:27017/dbname
COOKIE_DOMAIN=.example.com
CORS_ORIGIN=https://app.example.com
WS_PATH=/ws
```

```bash
sudo chmod 640 /etc/chat-backend.env
sudo chown root:ubuntu /etc/chat-backend.env
```

Explanation: systemd loads this file; ExecStartPre runs check-chat-backend-env.sh — if file or any required var missing, **systemd refuses to start Node**.

---

## Clone and install

```bash
cd /home/ubuntu
git clone YOUR_REPO_URL backend
cd backend
npm ci
```

---

## Env check script (ExecStartPre)

```bash
chmod +x /home/ubuntu/backend/scripts/check-chat-backend-env.sh
/home/ubuntu/backend/scripts/check-chat-backend-env.sh
# Exit 0 = ok; exit 1 = fail (systemd will not start Node if this fails)
```

Explanation: systemd runs this before Node. Missing env → script exits 1 → systemd does not start the service.

---

## systemd enable (single authority)

```bash
sudo cp /home/ubuntu/infra/legacy/systemd/chat-backend.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable chat-backend
sudo systemctl start chat-backend
sudo systemctl status chat-backend
```

Explanation: systemd is the sole lifecycle authority. systemd starts Node (ExecStart=node server.js); systemd restarts Node on crash (Restart=always). No PM2. WorkingDirectory=/home/ubuntu/backend; EnvironmentFile=/etc/chat-backend.env; ExecStartPre enforces env.

---

## NGINX enable (only HTTPS/WSS entry)

```bash
sudo cp /home/ubuntu/infra/legacy/nginx/chat-backend.conf /etc/nginx/sites-available/chat-backend
sudo ln -sf /etc/nginx/sites-available/chat-backend /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo certbot --nginx -d your-domain.com
sudo systemctl reload nginx
sudo systemctl enable nginx
```

Explanation: NGINX is the only HTTPS/WSS entry point. Backend binds 127.0.0.1:PORT only. If NGINX dies → client reconnect logic handles it.

---

## Curl + WSS test commands

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost/health
# Expected: 200

curl -s -o /dev/null -w "%{http_code}\n" https://your-domain.com/health
# Expected: 200

curl -s http://127.0.0.1:3000/health
# Expected: 200 + body
```

WSS (browser DevTools or wscat):

```bash
wscat -c wss://your-domain.com/ws -H "Cookie: token=YOUR_JWT"
# Expected: Connected (then send HELLO per protocol)
```

---

## Reboot test (unattended boot)

```bash
sudo reboot
# After reboot:
ssh ubuntu@EC2_IP
sudo systemctl status chat-backend
curl -s -o /dev/null -w "%{http_code}\n" http://localhost/health
```

Expected: chat-backend active (running); health 200. Single authority: systemd; no PM2 in path.
