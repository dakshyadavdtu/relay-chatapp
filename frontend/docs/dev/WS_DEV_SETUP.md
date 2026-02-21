# WebSocket dev setup (B1 — WS readiness)

## DEV PORT CONTRACT

For WebSocket readiness in dev, **the backend must listen on the same port that the frontend proxy uses**.

- **Frontend (Vite):** Proxies `/api` and `/ws` to `http://localhost:${VITE_BACKEND_PORT}`. Default when unset: **8000**.
- **Backend:** Listens on `PORT`. In dev, default is **8000** (so it matches Vite without config). In production default is 3001 (`backend/config/constants.js`).

**Default dev alignment (no .env needed)**

1. Backend: run with `NODE_ENV=development` (or leave unset). It will default to `PORT=8000`.
2. Frontend: do not set `VITE_BACKEND_PORT`; it defaults to 8000. Start with `npm run dev`.
3. Ports match; start backend then frontend.

**Override:** To run backend on 3001, set `PORT=3001` and set frontend `VITE_BACKEND_PORT=3001`.

**Startup logs (B1)**

- **Backend:** On listen, logs `B1 DEV: PORT=... | ws path=/ws | ALLOW_BYPASS_AUTH=...`. Ensure PORT matches frontend.
- **Frontend:** Vite logs `[vite-proxy] B1` with `VITE_BACKEND_PORT`, `bypassEnabled`. Ensure backend PORT matches and bypass matches backend ALLOW_BYPASS_AUTH.
- In the browser: DevTools → Network → WS → open `/ws`. Frames should show outbound `{"type":"HELLO","version":1}` then inbound `{"type":"HELLO_ACK","version":1}`. Console should show `[wsClient] READY TRUE via HELLO_ACK`.

If the ports differ, the upgrade never reaches the backend (or goes to the wrong process) and you will not get HELLO_ACK.
