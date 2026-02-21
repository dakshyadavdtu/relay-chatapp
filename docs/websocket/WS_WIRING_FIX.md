# Chat WebSocket Wiring Fix

## Verification (Steps 1–5)

### 1) Browser DevTools – WS URL and status
- **URL the chat client uses:** `ws://localhost:5173/ws` (when frontend runs on 5173). Printed once to console as `[ws] connecting to ws://localhost:5173/ws`.
- **101 vs fail:** With the fix, the upgrade returns **101 Switching Protocols**. Without the fix, no WebSocket is attempted (see root cause).

### 2) Frontend – WS URL construction
- **Location:** `myfrontend/frontend/src/transport/wsClient.js`
- **Logic:** `getWsUrl(wsPath)` uses `window.location.protocol` and `window.location.host`; path is `DEFAULT_WS_PATH = "/ws"`. No env var for URL; URL is same-origin so cookies are sent.
- **One-time log:** On first `connect()`, `console.log("[ws] connecting to", url)` runs once.

### 3) Backend – WS server and auth
- **Mount:** `server.js` creates `http.createServer(app)` and calls `attachWebSocketServer(server)`. In `backend/websocket/index.js`, the server listens for `upgrade` and handles only when `pathname === path` (default `path = '/ws'`).
- **Auth on upgrade:** `backend/websocket/connection/wsServer.js` – `handleUpgrade()` reads **cookie** only: `getCookie(cookieHeader, JWT_COOKIE_NAME)` (default `token`). No query or header token. Verifies JWT, then `authSessionStore.getSession(sessionId)`; if session missing/revoked or userId mismatch → 401. Expected: **cookie-based auth** (JWT in httpOnly cookie).

### 4) Vite proxy
- **Config:** `myfrontend/frontend/vite.config.js`
- **/ws:** `target: ws://localhost:${VITE_BACKEND_PORT}`, `ws: true`, `changeOrigin: true`, `secure: false`. WebSocket upgrades are proxied to the backend port. No extra header config needed; same-origin request to 5173 includes cookies, and the proxy forwards the request (including Cookie) to the backend.

### 5) Run and confirm
- **Backend:** `cd backend && node server.js` (or `npm start`) – listen on PORT (default 8000). Ensure `VITE_BACKEND_PORT=8000` in frontend .env (or match your PORT).
- **Frontend:** `cd myfrontend/frontend && npm run dev` – ensure `VITE_ENABLE_WS=true` in `.env`.
- **Then:** Open /chat (logged in). In DevTools:
  - Network → WS → one connection to `/ws` → status **101 Switching Protocols**.
  - Console → `[ws] connecting to ws://localhost:5173/ws` (once).
- **Backend logs:** `WebSocketServer connection_established` (or equivalent) when a client connects.
- **Admin:** `GET /api/admin/dashboard` (as admin) → `onlineUsers` / connections **> 0** when at least one chat client is connected.

---

## Single root cause

**The frontend never called `wsClient.connect()` because `VITE_ENABLE_WS` was not `'true'`.**

- In `ChatAdapterContext.jsx`, the effect that starts the WebSocket runs only when `import.meta.env.VITE_ENABLE_WS === 'true'`. If the env var is unset or false, the effect returns before `wsClient.connect()`, so no WebSocket is opened, messages only queue (no real-time path), and the admin dashboard sees 0 connections.
- No backend or proxy bug: backend path `/ws` and cookie auth were correct; Vite proxy already had `ws: true` for `/ws`.

---

## Exact code change that fixed it (diff)

### 1) Enable WebSocket in env (fix)

**File: `myfrontend/frontend/.env`**  
Add (or set) so the chat actually connects:

```diff
 # Backend port for Vite proxy (/api + /ws).
 # Must match the port your backend listens on (e.g. PORT env).
 VITE_BACKEND_PORT=8000
 VITE_DEV_SESSION_KEY=supersecret
+
+# Enable WebSocket so chat connects and admin dashboard shows connections.
+VITE_ENABLE_WS=true
```

**File: `myfrontend/frontend/.env.example`**  
Default for new clones:

```diff
-# Enable WebSocket in dev. Set to "true" only when backend WS is running to avoid ECONNRESET spam.
-# When false or unset, frontend skips wsClient.connect(); chat works via HTTP/API.
-VITE_ENABLE_WS=false
+# Enable WebSocket in dev. Set to "true" when backend is running so chat connects and admin sees connections.
+# When false or unset, frontend skips wsClient.connect(); messages queue and admin shows 0 connections.
+VITE_ENABLE_WS=true
```

### 2) One-time console log of WS URL (diagnostic)

**File: `myfrontend/frontend/src/transport/wsClient.js`**

```diff
 const DEFAULT_WS_PATH = "/ws";
 const PING_INTERVAL_MS = 30000;
+/** One-time log of WS URL for devtools (step 2). */
+let _wsUrlLoggedOnce = false;
 ...
   const url = getWsUrl(wsPath);
   if (!url) return;
+  if (!_wsUrlLoggedOnce) {
+    _wsUrlLoggedOnce = true;
+    console.log("[ws] connecting to", url);
+  }
   _wsHandshakeLogCount = 0;
```

### 3) One-time log when WS is skipped (diagnostic)

**File: `myfrontend/frontend/src/features/chat/adapters/ChatAdapterContext.jsx`**

```diff
-    if (import.meta.env.VITE_ENABLE_WS !== 'true') return;
+    if (import.meta.env.VITE_ENABLE_WS !== 'true') {
+      if (typeof window !== 'undefined' && !window.__wsGateLogged) {
+        window.__wsGateLogged = true;
+        console.log("[ws] skipped: set VITE_ENABLE_WS=true in .env to connect (backend must be running)");
+      }
+      return;
+    }
     wsClient.connect();
```

---

## Summary

| Item | Result |
|------|--------|
| **Root cause** | `VITE_ENABLE_WS` was not `'true'`, so `wsClient.connect()` was never called. |
| **Fix** | Set `VITE_ENABLE_WS=true` in `.env` (and `.env.example`). |
| **WS URL** | `ws://localhost:<vite-port>/ws` (e.g. `ws://localhost:5173/ws` in dev); printed once in console. |
| **Backend path** | `/ws`; auth via JWT cookie (`JWT_COOKIE_NAME`, default `token`). |
| **Proxy** | Vite `/ws` → `ws://localhost:VITE_BACKEND_PORT` with `ws: true`. |
| **Admin UI** | Not changed; only wiring/config. |
