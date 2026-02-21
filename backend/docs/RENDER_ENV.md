# Render — Backend environment variables (Vercel frontend)

Use these in **Render Dashboard → Your Backend Service → Environment**.

## CORS + WebSocket (Vercel preview + production)

Set these so the backend allows your Vercel frontend (production and all preview URLs) without adding each preview domain manually.

| Key | Value |
|-----|--------|
| **CORS_ORIGINS** | `https://relay-chatapp-vercel-frontend.vercel.app,https://relay-chatapp-vercel-frontend-*.vercel.app` |
| **WS_PATH** | `/ws` |

- **CORS_ORIGINS**: One line, comma-separated. First entry = production frontend; second = wildcard for all preview deploys (`*-*.vercel.app`).
- **WS_PATH**: Must match frontend `DEFAULT_WS_PATH` (e.g. `/ws`). No trailing slash.

## Cookie domain (optional)

| Key | Value |
|-----|--------|
| **COOKIE_DOMAIN** | *(leave blank)* or `relay-chatapp.onrender.com` |

- **Blank (recommended for Vercel→Render)**: Backend uses host-only cookies (no `Domain` attribute). Works correctly when frontend is on Vercel and API/WS on Render.
- **Set to `relay-chatapp.onrender.com`**: Only if you need cookies explicitly scoped to the Render host (e.g. same-site API usage). Usually leave blank.

## CORS credentials

The backend **does not** read `CORS_ALLOW_CREDENTIALS` from env. It always sends `Access-Control-Allow-Credentials: true` when the request `Origin` is in the allowlist. **Do not set** `CORS_ALLOW_CREDENTIALS` unless you add code to read it.

## Steps

1. Render Dashboard → your **Web Service** (backend).
2. **Environment** tab.
3. Add or update:
   - **CORS_ORIGINS** = `https://relay-chatapp-vercel-frontend.vercel.app,https://relay-chatapp-vercel-frontend-*.vercel.app`
   - **WS_PATH** = `/ws`
   - **COOKIE_DOMAIN** = *(empty)* or `relay-chatapp.onrender.com`
4. **Save**.
5. **Manual Deploy** → **Deploy latest commit** (or push a commit to trigger deploy).

After deploy, startup logs should show:

```
CORS allowlist: https://relay-chatapp-vercel-frontend.vercel.app, https://relay-chatapp-vercel-frontend-*.vercel.app
```
