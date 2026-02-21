# Edit/Delete sync — manual test checklist

Use this checklist to verify edit and delete propagation across clients and refresh.

---

## Prerequisites

- Backend running (e.g. `PORT=8000 node server.js` or `npm run dev`).
- Two users (e.g. dev_admin and dev_user) or two browsers/tabs with different accounts.

---

## 1. DM edit appears on other side instantly

- [ ] User A opens a DM with User B.
- [ ] User A sends a message.
- [ ] User B sees the message (same or other tab/device).
- [ ] User A edits the message (Edit → change text → Save).
- [ ] User B sees the updated content and an “edited” marker without refresh.

---

## 2. DM delete appears on other side instantly

- [ ] In the same DM, User A deletes the message (Delete from menu).
- [ ] User B sees “This message was deleted” (or equivalent) without refresh.

---

## 3. Refresh both sides — state preserved

- [ ] User A refreshes the page. Conversation loads from history.
- [ ] Edited message still shows the edited content and “edited”.
- [ ] Deleted message still shows as deleted.
- [ ] User B refreshes. Same: edited/deleted state matches.

---

## 4. Multi-tab same user — both tabs update

- [ ] Open the same DM in two tabs as User B (or two tabs as User A).
- [ ] From another client, User A (or B) edits a message.
- [ ] Both tabs show the edit without refresh.
- [ ] From the other client, delete the message.
- [ ] Both tabs show the message as deleted without refresh.

---

## 5. Quick edit then refresh

- [ ] User A edits a message and immediately refreshes (before or just after ACK).
- [ ] After load, the message shows the edited content (no revert to old text).

---

## 6. Reconnect / race

- [ ] While offline or with DevTools throttling, User A edits or deletes.
- [ ] After reconnect, state syncs: other client and post-refresh show correct edit/delete.

---

## Smoke test (backend)

From repo root:

```bash
cd backend
PORT=8000 node scripts/ws-edit-delete-smoke.js
```

Requires two users (env: `SENDER_USER`, `SENDER_PASS`, `RECIPIENT_USER`, `RECIPIENT_PASS`; defaults: dev_admin, dev_user). Exit code 0 means A sent message → A edited → B received MESSAGE_MUTATION edit → A deleted → B received MESSAGE_MUTATION delete.
