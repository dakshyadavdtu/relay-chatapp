# IP normalization — terminal verification

Session IPs are normalized at **read** and **write** in the session store so the UI shows `127.0.0.1` in dev (not `::1` / `::ffff:127.0.0.1`) and the first client IP behind a proxy.

## 1. Mongo: latest session IP (raw vs normalized)

From **backend** directory (requires `DB_URI` in env):

```bash
node scripts/print_latest_session_ip.js --userId <yourUserId>
```

With email lookup:

```bash
node scripts/print_latest_session_ip.js --email your@email.com
```

Expected in dev: `normalized` = `"127.0.0.1"` even if `raw doc.ip` was `"::1"` or `"::ffff:127.0.0.1"`.

## 2. API: session IP in responses

With backend running and a valid auth cookie (login first):

```bash
# Current user's sessions (each session has normalized ip)
curl -s -b cookies.txt http://localhost:8000/api/sessions/active | jq '.data.sessions[0] | { sessionId, ip }'

# Admin: user list with lastKnownIp (normalized)
curl -s -H "Authorization: Bearer <token>" http://localhost:8000/api/admin/users | jq '.[0] | { id, email, lastKnownIp }'
```

If your API exposes `lastKnownIp` on `GET /api/me`, you can also:

```bash
curl -s -b cookies.txt http://localhost:8000/api/me | jq '.lastKnownIp // .user.lastKnownIp // .data.user.lastKnownIp'
```

## 3. Optional: migrate existing session IPs in DB

To normalize already-stored IPs (e.g. `::1` → `127.0.0.1`) in the database, run once:

```bash
node scripts/migrate_session_ips.js
```

Do **not** run automatically; run manually when needed.
