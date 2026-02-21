# Verify INVALID_LAST_MESSAGE_ID fix (end-to-end)

## Prerequisites

- App running (e.g. `npm run dev`).
- Logged-in user with at least one room.

---

## 1. Clear then test with dirty `lastSeenMessageId`

### 1a. Clear once (optional baseline)

1. Open DevTools → **Application** (Chrome) or **Storage** (Firefox) → **Local Storage** → your origin.
2. Find key **`chat:lastSeenMessageId`**.
3. Delete it (or set value to empty).
4. Reload the app and use chat normally once so a valid lastSeen can be set if you load history.

### 1b. Set a dirty value

1. In the same Local Storage view, set:
   - **Key:** `chat:lastSeenMessageId`
   - **Value:** any non-existent id, e.g. `dirty-room-msg-id-12345` or `invalid-uuid`.
2. Leave the tab open (or note the value for the next step).

---

## 2. Test steps

1. **Open room chat**  
   In the app, select a **room** conversation (not a DM) so room history is in play.

2. **Load history**  
   Scroll up in the room to trigger `loadMessages` (load more / pagination). Wait until history has loaded at least one page.

3. **Refresh**  
   Full page refresh (F5 or Cmd+R). This causes:
   - Reconnect → HELLO → HELLO_ACK.
   - RESUME sent with `lastSeenMessageId` = your dirty value (or null if you cleared it).
   - Backend may return `MESSAGE_ERROR` with `INVALID_LAST_MESSAGE_ID` for that id.

4. **Optional second trigger**  
   If your flow sends STATE_SYNC then MESSAGE_REPLAY with lastSeen, the backend can also return the same error in response to MESSAGE_REPLAY. Refresh or reconnect once more and watch the same behavior.

---

## 3. Expected results

| Check | Expected |
|-------|----------|
| **No toast** | No “Invalid lastMessageId: message not found in database” (or similar) toast **at any time** during or after refresh. |
| **WebSocket sync** | WS stays connected; RESYNC_START / RESYNC_COMPLETE (and ROOMS_SNAPSHOT, etc.) occur as usual. Messages continue to sync. |
| **Presence** | Presence (online/offline, lastSeen) works and is not broken by the fix. |
| **Messages** | Room (and DM) messages load and display; history and new messages behave normally. |
| **Self-heal** | After the backend returns `INVALID_LAST_MESSAGE_ID`, the app clears `chat:lastSeenMessageId` and does not spam MESSAGE_REPLAY; next RESUME uses `null` and no error toast. |

---

## 4. Quick console check (optional)

After setting a dirty `chat:lastSeenMessageId` and refreshing:

- In DevTools → **Application** → **Local Storage**, confirm that after the error path runs, **`chat:lastSeenMessageId`** is removed (or set to a valid messageId after you send/receive messages again).

---

## 5. What was fixed

- **Root cause:** `loadMessages` was storing `m.id` (roomMessageId) as lastSeen; backend replay expects `messageId` only → `INVALID_LAST_MESSAGE_ID` and toast.
- **Fix 1:** Store only `m.messageId` in lastSeen in `loadMessages` (and comment).
- **Fix 2:** On `MESSAGE_ERROR` with `INVALID_LAST_MESSAGE_ID`: call `clearLastSeenMessageId()`, set recovery ref, **no toast**, and skip further MESSAGE_REPLAY for that connection so the error does not loop.

Using the steps above, you can confirm the toast is gone and sync/presence/messages remain correct.
