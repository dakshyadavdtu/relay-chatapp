# PHASE 5 — Verification (2 Users A/B)

**Mode:** Code-review verification. Live 2-user testing must be run to confirm Pass/Fail in practice.

**Checklist:** Receiver old messages, pagination, realtime+history, unread, sidebar preview.

---

## 1) Receiver sees old messages without refresh

**Steps:** B opens room X for the first time in a new session → sees prior messages immediately (first page).

| Result   | Notes |
|----------|--------|
| **Pass** (by code review) | ChatWindow.jsx: when `conversationIdNormalized` is set (e.g. `room:X`) and `messagesByConversation[conversationIdNormalized] === undefined`, a useEffect calls `loadMessages(conversationIdNormalized, { limit: 50 })`. For rooms, the same effect only runs when `roomsById[roomId]` exists (line ~199–201). loadMessages (Phase 1/2) fetches history for `room:X` via getHistoryApi and merges into `messagesByConversation["room:X"]`. So first page loads on open. **Phase responsible:** 1 (room history frontend), 2 (backend). |

**If this fails in live test:** Ensure B has room X in sidebar (roomsById populated) before opening; confirm GET history API supports `chatId=room:<id>` and returns messages.

---

## 2) Pagination

**Steps:** B scrolls / taps “load more” → older messages appear; no duplicates.

| Result   | Notes |
|----------|--------|
| **Pass** (by code review) | ChatWindow shows “Load older” when `canPaginateHistory && (cursor?.hasMore \|\| isLoadingHistory)` with `canPaginateHistory = conversationIdNormalized?.startsWith("direct:") \|\| conversationIdNormalized?.startsWith("room:")` (Phase 3). Click calls `loadMessages(conversationIdNormalized, { limit: 50, beforeId: cursor?.nextCursor })`. Cursor is `historyCursor[conversationIdNormalized]`. Phase 4 merge uses a stable dedupe key `roomMessageId \|\| messageId \|\| id` and prefers existing message when key exists, so duplicates cannot appear after merge. **Phase responsible:** 3 (load more for rooms), 4 (dedupe + order). |

**If this fails in live test:** Check backend returns `nextCursor`/`hasMore` for room history; confirm no duplicate `roomMessageId` in API response.

---

## 3) Realtime + history

**Steps:** While B is scrolling history, A sends new message → it appears once, at correct position.

| Result   | Notes |
|----------|--------|
| **Pass** (by code review) | ROOM_MESSAGE adds the new message to `messagesByConversation[roomConversationId]` only when it does not already exist (exists check by roomMessageId/id). ROOM_MESSAGE_RESPONSE dedupes: if server message already present (from broadcast), only the optimistic message is removed (Phase 2). Phase 4 merge prefers existing by key, so a message present from realtime is kept when history merge runs. New message has a new key, so it is added once. Messages are sorted by `createdAt ?? timestamp ?? 0` ascending, so the new message appears at the latest position. **Phase responsible:** 2 (response dedupe), 4 (merge prefers existing, stable sort). |

**If this fails in live test:** Confirm ROOM_MESSAGE and ROOM_MESSAGE_RESPONSE both use same `roomConversationId` and that list is re-sorted after merge (Phase 4 sort runs in loadMessages only; realtime append is already at end).

---

## 4) Unread correctness

**Steps:**  
- B not in room X → unread +1 per new msg (not +2).  
- B in room X → unread does not increase.  
- A never increments own unread.

| Result   | Notes |
|----------|--------|
| **Pass** (by code review) | Unread is incremented only in the ROOM_MESSAGE “not exists” branch: `roomUnreadPendingRef.current = roomConversationId` only when `!isRoomActive && isFromOther` (lines ~1085–1089). After setState, a single flush does `setRoomUnreadCounts(..., [cid]: (prev[cid] \|\| 0) + 1)` (lines ~1135–1138). So: (1) When B is not in room X, one new message sets the ref once and flush adds +1. (2) When B is in room X, `isActive` is true so ref is never set → no increment. (3) For sender A, `isFromOther = (senderId !== meId)` is false, so ref is never set → A’s unread never incremented. ROOM_MESSAGE_RESPONSE does not touch unread. **Phase responsible:** 2 (dedupe avoids double insert), 3 (unread gate). |

**If this fails in live test:** Phase 3: verify `activeConversationIdRef.current` and `getAuthState().user?.id` are correct when ROOM_MESSAGE runs; Phase 2: ensure no duplicate list entry (which could cause double UI unread logic elsewhere).

---

## 5) Sidebar preview

**Steps:** B not in room X → preview updates instantly on new msg.

| Result   | Notes |
|----------|--------|
| **Pass** (by code review) | In ROOM_MESSAGE “not exists” branch, `roomPreviewPendingRef.current` is set to `{ roomConversationId, content, timestamp, senderId }` (lines ~1104–1108). After `setMessagesByConversation`, a flush runs and `setLastMessagePreviews` is called with that pending data (lines ~1123–1133). Sidebar reads `lastMessagePreviews[room:X]` for the room row, so it updates as soon as the new message is processed. **Phase responsible:** 1 (sidebar preview). |

**If this fails in live test:** Confirm Sidebar uses `lastMessagePreviews` for room rows and that the key is `room:<id>`.

---

## Deliverable summary

| # | Item                          | Pass / Fail (code review) | Responsible phase(s) if fail      |
|---|-------------------------------|---------------------------|------------------------------------|
| 1 | Receiver old messages, no refresh | **Pass**                  | 1, 2                               |
| 2 | Pagination, no duplicates     | **Pass**                  | 3, 4                               |
| 3 | Realtime + history, once, correct position | **Pass** | 2, 4                               |
| 4 | Unread correctness            | **Pass**                  | 2, 3                               |
| 5 | Sidebar preview               | **Pass**                  | 1                                  |

**Conclusion:** All five items pass by code review. No code changes applied in this phase.

**Next step:** Run the same checklist with two real users (A and B). If any item fails in practice, use the “If this fails in live test” and phase references above to apply the smallest targeted fix for that phase.
