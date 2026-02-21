# DEV-ONLY Admin Bypass

DEV-only capability to test admin UI without real auth. **Impossible to activate in production.**

## Env vars

| Var | Where | Value |
|-----|-------|-------|
| `NODE_ENV` | Backend | Must **not** be `production` |
| `ALLOW_BYPASS_AUTH` | Backend | `true` |
| `VITE_DEV_BYPASS_AUTH` | Frontend (Vite) | `true` |

### Backend (.env or shell)

```bash
NODE_ENV=development
ALLOW_BYPASS_AUTH=true
```

### Frontend (Vite)

```bash
VITE_DEV_BYPASS_AUTH=true
```

Or in `.env`:

```
VITE_DEV_BYPASS_AUTH=true
```

### Safety

- **Backend**: If `NODE_ENV === "production"`, bypass does not run even if `ALLOW_BYPASS_AUTH` is set.
- **Frontend**: `ALLOW_BYPASS_AUTH = DEV_BYPASS_AUTH && !IS_PROD`. Production builds (`import.meta.env.PROD`) never enable bypass.

## Proof checks (curl)

Backend on port 8000. Vite proxy forwards `/api` to backend.

### With bypass enabled (backend + frontend env set)

```bash
# GET /api/me returns 200 with role ADMIN
curl -i -H "x-dev-user: dev_admin" http://localhost:8000/api/me

# Expected: 200 OK, body {"success":true,"data":{"user":{"userId":"dev_admin","username":"dev_admin","role":"ADMIN",...},"capabilities":[...]}}
```

```bash
# GET /api/admin/dashboard returns 200
curl -i -H "x-dev-user: dev_admin" http://localhost:8000/api/admin/dashboard

# Expected: 200 OK, body {"success":true,"data":{...}}
```

```bash
# GET /api/admin/users returns 200
curl -i -H "x-dev-user: dev_admin" http://localhost:8000/api/admin/users

# Expected: 200 OK, body {"success":true,"data":{"users":[...],"nextCursor":null,"total":N}}
```

### With bypass disabled

```bash
# Same calls return 401 without login (no x-dev-user or wrong header)
curl -i http://localhost:8000/api/me
# Expected: 401 Unauthorized

curl -i http://localhost:8000/api/admin/dashboard
# Expected: 401 Unauthorized
```

### dev_user (non-admin) gets 403 on admin routes

```bash
curl -i -H "x-dev-user: dev_user" http://localhost:8000/api/admin/dashboard
# Expected: 403 Forbidden (dev_user has role USER, not ADMIN)
```

## Browser verification

1. Set `VITE_DEV_BYPASS_AUTH=true` and restart Vite.
2. Backend: `NODE_ENV=development ALLOW_BYPASS_AUTH=true`.
3. Open http://localhost:5173/admin.
4. Dashboard and users should render with real data (no login).
5. DevTools Network: requests include header `x-dev-user: dev_admin`.
6. WebSocket URL: `ws://localhost:5173/ws?dev_user=dev_admin`.
