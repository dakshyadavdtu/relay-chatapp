# Smoke Test — Step-by-Step

**Goal:** Reproducible baseline checks without changing runtime behavior.

**Project layout:**

- **Repo root** — directory containing `backend/`, `myfrontend/`, and `docs/`.
- **backend/** — Node.js server (HTTP + WebSocket).
- **myfrontend/frontend/** — React + Vite app.

Use [../../config/ENV_TEMPLATE.md](../../config/ENV_TEMPLATE.md) for required env vars. Set `ROOT_ADMIN_EMAIL` to your root admin email for admin flows.

---

## 1. Install dependencies

**Backend:**

```bash
cd backend
npm install
```

**Frontend:**

```bash
cd myfrontend/frontend
npm install
```

From repo root, both in one go:

```bash
cd backend && npm install && cd ../myfrontend/frontend && npm install
```

---

## 2. Start backend then frontend

**Terminal 1 — Backend:**

Set at least `DB_URI` and `JWT_SECRET`. Optional: `ROOT_ADMIN_EMAIL=<your-root-admin@example.com>` for root admin.

```bash
cd backend
# Example (dev): use your MongoDB Atlas URI or local DB with ALLOW_LOCAL_DB=true
export DB_URI="your_mongodb_uri"
export JWT_SECRET="your_jwt_secret"
# Optional: PORT=8000 (default in dev)
npm run dev
```

Expect server listening on port 8000 (or your `PORT`). Leave this running.

**Terminal 2 — Frontend:**

```bash
cd myfrontend/frontend
# Optional: VITE_BACKEND_PORT=8000 (default)
npm run dev
```

Expect Vite dev server (e.g. http://localhost:5173). Leave running.

---

## 3. Register / login

1. Open the app in the browser (e.g. http://localhost:5173).
2. Register a user (username + password; email optional). For root admin, register with the same email as `ROOT_ADMIN_EMAIL` set on the backend.
3. Log in with that user (or use an existing user).

---

## 4. Verify GET /api/me

- **In browser:** After login, the app typically calls `/api/me`; the UI should show the logged-in user.
- **With curl (same origin not required in dev):** Use the cookie jar from a login request, or in dev-token mode use the Bearer token:

```bash
# Cookie-based (replace with your cookie after login)
curl -s -b cookies.txt http://localhost:8000/api/me
# Expect 200 and JSON with user id, username, role, etc.
```

---

## 5. Verify WebSocket HELLO → HELLO_ACK

1. Stay logged in and ensure the chat/WS UI is loaded (so the client connects to `/ws`).
2. Open DevTools → Network → WS. Select the WebSocket connection to `/ws`.
3. In the Frames (or Messages) tab, confirm:
   - Client sends a HELLO (JSON with `type: "HELLO"` or similar).
   - Server sends HELLO_ACK (e.g. `type: "HELLO_ACK"`).
4. Alternatively, check the frontend console for a log indicating WS ready / HELLO_ACK received (if present).

---

## 6. Send DM message and confirm ACK + persistence

1. Open a direct chat with another user (or use two browsers/tabs as two users).
2. Send a text message from user A to user B.
3. **Confirm ACK:** Sender should see the message appear with a “sent” (or similar) state; in WS Frames you should see a MESSAGE_ACK from server.
4. **Confirm persistence:** Either refresh and see the message still in history, or call the chat history API for that chat and confirm the message is present.

---

## 7. Create / join room and send room message

1. Create a new room (or group) from the UI (e.g. “New group”, add name and members).
2. Confirm the room appears in the sidebar.
3. Send a message in the room.
4. Confirm the message appears in the room thread and, if possible, that the other member sees it (or refresh and see it in history).

---

## 8. Export JSON and PDF (DM and room)

**Chat ID format:** For a direct chat, `chatId` is typically the canonical direct-chat id (e.g. `direct:userId1:userId2` or as returned by `GET /api/chats`). For a room, it may be `room:roomId`. Use the same format the backend expects (see `export.controller` / `validateChatOwnership`).

**With cookie auth (replace `YOUR_COOKIE` or use a cookie file):**

- **DM export JSON:**

```bash
curl -s -b cookies.txt -o dm.json "http://localhost:8000/api/export/chat/DM_CHAT_ID.json"
# Replace DM_CHAT_ID with actual id, e.g. from GET /api/chats
# Expect 200 and JSON file.
```

- **DM export PDF:**

```bash
curl -s -b cookies.txt -o dm.pdf "http://localhost:8000/api/export/chat/DM_CHAT_ID.pdf"
```

- **Room export JSON:**

```bash
curl -s -b cookies.txt -o room.json "http://localhost:8000/api/export/chat/room:ROOM_ID.json"
```

- **Room export PDF:**

```bash
curl -s -b cookies.txt -o room.pdf "http://localhost:8000/api/export/chat/room:ROOM_ID.pdf"
```

If you don’t have a cookie file, log in via the app and use the same origin (e.g. from the frontend, the app may offer “Export” which hits these endpoints via the proxy).

---

## 9. Admin: dashboard, users list, reports list, resolve report

**Prerequisite:** Be logged in as an admin (e.g. root admin with email matching `ROOT_ADMIN_EMAIL` or a user promoted to ADMIN by root).

1. **Dashboard:** Open `/admin` (or the admin dashboard route). Confirm the dashboard loads (e.g. connection count, activity, or timeseries).
2. **Users list:** Open the admin users section. Confirm `GET /api/admin/users` returns a list of users.
3. **Reports list:** Open the reports/moderation section. Confirm `GET /api/admin/reports` returns the reports list (may be empty).
4. **Resolve report:** If there is a report, resolve it via the UI (or `POST /api/admin/reports/:id/resolve`). Confirm success (e.g. report marked resolved).

---

## 10. Admin: revoke one session, revoke all sessions

1. **Revoke one session:** In admin, open a user’s sessions (e.g. `GET /api/admin/users/:id/sessions`). Call `POST /api/admin/users/:id/sessions/:sessionId/revoke` for one session. Confirm that session is no longer valid (e.g. that client gets 401 on next request or WS closes).
2. **Revoke all sessions:** Call `POST /api/admin/users/:id/revoke-sessions` for a user. Confirm all sessions for that user are invalidated (e.g. user is logged out everywhere).

---

## 11. Admin: ban / unban and verify WS closes

1. **Ban:** As admin, ban a user (e.g. `POST /api/admin/users/:id/ban`). Confirm that user’s WebSocket is closed (backend revokes sessions and disconnects WS for that user). Optionally log in as that user in another browser and confirm they are disconnected or cannot reconnect with the same session.
2. **Unban:** Call `POST /api/admin/users/:id/unban`. Confirm the user can log in again and connect via WS (or that ban state is cleared in the users list).

---

## Validation

- Running these steps should yield **identical behavior** to before adding this doc (no API or path changes).
- No new failures: existing known issues (e.g. from Phase 0 discovery) remain as documented elsewhere; this smoke test does not fix them.

**Health check (optional):**

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:8000/health
# or
curl -s -o /dev/null -w "%{http_code}" http://localhost:8000/api/health
# Expect 200.
```

**Doctor script (from repo root):**

```bash
node scripts/doctor.js
```

This installs deps in `backend/` and `myfrontend/frontend/`, prints start commands and ports, and runs a health check against the backend. Use `node scripts/doctor.js --test` to also run backend tests and frontend verify:contract (only if stable).
