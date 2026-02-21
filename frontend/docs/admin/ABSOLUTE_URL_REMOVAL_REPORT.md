# Absolute URL Removal Report (2.4A)

**Goal:** Guarantee cookies attach by ensuring all requests go through the frontend origin with `credentials: 'include'`. No hardcoded `localhost:8000` / `127.0.0.1:8000` or bypass of the Vite proxy.

---

## Search results (frontend src)

- **Hardcoded backend URLs in `src`:** None. No occurrences of `http://localhost:8000`, `http://127.0.0.1:8000`, `:8000/api`, or `ws://localhost` / `ws://127.0.0.1` in `myfrontend/frontend/src`. (Docs and `vite.config.js` mention backend URLs only for proxy target or documentation.)
- **Raw `fetch` usage:** All session-authenticated calls use either `apiFetch` (lib/http.js) or same-origin URLs built from `window.location.origin` with `credentials: 'include'` (chat export, upload).

---

## Replaced / updated files

| File | Change |
|------|--------|
| **src/utils/api.js** | **getApiBase():** In browser always returns `""` (same-origin). **getWsUrl():** In browser always builds from `window.location` (same host as cookie). Env vars `VITE_API_BASE_URL` / `VITE_API_URL` / `VITE_WS_URL` are not used in browser so they cannot point to an absolute backend. |
| **src/config/api.js** | **API_BASE** set to `'/api'` only (no env). Prevents any future use of an absolute backend URL. |
| **vite.config.js** | Comment added: proxy target is the only place backend URL is allowed (server-side). |
| **docs/admin/AUTH_DEBUG_NOTES.md** | "API base URL / proxy" updated: same-origin policy, no absolute URLs in app, WS from window.location, proxy in vite.config. |

---

## Unchanged (already correct)

| File | Note |
|------|------|
| **src/lib/http.js** | `apiBaseUrl()` uses `window.location.origin` only; `credentials: 'include'` in cookie mode. No change. |
| **src/config/ws.js** | `getWsUrl()` already uses `window.location.protocol` and `window.location.host`. No change. |
| **src/features/chat/api/chat.api.js** | Export JSON/PDF use `window.location.origin` + `/api/export/...` and `credentials: 'include'`. No change. |
| **src/features/chat/api/upload.api.js** | Uses `window.location.origin` + `/api/uploads/image` and `credentials: 'include'`. No change. |
| **src/http/client.js** | Throws on load (LEGACY_HTTP_CLIENT_DISABLED). Not used. |
| **src/websocket/connection/core.js** | Throws on load (legacy stack disabled). Not used. |

---

## Vite proxy (verified)

- **vite.config.js:** `/api` → `http://localhost:${VITE_BACKEND_PORT}`, `/uploads` → same, `/ws` → `ws://localhost:${VITE_BACKEND_PORT}` with `ws: true`. Default port 8000. No code change; comment added.

---

## Validation

- After login, in Network tab every `/api` request should include the **Cookie** header.
- Hard refresh on a protected page keeps session (no redirect to `/login`).
- WebSocket connects to same origin (e.g. `ws://localhost:5173/ws` in dev) and does not trigger auth reset loops.
