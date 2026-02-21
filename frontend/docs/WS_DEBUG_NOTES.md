# WebSocket Debug Notes

## Configuration Summary

| Layer | Path / Setting | Notes |
|-------|----------------|-------|
| **Frontend WS URL** | `ws://${window.location.host}/ws` | Same-origin; in dev: `ws://localhost:5173/ws` |
| **Vite proxy** | `/ws` → `ws://localhost:${VITE_BACKEND_PORT}` | `ws: true`, `changeOrigin: true`, `secure: false` |
| **Backend WS handler** | `/ws` | `attachWebSocketServer(server, { path: '/ws' })` |
| **Auth** | Cookie (JWT) | WS upgrade requires valid session cookie; same-origin sends it |

## Enable/Disable WS in Dev

**To stop ECONNRESET spam** when backend WS is not running:

1. Set in `.env` or `.env.local`:
   ```
   VITE_ENABLE_WS=false
   ```
2. Or leave `VITE_ENABLE_WS` unset (default: WS not attempted).

**To enable WS** when backend is running:

1. Set in `.env` or `.env.local`:
   ```
   VITE_ENABLE_WS=true
   VITE_BACKEND_PORT=8000
   ```
2. Ensure backend is running on port 8000 (or `VITE_BACKEND_PORT`).
3. Restart Vite dev server (`npm run dev`).

## Flow

1. Frontend connects to `ws://localhost:5173/ws` (same-origin).
2. Vite proxies upgrade to `ws://localhost:8000/ws`.
3. Backend accepts upgrade on path `/ws` if JWT cookie is valid.
4. If backend is down or rejects, Vite logs `ECONNRESET`; frontend retries with backoff.

## Debugging ECONNRESET

- **Backend not running**: Start backend on port 8000, or set `VITE_ENABLE_WS=false`.
- **Path mismatch**: All layers must use `/ws` (no rewrite).
- **Auth failure**: Ensure user is logged in and cookie is sent (same-origin).
- **Port mismatch**: `VITE_BACKEND_PORT` must match backend `PORT`.
