# Auth debug notes (dev/local)

Notes to keep auth stable across hard refresh, navigation, and dev server restart so `GET /api/me` stays 200 when logged in.

---

## Dev host policy (enforced)

- **Use one host only:** In dev the app enforces **http://localhost:5173**. Opening **http://127.0.0.1:5173** shows a full-screen warning and the app does not load (no API calls). Guard: `myfrontend/frontend/src/main.jsx` (runs before React/useAuth so no `/api/me` on wrong host). This avoids auth resets from host-only cookies being stored on one host and missing on the other.
- **Do not mix localhost and 127.0.0.1 in dev. Clear cookies if you did.** Cookies are host-only (see backend `cookieConfig.js`: `COOKIE_DOMAIN` unset in dev). Logging in at `localhost:5173` stores cookies for `localhost`; opening `127.0.0.1:5173` uses a different cookie jar, so the browser does not send them and you get 401 → redirect to login.
- Frontend: `http://localhost:5173` with backend on `http://localhost:8000` (Vite proxy). Ensure the proxy target matches: default is `http://localhost:8000`.

---

## Cookie flags policy (local dev)

Backend: `backend/config/cookieConfig.js`; cookie options applied in `backend/http/controllers/auth.controller.js` (login, register, refresh) and `sessions.controller.js` (clear on logout). Auth logic semantics unchanged; only flags and env precedence.

### Dev-safe defaults

- **secure:** Must be `false` for `http://localhost` so cookies are sent over HTTP.
  - **Precedence:** `COOKIE_SECURE=true` → true; `COOKIE_SECURE=false` → false; else `secure = (NODE_ENV === 'production')`.
  - So in dev, either run with `NODE_ENV=development` (backend `npm run dev` sets this) or set `COOKIE_SECURE=false` if you run with `NODE_ENV=production` locally.
- **sameSite:** `Lax` (good for same-site). Override: `COOKIE_SAME_SITE=Lax|Strict|None`.
- **domain:** Undefined in dev (host-only). Override: `COOKIE_DOMAIN=...`. Do not set in local dev so the cookie applies to the exact host (localhost).
- **path:** `/`. Override: `COOKIE_PATH=/`.
- **httpOnly:** Always `true` in controller (not config); prevents JS access.

### Env overrides (safe precedence)

| Env | Effect | Dev recommendation |
|-----|--------|--------------------|
| `COOKIE_SECURE` | `true` / `false` | Unset or `false` for http |
| `COOKIE_SAME_SITE` | `Lax` / `Strict` / `None` | Unset (default Lax) |
| `COOKIE_DOMAIN` | Domain or empty = host-only | Unset in dev |
| `COOKIE_PATH` | Cookie path | Unset (default `/`) |

### Startup log (dev-only)

On backend start when `NODE_ENV !== 'production'`, the backend logs effective cookie config so you can confirm without guessing:

```
[cookie-config] effective { secure: false, sameSite: 'Lax', domain: '(host-only)', path: '/' }
```

Use this to verify `secure` is false and `domain` is host-only in dev.

### Validation (DevTools)

- **On login:** Response headers for `POST /api/login` include `Set-Cookie` for the session cookie (e.g. `token=...`, `refresh_token=...`) with the expected flags (e.g. `Path=/`, `SameSite=Lax`; no `Secure` in dev).
- **On refresh:** Request headers for `GET /api/me` (and any /api call after load) include `Cookie: <cookie_name>=...`. Then `GET /api/me` returns 200 and there is no redirect to `/login`.

---

## API base URL / proxy (same-origin only)

- All API calls must go through the **Vite proxy** using **relative** paths (`/api/...`) and `apiFetch` from `src/lib/http.js`. That uses `window.location.origin` so the browser sends cookies to the same origin (frontend), and the proxy forwards to the backend.
- **No absolute backend URLs in frontend code.** `src/utils/api.js` returns same-origin in the browser (getApiBase() = "", getWsUrl() from window.location). `src/config/api.js` uses `API_BASE = '/api'` only. The only place a backend URL is allowed is **vite.config.js** (proxy target). Do **not** set `VITE_API_BASE_URL` or `VITE_API_URL` to an absolute backend URL (e.g. `http://localhost:8000`) in dev; cookies would not be sent.
- **WebSocket:** Built from `window.location` in `src/config/ws.js` (getWsUrl) so WS connects to the same host that owns the cookie. Do not hardcode `ws://127.0.0.1` or `ws://localhost:8000` in the app.
- Proxy: `vite.config.js` forwards `/api` and `/ws` to `http://localhost:${VITE_BACKEND_PORT}` (default 8000).

---

## Checklist for “auth resets” / 401 after refresh

1. Using a single host (localhost **or** 127.0.0.1) for both opening the app and backend.
2. Backend started without `NODE_ENV=production` (or with `COOKIE_SECURE=false` if you must use production mode locally).
3. No `COOKIE_DOMAIN` in dev (or set only for your chosen host if needed).
4. Frontend not using an absolute API base URL; using relative `/api` and proxy.
5. After login → open `/admin` → hard refresh: `GET /api/me` should be 200 and no redirect to `/login`.
