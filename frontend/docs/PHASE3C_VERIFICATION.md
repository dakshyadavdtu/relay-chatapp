# Phase 3C — Frontend wiring verification

Group/room UI is wired to backend WS rooms. Use this checklist to verify behaviour manually.

## Prerequisites

- Backend running with WS room handlers (Phase 3B).
- Frontend running with `VITE_ENABLE_WS=true`.
- At least two users (e.g. admin + normal) for RBAC checks.

## 1. Create group

1. Log in as user A.
2. In the chat sidebar, click **New group** (or equivalent).
3. **Step 1:** Search/select one or more members, click **Proceed**.
4. **Step 2:** Enter group name, optionally upload thumbnail, click **Create**.
5. **Expect:** New room appears in sidebar; chat opens for that room; no error toast.
6. **Optional:** Confirm in Network/WS that `ROOM_CREATE` was sent and `ROOM_CREATED` received.

## 2. Rename / thumbnail

1. Open a room you are in (OWNER or ADMIN).
2. Open **Group info** (header (i) or menu).
3. Change the group name, click **Save**.
4. **Expect:** Name updates; success toast; other members see update (if multi-tab).
5. Change thumbnail (upload image), **Save**.
6. **Expect:** Thumbnail updates in header/sidebar.

## 3. Add / remove members

1. As OWNER or ADMIN, open **Group info**.
2. **Add:** Use “Add members” (if present) or create a new group with more members; otherwise add via backend/WS and confirm list updates.
3. **Remove:** Click remove (user-minus) on a MEMBER, confirm in modal.
4. **Expect:** Member list updates; removed user no longer in list; toast on success.
5. **RBAC:** As MEMBER, **expect** no promote/remove controls (or they are disabled).

## 4. Promote / demote

1. As OWNER, open **Group info**.
2. Promote a MEMBER to ADMIN (shield icon).
3. **Expect:** Role updates; toast “User is now ADMIN.”
4. Demote that user back to MEMBER (shield-off).
5. **Expect:** Toast “User is now MEMBER.”
6. **RBAC:** As ADMIN, try to demote/remove OWNER — **expect** no permission or FORBIDDEN toast.
7. As MEMBER, **expect** no promote/demote/remove buttons (or disabled).

## 5. Leave group

1. Open **Group info** for a room you are in.
2. Click **Exit Group**.
3. **Expect:** Panel closes; room disappears from sidebar; you are no longer in that room; toast “Left group.”
4. Re-join (if possible) or create another room and confirm list is correct.

## 6. Delete group

1. As **OWNER**, open **Group info**.
2. Click **Delete Group** (owner-only), confirm if prompted.
3. **Expect:** Room disappears from sidebar for you; toast “Group deleted.”
4. **RBAC:** As ADMIN or MEMBER, **expect** no “Delete group” button, or it shows FORBIDDEN if triggered via devtools.
5. If another member has the room open, they should see the room disappear (ROOM_DELETED push).

## 7. RBAC — forbidden actions

1. As MEMBER, open **Group info**.
   - **Expect:** No “Save” for name (or save fails with FORBIDDEN toast); no promote/remove/delete.
2. As ADMIN, try to remove or demote OWNER (if UI allowed).
   - **Expect:** Error toast with FORBIDDEN or “Only the owner can…”.
3. As non-owner, try delete (if button is visible in any edge case).
   - **Expect:** FORBIDDEN toast.

## 8. Reconnect / list

1. Refresh the page (or disconnect/reconnect WS).
2. **Expect:** After HELLO_ACK, room list loads; your rooms appear in sidebar.
3. Open a room, open **Group info**.
4. **Expect:** Members and roles match backend (real data, no mock).

## Notes

- All group actions go over **WebSocket** (no HTTP room endpoints).
- Errors should show a **toast** with a clear message (e.g. “Only the owner can delete the group”).
- **Optimistic** rename is acceptable; reconcile with server `version`/`updatedAt` when available.
- If “user list” is empty in New group, ensure backend exposes a user list (e.g. `GET /api/admin/users`) and the current user has access.
