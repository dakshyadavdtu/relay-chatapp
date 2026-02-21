# Room/Group Issues — Root Cause Analysis

**Date:** 2026-02-18  
**Mode:** Read-only analysis (no code modifications)  
**Issues:** 1) Sidebar preview stale, 2) Unread +2 instead of +1, 3) Missing messages on one side

---

## TASK A — How Rooms Are Keyed + Rendered

### A.1 ChatAdapterContext.jsx — ROOM_MESSAGE Handler

**Location:** Lines 1016-1084

**Key findings:**
- Stores messages under `messagesByConversation[roomConversationId]` where `roomConversationId = "room:" + msg.roomId`
- Normalized object fields: `{ id: msg.roomMessageId, roomMessageId: msg.roomMessageId, messageId: msg.messageId, roomId, senderId, content, createdAt: msg.timestamp, status: "delivered", messageType }`
- **Deduplication check (lines 1067-1071):** Checks if message with `roomMessageId` or `messageId` already exists before appending
- **Does NOT update `lastMessagePreviews`** — only updates `messagesByConversation` and `roomUnreadCounts`

### A.2 ChatAdapterContext.jsx — ROOM_MESSAGE_RESPONSE Handler

**Location:** Lines 1085-1126

**Key findings:**
- Uses `pendingRoomSendsRef.current[msg.roomId]` to track optimistic sends
- Finds optimistic message by matching `head.clientMessageId` with `m.id` in the list (line 1093)
- **Reconciliation (lines 1095-1109):** Updates optimistic message by changing `id` from `clientMessageId` to `msg.roomMessageId`
- **CRITICAL BUG:** Does NOT check if a message with `roomMessageId` already exists from ROOM_MESSAGE broadcast before converting
- **Does NOT update `lastMessagePreviews`**

### A.3 ChatWindow.jsx — Message List Selection

**Location:** Lines 109-129, 564-673

**Key findings:**
- `conversationId` computed as `activeConversationId ?? (activeGroupId ? "room:" + activeGroupId : ...)`
- `isActiveRoom` computed via `roomIds.includes(rawRoomId)` where `rawRoomId = conversationId.slice(5)`
- Messages selected via `useMessages(conversationIdNormalized)` which reads `messagesByConversation[conversationIdNormalized]`
- **React key (line 575):** `key={msg.messageId || msg.id || msg.clientMessageId || "msg-" + index}`
- Sort: by `createdAt` (ascending)

### A.4 Sidebar.jsx — Room Preview Source

**Location:** Lines 450-455, 483-485

**Key findings:**
- **Preview source:** `lastMessagePreviews[chatId]` (line 450)
- **Unread source:** For rooms, combines `unreadCounts[chatId] + roomUnreadCounts[chatId]` (line 419), then computes from `messagesByConversation` if available
- On room select: `setActiveConversationId("room:" + id)` and `clearUnread("room:" + id)` (lines 136-138)

---

## TASK B — Issue #1: Sidebar Preview Stale

### Root Cause

**Preview stale because Sidebar reads `lastMessagePreviews[chatId]` but ROOM_MESSAGE handler never updates `lastMessagePreviews` for non-active rooms.**

**Evidence:**
1. **Sidebar.jsx line 450:** Reads `const preview = (lastMessagePreviews || {})[chatId]`
2. **ChatAdapterContext.jsx lines 1016-1084:** ROOM_MESSAGE handler updates `messagesByConversation` and `roomUnreadCounts` but **never calls `setLastMessagePreviews`**
3. **ChatWindow.jsx lines 236-246:** `useEffect` calls `setLastMessagePreview` when `messages` change, but this **only runs for the active conversation** (`conversationIdNormalized` is the active one)
4. **Result:** When a room message arrives and the room is NOT the active conversation, `lastMessagePreviews[roomConversationId]` never updates, so sidebar shows old preview

**Functions responsible:**
- `ChatAdapterContext.jsx` lines 1016-1084: ROOM_MESSAGE handler missing `setLastMessagePreviews` call
- `ChatWindow.jsx` lines 236-246: `useEffect` only updates preview for active conversation

---

## TASK C — Issue #2: Unread +2 Instead of +1

### Root Cause

**Duplicate insert race condition: ROOM_MESSAGE_RESPONSE converts optimistic message to `roomMessageId` without checking if ROOM_MESSAGE broadcast already added a message with that `roomMessageId`, causing two logical copies and double unread increment.**

**Evidence:**

**Timeline:**
1. **Optimistic insert (ChatWindow.jsx lines 304-315):** User sends message → `addMessage(conversationIdNormalized, { id: clientMessageId, status: "sending", ... })`
2. **ROOM_MESSAGE broadcast arrives (ChatAdapterContext.jsx lines 1016-1084):**
   - Checks if message exists by `roomMessageId` or `messageId` (lines 1067-1071)
   - If optimistic message still has `id=clientMessageId`, the check fails (optimistic has no `roomMessageId` yet)
   - Appends new message with `id=roomMessageId` (line 1083)
   - **Increments unread** if room not active (line 1020)
3. **ROOM_MESSAGE_RESPONSE arrives (ChatAdapterContext.jsx lines 1085-1110):**
   - Finds optimistic message by `clientMessageId` (line 1093)
   - **Converts `id` from `clientMessageId` to `roomMessageId`** (line 1097)
   - **Does NOT check if `roomMessageId` already exists** in the list
   - Result: List now contains TWO messages with `id=roomMessageId` (one from broadcast, one from reconciliation)

**Additional unread increment:**
- ROOM_MESSAGE increments unread when `activeConversationIdRef.current !== roomConversationId` (line 1020)
- **Does NOT check if sender is the current user** — if sender views the room, unread still increments
- Should check `senderId !== meId` before incrementing

**Functions responsible:**
- `ChatAdapterContext.jsx` lines 1085-1110: ROOM_MESSAGE_RESPONSE lacks deduplication check before converting optimistic message
- `ChatAdapterContext.jsx` line 1020: ROOM_MESSAGE increments unread without checking if sender is current user

---

## TASK D — Issue #3: Missing Messages on One Side

### Root Cause

**React key collision: After ROOM_MESSAGE_RESPONSE converts optimistic message `id` to `roomMessageId`, two messages share the same `id`, causing React to render only one (last one wins).**

**Evidence:**
1. **ChatWindow.jsx line 575:** React key uses `msg.messageId || msg.id || msg.clientMessageId || index`
2. After duplicate insert race (Issue #2), list contains two messages with `id=roomMessageId`
3. React sees duplicate keys → renders only one (React behavior: same key = same element, last one replaces previous)
4. **Result:** One message disappears from UI

**Additional factors:**
- Deduplication logic in ROOM_MESSAGE handler (lines 1067-1071) checks `roomMessageId` or `messageId`, but if reconciliation happens AFTER broadcast, the check passes and duplicate is added
- Sort by `createdAt` (ascending) — if both messages have same timestamp, order is unstable

**Functions responsible:**
- `ChatWindow.jsx` line 575: React key collision when two messages share `id`
- `ChatAdapterContext.jsx` lines 1085-1110: ROOM_MESSAGE_RESPONSE should dedupe before converting

---

## MINIMAL FIX PLAN OUTLINE (NO CODE)

### Fix #1: Update Room Preview in Realtime

**Approach:**
- In `ChatAdapterContext.jsx` ROOM_MESSAGE handler (lines 1016-1084), after updating `messagesByConversation`, also call `setLastMessagePreviews` to update preview for that room
- Update preview with: `{ content: msg.content, timestamp: msg.timestamp, senderId: msg.senderId }`
- This ensures sidebar preview updates even when room is not active

**Location:** Add `setLastMessagePreviews` call after line 1083 in ROOM_MESSAGE handler

---

### Fix #2: Prevent Duplicate Insert in ROOM_MESSAGE_RESPONSE

**Approach:**
- In `ChatAdapterContext.jsx` ROOM_MESSAGE_RESPONSE handler (lines 1085-1110), before converting optimistic message:
  1. Check if message with `roomMessageId` already exists in list (from ROOM_MESSAGE broadcast)
  2. If exists: remove optimistic message (by `clientMessageId`) instead of converting
  3. If not exists: convert optimistic message as current
- This prevents duplicate insert race

**Location:** Add deduplication check before line 1095 in ROOM_MESSAGE_RESPONSE handler

---

### Fix #3: Ensure Unread Increments Exactly +1 and Sender Doesn't Increment Self

**Approach:**
- In `ChatAdapterContext.jsx` ROOM_MESSAGE handler (line 1020), before incrementing unread:
  1. Check if `senderId === meId` (current user) → do NOT increment
  2. Check if room is active → do NOT increment (already checked)
  3. Only increment if message is from other user AND room is not active
- This ensures sender never increments own unread

**Location:** Modify line 1019-1020 to add sender check: `if (activeConversationIdRef.current !== roomConversationId && senderId !== meId)`

---

## REMAINING UNKNOWNS

1. **Does ROOM_MESSAGE broadcast include `clientMessageId`?**  
   - **Check:** Inspect backend WebSocket handler for ROOM_MESSAGE broadcast — does it include `clientMessageId` field?
   - **Impact:** If yes, ROOM_MESSAGE handler could dedupe optimistic messages by `clientMessageId` before appending

2. **Does backend send ROOM_MESSAGE broadcast to sender?**  
   - **Check:** Inspect backend room message broadcast logic — does it exclude sender from broadcast?
   - **Impact:** If sender receives broadcast, ROOM_MESSAGE handler will add duplicate even if ROOM_MESSAGE_RESPONSE deduplication is fixed

3. **Is `roomMessageId` globally unique or per-room?**  
   - **Check:** Inspect backend room message ID generation — is it UUID or sequential per room?
   - **Impact:** If sequential per room, ID collision is possible if reconciliation happens out of order

**Best single check to confirm:** Inspect backend WebSocket handler for room message broadcast — verify if `clientMessageId` is included and if sender is excluded from broadcast.

---

## SUMMARY

| Issue | Root Cause | Evidence Location |
|-------|------------|-------------------|
| **#1 Preview stale** | ROOM_MESSAGE handler never updates `lastMessagePreviews` for non-active rooms | ChatAdapterContext.jsx lines 1016-1084 (missing setLastMessagePreviews call) |
| **#2 Unread +2** | ROOM_MESSAGE_RESPONSE converts optimistic message without checking if `roomMessageId` already exists from broadcast, AND sender check missing | ChatAdapterContext.jsx lines 1085-1110 (no dedupe), line 1020 (no sender check) |
| **#3 Missing messages** | React key collision when two messages share same `id` after duplicate insert | ChatWindow.jsx line 575 (key uses `id`), ChatAdapterContext.jsx lines 1085-1110 (duplicate insert) |

**All three issues are interconnected:** Issue #2 (duplicate insert) causes Issue #3 (React key collision), and Issue #1 (stale preview) is independent but related (both stem from incomplete ROOM_MESSAGE handler).
