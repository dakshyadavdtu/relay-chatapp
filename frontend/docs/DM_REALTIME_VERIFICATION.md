# DM Realtime Verification (dev-only checklist)

Use this checklist to verify that DM messages appear instantly and unread counts/previews update correctly.

## Prerequisites

- Two test users (A and B), two browser tabs/windows.
- DevTools Console open on the tab where you verify behavior.

---

## 1. DM open: message appears instantly

| Step | Action | Expected |
|------|--------|----------|
| 1.1 | Tab A: Log in as User A. Tab B: Log in as User B. | Both connected. |
| 1.2 | Tab A: Open DM conversation with User B (conversation is **active**). | Chat view shows conversation. |
| 1.3 | Tab B: In DM with User A, send a message to A. | — |
| 1.4 | Tab A: Observe without refresh. | **Message appears in the thread immediately** (no refresh). |
| 1.5 | (Optional) Console on Tab A | `[WS_MERGE]` log with same `chatId` and incremented `totalMessagesInThatChat`. |

**Pass:** Message shows in real time when the DM is open.

---

## 2. DM closed: unread increments + preview updates

| Step | Action | Expected |
|------|--------|----------|
| 2.1 | Tab A: Be on a **different** screen (e.g. another DM or room, or chat list). Do **not** have the DM with User B open. | Active conversation is **not** the DM with B. |
| 2.2 | Tab B: Send a message to User A. | — |
| 2.3 | Tab A: Without opening the DM with B, check sidebar. | **Unread badge** on the DM with B increments (e.g. 1 or +1). |
| 2.4 | Tab A: Check same DM row in sidebar. | **Last message preview** and **timestamp** (last activity) update for that DM. |
| 2.5 | Tab A: Open the DM with B. | Unread clears (on read/clear logic); message is in the thread. |

**Pass:** When the DM is not open, unread count and last message preview/ordering update in the sidebar.

---

## 3. Refresh: no duplicates (dedupe by messageId)

| Step | Action | Expected |
|------|--------|----------|
| 3.1 | Tab A: Have DM with B open with at least one message from B visible. | One instance of each message. |
| 3.2 | Tab A: Refresh the page (F5 or reload). | Page reloads; conversation may reload from API + WS. |
| 3.3 | Tab A: Check the same DM thread. | **No duplicate messages** for the same `messageId`. Each message appears once. |
| 3.4 | (Optional) Console | No duplicate `[WS_MERGE]` for same `messageId` in same `chatId`; or dedupe logs if enabled. |

**Pass:** After refresh, messages are deduped by `messageId`; no double render of the same message.

---

## Where behavior is implemented

- **Unread / preview / activity when DM not open:**  
  `incrementUnread`, `setLastMessagePreview`, `updateLastActivity` on MESSAGE_RECEIVE when `activeConversationId !==` computed DM `conversationId` (ChatAdapterContext `mergeMessageReceive` and legacy path in `routeMessageEvent` + `messageHandler`).
- **Dedupe:**  
  Before `addMessage`, check `messageExistsInConversation(conversationId, message)` (by `messageId` / `clientMessageId`). Same in ChatAdapterContext via `sameMessageIdentity` and in-state dedupe.

---

## Quick reference

| Scenario | Expected |
|----------|----------|
| DM open, other user sends | Message appears instantly. |
| DM closed, other user sends | Unread +1; preview and last activity update in sidebar. |
| Refresh after messages loaded | No duplicate messages (dedupe by messageId). |
