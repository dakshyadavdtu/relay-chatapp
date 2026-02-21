# Room Fixes — End-to-End Verification Checklist & Regression Guards

**Phases:** 1 = Sidebar preview, 2 = ROOM_MESSAGE_RESPONSE dedupe, 3 = Unread gate, 4 = Stable keys, 5 = Verification.  
**Manual tests require two users (A and B) in different sessions.**

---

## 1) Manual checklist (run with users A and B)

| # | Check | Steps | Passed / Failed | If failed → Phase / fix |
|---|--------|--------|------------------|--------------------------|
| **Sidebar preview** |
| 1.1 | Room preview updates when not active | B stays on another room or DM. A sends a message in room X. | — | **Phase 1.** Confirm ROOM_MESSAGE handler calls `setLastMessagePreviews` when message is new (and `roomPreviewPendingRef` is set). |
| **Unread** |
| 2.1 | +1 per message when B not in room X | B not viewing room X. A sends 1 message to room X. B’s room X unread = +1. | — | **Phase 3.** Unread only increments in “not exists” branch when `!isRoomActive && isFromOther`. Check `roomUnreadPendingRef` and `meId`/sender comparison. |
| 2.2 | No increment when B is viewing room X | B has room X open. A sends to room X. B’s room X unread does not increase. | — | **Phase 3.** Increment only when `activeConversationIdRef.current !== roomConversationId`. |
| 2.3 | Sender (A) unread never increases | A sends to room X. A’s room X unread does not increase. | — | **Phase 3.** Increment only when `String(msg.senderId) !== meId`. |
| **Missing messages** |
| 3.1 | All messages visible, correct order | A sends 5 messages rapidly to room X. B sees all 5 in order without refresh. | — | **Phase 2.** Dedupe in ROOM_MESSAGE_RESPONSE (remove optimistic when server already exists). **Phase 4.** Keys use `room:roomId:id` so no collision between different messages. |
| 3.2 | No disappearing messages / flicker | Same as 3.1; no messages vanish or flicker. | — | **Phase 2** (no duplicate entries), **Phase 4** (stable keys). |

*Fill **Passed / Failed** after running the steps. Use “—” if not run yet.*

---

## 2) Regression checks (code and behavior)

| Check | Result | Notes |
|-------|--------|--------|
| **DM chat (MESSAGE_RECEIVE)** | Unchanged | Only ROOM_MESSAGE and ROOM_MESSAGE_RESPONSE handlers were edited. `MESSAGE_RECEIVE` still handled by `mergeMessageReceiveRef.current(msg)` (ChatAdapterContext.jsx). |
| **Room vs DM keys** | Isolated | ChatWindow key: rooms use `room:${msg.roomId}:...`, DMs use `dm:${msg.messageId ?? msg.id ?? msg.clientMessageId}`. No cross-namespace collision. |
| **Group (room) paths** | Unchanged | Conversation id remains `room:<id>`. No `group-` key logic changed; rooms are `room:` only. |
| **Clear unread on room select** | Fixed | `clearUnread(chatId)` now also clears `roomUnreadCounts[normalizedId]` when `normalizedId.startsWith("room:")`, so selecting a room zeros the room unread badge. |

---

## 3) If something fails — phase and minimal fix

| Symptom | Likely phase | Smallest correction |
|---------|--------------|---------------------|
| Room preview in sidebar never updates | Phase 1 | Ensure ROOM_MESSAGE sets `roomPreviewPendingRef` in the “not exists” branch and that `setLastMessagePreviews` runs after `setMessagesByConversation` with that ref. |
| Unread +2 (or more) per message | Phase 2 or 3 | Phase 2: In ROOM_MESSAGE_RESPONSE, when `serverAlreadyExists`, only remove optimistic (no convert). Phase 3: Increment only once and only in “not exists” when `!isRoomActive && isFromOther`. |
| Sender’s unread increases | Phase 3 | Ensure `meId` is set and condition is `String(msg.senderId) !== meId` before setting `roomUnreadPendingRef`. |
| Unread doesn’t clear when selecting room | clearUnread | Already fixed: `clearUnread` clears `roomUnreadCounts` for `room:` ids. If still wrong, confirm Sidebar passes `room:${id}` and that `normalizedId` in `clearUnread` keeps the `room:` prefix. |
| Message disappears or duplicates in list | Phase 2 or 4 | Phase 2: Dedupe so when server message exists, optimistic is removed only. Phase 4: Keys must be stable and unique (room vs dm, roomId, message id). |
| DM messages broken or wrong count | — | Phases did not change DM path; if DM fails, look for shared state or key misuse (e.g. `msg.roomId` on DM messages). |

---

## 4) Short “Passed / Failed” summary table

After running the manual checklist, you can summarize:

| Area | 1.1 Preview | 2.1 +1 only | 2.2 Viewing no +1 | 2.3 Sender no +1 | 3.1 All msgs | 3.2 No flicker | Clear unread |
|------|-------------|-------------|-------------------|------------------|--------------|----------------|--------------|
| **Result** | — | — | — | — | — | — | Pass (code fix) |

*(Fill with Passed/Failed after testing.)*

---

## 5) Code references (no edits needed for verification)

- **Phase 1:** `ChatAdapterContext.jsx` — ROOM_MESSAGE: `roomPreviewPendingRef`, `setLastMessagePreviews` after `setMessagesByConversation`.
- **Phase 2:** `ChatAdapterContext.jsx` — ROOM_MESSAGE_RESPONSE: `serverAlreadyExists` → filter out optimistic; else convert.
- **Phase 3:** `ChatAdapterContext.jsx` — ROOM_MESSAGE: `roomUnreadPendingRef` set only when `!exists && !isRoomActive && isFromOther`; increment after state update.
- **Phase 4:** `ChatWindow.jsx` — message list item `key`: `room:${msg.roomId}:...` vs `dm:${...}`.
- **Clear unread:** `ChatAdapterContext.jsx` — `clearUnread`: for `normalizedId.startsWith("room:")`, `setRoomUnreadCounts(prev => ({ ...prev, [normalizedId]: 0 }))`.
