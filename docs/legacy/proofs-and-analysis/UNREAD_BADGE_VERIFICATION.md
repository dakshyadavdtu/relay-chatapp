# Unread badge — manual verification

Lightweight checklist to confirm unread count and read-cursor persistence behave correctly.

---

## Prerequisites

- Backend running (e.g. `npm run dev` in `backend/`)
- Frontend running (e.g. `npm run dev` in `myfrontend/frontend/`)
- Two users (e.g. two browser profiles or two devices) so you can send DMs and see unread

---

## 1. Open DM, read all, refresh → unread stays 0

**Steps**

1. As **User A**, open the app and go to the chat list.
2. As **User B**, send at least one message to User A.
3. As **User A**, confirm the DM with B shows **unread badge > 0** (e.g. `1`).
4. As **User A**, open the DM with B (read the thread).
5. Confirm the badge for that DM goes to **0**.
6. **Refresh the page** (F5 or reload).
7. Open the chat list again.

**Expected**

- After step 5: badge = **0**.
- After step 7: badge still **0** (cursor persisted; GET /api/chats returns 0).

**Dev logs (optional)**

- **Frontend (browser console):**  
  `[readCursor] persisted` with `{ chatId: "direct:...", messageId: "..." }`.
- **Backend (terminal):**  
  `[readCursor] upserted` with `{ userId, chatId, messageId, ts }` (from either POST /read or WS MESSAGE_READ).

---

## 2. New message → unread increments

**Steps**

1. As **User A**, stay on the chat list (or another screen) so the DM with B is **not** open.
2. As **User B**, send a new message to User A.
3. As **User A**, look at the chat list (without refreshing).

**Expected**

- The DM with B shows **unread badge ≥ 1** (incremented).

---

## 3. Read again, refresh → unread stable at 0

**Steps**

1. As **User A**, open the DM with B again (read the latest message).
2. Confirm badge for that DM is **0**.
3. **Refresh the page**.
4. Check the chat list again.

**Expected**

- Badge remains **0** after refresh (cursor persisted again; stable).

---

## Quick script (curl) — backend only

If you only want to check that **POST /read** updates the cursor and **GET /api/chats** reflects it:

```bash
# From backend directory, with server running and two users A, B created:

# 1. Login as A, get chats (note unreadCount for direct chat with B)
curl -s -b cookies.txt -c cookies.txt -X POST http://localhost:8000/api/login -H "Content-Type: application/json" -d '{"username":"userA","password":"..."}'
curl -s -b cookies.txt http://localhost:8000/api/chats | jq '.data.chats[] | { chatId, unreadCount }'

# 2. POST read with lastReadMessageId = latest message id in that chat
curl -s -b cookies.txt -X POST "http://localhost:8000/api/chats/direct:userIdA:userIdB/read" \
  -H "Content-Type: application/json" -d '{"lastReadMessageId":"msg_xxx"}'

# 3. GET chats again — unreadCount for that chat should be 0
curl -s -b cookies.txt http://localhost:8000/api/chats | jq '.data.chats[] | { chatId, unreadCount }'
```

**Expected:** After step 2, the chat in step 3 has `unreadCount: 0`.

---

## Automated test

Backend regression test (no manual steps):

```bash
cd backend
npm run test:read-cursor
```

Expected: `PASS: Read cursor persistence — POST /read then GET /api/chats returns unreadCount 0`
