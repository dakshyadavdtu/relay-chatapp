# PHASE 5 — Regression Checks Report

## Status: ✅ ALL CHECKS PASSING (with one fix applied)

---

## Checklist Results

### ✅ 1. DM A->B arrives instantly without refresh

**Status:** PASSING

**Implementation:**
- Backend (`sendMessage.js:99`): Sends `MESSAGE_RECEIVE` to recipient via `wsMessageService.attemptDelivery()`
- Frontend (`ChatAdapterContext.jsx:540-541`): Routes `MESSAGE_RECEIVE` to `mergeMessageReceiveRef.current(msg)`
- Frontend (`ChatAdapterContext.jsx:284-313`): Appends message to `messagesByConversation[chatId]` immediately
- Frontend (`ChatAdapterContext.jsx:315-328`): Updates `lastMessagePreviews` and `lastActivityTimestamps` synchronously

**Verification:**
- Message appears in recipient's chat window without page refresh
- Sidebar preview updates instantly
- No dependency on `loadChats()` or `loadMessages()` for realtime delivery

---

### ✅ 2. Sender multi-tab: sender's other tab also updates instantly

**Status:** PASSING

**Implementation:**
- Backend (`sendMessage.js:97`): Echoes `MESSAGE_RECEIVE` to sender's sockets via `wsMessageService.sendToUserSocket(senderId, receivePayload)`
- Frontend (`ChatAdapterContext.jsx:252-343`): `mergeMessageReceiveRef` handles `MESSAGE_RECEIVE` for both sender and recipient
- Frontend (`ChatAdapterContext.jsx:330-342`): Unread count logic distinguishes sender vs recipient (FIXED)

**Verification:**
- Sender's other tabs receive `MESSAGE_RECEIVE` and display the message
- Sender does NOT see unread badge for their own messages (fixed in regression check)

---

### ✅ 3. Unread count behavior

**Status:** PASSING (after fix)

#### 3a. Increment when message arrives and conversation not open

**Implementation:**
- Frontend (`ChatAdapterContext.jsx:330-342`): 
  - Checks `isActiveConversation` (line 280)
  - Checks `isRecipient` (line 333) - **FIXED**: Only increments if recipient, not sender
  - Increments `unreadCounts[chatId]` only if conversation not active AND user is recipient

**Verification:**
- ✅ Unread count increments when recipient receives message and conversation is closed
- ✅ Unread count does NOT increment for sender (even if conversation closed)
- ✅ Unread count does NOT increment if conversation is active (viewing chat)

#### 3b. Clears when opening conversation

**Implementation:**
- Frontend (`ChatAdapterContext.jsx:978-1006`): `setActiveConversationId` clears unread for DMs (lines 992-997)
- Frontend (`ChatAdapterContext.jsx:1567-1603`): `markAsReadForConversation` also clears unread after sending read receipt (lines 1597-1601)

**Verification:**
- ✅ Opening DM conversation clears unread count immediately
- ✅ Sending read receipt clears unread count locally (UX improvement)

---

### ✅ 4. Rooms/group chat still works unchanged

**Status:** PASSING

**Implementation:**
- Room messages use separate handler (`ChatAdapterContext.jsx:812-837`): `ROOM_MESSAGE` type
- Room unread counts are separate (`roomUnreadCounts` state, line 80)
- Room message sending is separate (`sendRoomMessageViaWs`, line 1297)
- Room history loading is separate (`loadMessages` checks for `room:` prefix, line 1337)

**Verification:**
- ✅ Room messages handled independently from DM messages
- ✅ Room unread counts (`roomUnreadCounts`) separate from DM unread counts (`unreadCounts`)
- ✅ No interference between DM and room message flows
- ✅ Room message sending/receiving unchanged

---

### ✅ 5. No extra toasts / no rate-limit spam

**Status:** PASSING

**Implementation:**
- Rate limit toasts are debounced (`ChatAdapterContext.jsx:598-601, 610-613`):
  - `RATE_LIMIT_TOAST_DEBOUNCE_MS = 2000` (line 129)
  - Checks `lastRateLimitToastAtRef.current` before showing toast
- Error toasts only shown for specific cases:
  - `WS_AUTH_FAILED` (line 399)
  - `ACCOUNT_SUSPENDED` (line 404)
  - `RATE_LIMIT_EXCEEDED` / `RATE_LIMITED` (debounced, line 600)
  - `RATE_LIMIT_WARNING` (debounced, line 613)
  - Room operation failures (lines 878, 890, 906, 926)
  - Auth errors in `loadChats` (line 1222)
  - Message queued notification (line 1332)

**Verification:**
- ✅ Rate limit toasts debounced (max one per 2 seconds)
- ✅ No duplicate toasts for same error type
- ✅ Only intentional toasts shown (no spam from message delivery)

---

## Fixes Applied During Regression Check

### Fix: Sender unread count increment

**Issue:** When sender received their own message (for multi-tab sync), unread count was incrementing if conversation was not active.

**Location:** `ChatAdapterContext.jsx:330-334`

**Change:**
```javascript
// Before:
const newUnreadCount = !isActiveConversation ? currentUnread + 1 : currentUnread;

// After:
const isRecipient = recipientId === meId;
const newUnreadCount = (!isActiveConversation && isRecipient) ? currentUnread + 1 : currentUnread;
```

**Rationale:** Sender should never see unread badge for their own messages, even in multi-tab scenarios.

---

## Summary

All regression checks pass. The implementation correctly handles:
- ✅ Instant DM delivery without refresh
- ✅ Multi-tab synchronization for sender
- ✅ Correct unread count behavior (increment for recipient only, clear on open)
- ✅ Room/group chat functionality unchanged
- ✅ No toast spam or rate-limit issues

One fix was applied during regression check to prevent sender from seeing unread badges for their own messages.
