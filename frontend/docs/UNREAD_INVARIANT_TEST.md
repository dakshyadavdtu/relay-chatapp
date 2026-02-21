# Unread invariant — dev test checklist

**Invariant:** For the currently open conversation (DM or group), `unreadCount` is always 0. Unread never goes negative; each message is counted at most once per conversation.

All tests below must pass.

---

## 1. Open DM A, receive messages → unread stays 0 always

| Step | Action | Expected |
|------|--------|----------|
| 1.1 | User A: Open DM with User B (conversation is active). | Unread badge for that DM = 0. |
| 1.2 | User B: Send several messages to A. | On A’s client: unread for that DM **stays 0** (no increment while viewing). |
| 1.3 | (Optional) Check backend/WS. | Mark-read (WS/HTTP) sent for that conversation so other devices stay in sync. |

**Pass:** Unread for the open DM never increases while the conversation is open.

---

## 2. Open Group X, receive messages → unread stays 0 always

| Step | Action | Expected |
|------|--------|----------|
| 2.1 | User A: Open group/room X (conversation is active). | Unread badge for that room = 0. |
| 2.2 | Another member: Send several messages in room X. | On A’s client: unread for room X **stays 0**. |
| 2.3 | Repeat with different rooms. | Same behavior. |

**Pass:** Unread for the open room never increases while that room is open.

---

## 3. Navigate away, receive message → unread increments

| Step | Action | Expected |
|------|--------|----------|
| 3.1 | User A: Be in a different conversation (or list). Do **not** have DM with B or room X open. | — |
| 3.2 | User B: Send a message to A (DM). | A’s sidebar: unread for DM with B **increments** (e.g. +1). |
| 3.3 | Someone: Send a message in room X. | A’s sidebar: unread for room X **increments**. |
| 3.4 | A: Open that DM or room. | Unread clears to 0 for that conversation. |

**Pass:** When the conversation is not open, unread increments; when opened, it goes to 0.

---

## 4. Refresh while inside conversation → unread remains 0 for that active one

| Step | Action | Expected |
|------|--------|----------|
| 4.1 | User A: Open DM with B (or room X). | Unread = 0. |
| 4.2 | A: Refresh the page (F5 / reload). | Page reloads; same conversation is restored (e.g. from localStorage). |
| 4.3 | After load: Check sidebar unread for that conversation. | **Unread remains 0** for the active conversation (not overwritten by API). |

**Pass:** After refresh, the active conversation’s unread is still 0.

---

## 5. New message arrives during refresh completion → still 0, no flicker

| Step | Action | Expected |
|------|--------|----------|
| 5.1 | User A: Open DM with B. | Unread = 0. |
| 5.2 | A: Refresh the page. | — |
| 5.3 | While the page is still loading (or immediately after), User B: Send a message to A. | — |
| 5.4 | A’s client: Wait for refresh to complete and conversation to restore. | Unread for that DM **stays 0**; no brief flash to 1 then back to 0. |

**Pass:** No flicker; unread stays 0 even when a message arrives during or right after refresh.

---

## Guards (implementation)

- **No negative unread:** All writes to unread (increment or set from API) clamp to `>= 0` (e.g. `Math.max(0, value)`).
- **Dedupe by messageId:** Before incrementing unread for a conversation, the client checks whether that `conversationId:messageId` has already been counted; if so, it does not increment again (avoids duplicate WS/replay double-count).

---

## Quick reference

| Scenario | Expected unread |
|----------|-----------------|
| DM open, messages arrive | 0 |
| Room open, messages arrive | 0 |
| Conversation not open, message arrives | +1 (increments) |
| Refresh while in conversation | 0 (stays 0) |
| Message during/after refresh, conversation open | 0 (no flicker) |
