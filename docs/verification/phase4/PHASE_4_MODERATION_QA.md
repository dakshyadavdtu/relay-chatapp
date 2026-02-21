# Phase 4 — Moderation QA Checklist

Quick developer checklist to verify Phase 4 (reports + admin moderation) end-to-end. No new features; verification only.

---

## Prerequisites

- Backend running (e.g. `node server.js` or `npm run dev` from `backend/`)
- Frontend running (e.g. `npm run dev` from `myfrontend/frontend/`)
- At least one **admin** user (e.g. root admin via env or promote a user to ADMIN)

---

## 1) Create 2 normal users + 1 admin

- [ ] Register or create **User A** (normal user).
- [ ] Register or create **User B** (normal user).
- [ ] Ensure one **Admin** exists (e.g. log in as root admin, or promote User B to ADMIN via `/admin/users` or backend/DB).

---

## 2) Send a few messages in direct chat and room chat

- [ ] Log in as **User A**. Open a **direct chat** with User B; send 2–3 messages.
- [ ] Create or join a **room**. Send 2–3 messages in the room.
- [ ] Note one **specific message** in DM (e.g. text and approximate time) to report later.

---

## 3) Report a user

- [ ] Log in as **User A**. Open the **direct chat** with User B.
- [ ] In the chat header, click the **flag icon** (“Report user”).
- [ ] In the dialog: choose **Reason** (e.g. Harassment), optionally add **Details**.
- [ ] Click **Submit report**. Verify a **success toast** and dialog closes.
- [ ] (Optional) In DevTools Network, confirm **POST /api/reports** with body `{ targetUserId, reason, details? }`.

---

## 4) Report a specific message (ensure payload includes conversationId)

- [ ] Still as **User A**, in the same DM (or in a room), open the **message actions menu** (three dots) on a message from User B.
- [ ] Click **Report message**.
- [ ] In the dialog: choose **Reason**, optionally **Details**. Submit.
- [ ] Verify **success toast** and dialog closes.
- [ ] In DevTools Network, confirm **POST /api/reports** with body containing **messageId**, **conversationId**, **senderId**, **reason**, and optional **details**.

---

## 5) As admin: reports list and details

- [ ] Log in as **Admin**. Go to **/admin/reports** (or Admin → Reports).
- [ ] Verify the **reports list** shows the user report and the message report (e.g. date, user, priority).
- [ ] **Select the user report.** Verify:
  - **Report details** panel shows type, status, created, reason/details.
  - **Message context** shows “No message context (user report)”.
- [ ] **Select the message report.** Verify:
  - **Report details** panel shows type, conversationId, messageId, senderId, reason/details.
  - **Message context** loads (or “Loading context…” then either context messages or “Message not found…”).
  - If context loads: the **reported message** is **highlighted** and **context** lists surrounding messages (oldest → newest).

---

## 6) As admin: Warn

- [ ] With a report selected (with a **targetUserId**), click **Warn User**.
- [ ] Verify **success toast** (e.g. “User warned”).
- [ ] (Optional) Confirm **POST /api/admin/users/:id/warn** in Network.

---

## 7) As admin: Ban and verify disconnect

- [ ] With the same (or another) report selected, click **Ban User**.
- [ ] Verify **success toast** (e.g. “User banned”).
- [ ] Log in (or open another tab) as the **banned user**. Verify:
  - **Login is blocked** or session is invalid (per your backend contract).
  - If already logged in: **WebSocket disconnects** and the user is logged out or blocked from sending.

---

## 8) As admin: Resolve report

- [ ] Select any **open** report. Click **Resolve Report**.
- [ ] Verify **success toast** and the report **disappears from the queue** (list refreshes; selection clears if it was the resolved report).
- [ ] (Optional) Confirm **POST /api/admin/reports/:id/resolve** in Network.

---

## Optional: Backend unit/integration tests

From `backend/` run:

```bash
node tests/admin/admin-endpoints.test.js
```

Covers: report creation (user + message), list, resolve, GET report details (user report → message: null, context: []), 404 for unknown id, and an integration flow: create message report → GET /admin/reports → GET /admin/reports/:id with assertion that the response includes a `context` array and report.messageId.

---

## Sign-off

| Step | Done |
|------|------|
| 1. Create 2 users + 1 admin | |
| 2. Send messages in DM and room | |
| 3. Report a user | |
| 4. Report a message (payload has conversationId) | |
| 5. Admin: list + details + message context | |
| 6. Admin: Warn | |
| 7. Admin: Ban + banned user blocked/WS disconnect | |
| 8. Admin: Resolve → report leaves queue | |

*Phase 4 QA — no production behavior changes.*
