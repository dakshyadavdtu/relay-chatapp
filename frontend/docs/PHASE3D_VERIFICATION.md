# Phase 3D — Live consistency and reconnect verification

After Phase 3D, room state is rebuilt from a **snapshot** after reconnect; **versioned deltas** avoid stale updates; **removed users** see the room disappear.

## Prerequisites

- Backend running with Phase 3D (RESUME sends ROOMS_SNAPSHOT; removed user gets ROOM_MEMBERS_UPDATED).
- Frontend with HELLO_ACK → RESUME only (no ROOM_LIST on connect); ROOMS_SNAPSHOT handler replaces store; version check on ROOM_* deltas.

## 1. Hard refresh does not break group UI

1. Log in, create or join at least one room. Confirm the room appears in the sidebar.
2. **Hard refresh** (Ctrl+Shift+R / Cmd+Shift+R) or close tab and reopen the app.
3. **Expect:** After reload, the same room(s) appear in the sidebar. No duplicate rooms, no missing rooms.
4. Open a room, open **Group info**. **Expect:** Members and roles match the server (correct).

## 2. Snapshot then deltas (reconnect)

1. **Browser A:** User A creates a room with User B, both see the room.
2. **Browser B:** User B refreshes the page. **Expect:** Room still appears (from ROOMS_SNAPSHOT after RESUME).
3. **Browser A:** User A renames the room while User B is still loading or briefly disconnected.
4. **Browser B:** Once connected, **expect:** Room name updates (from ROOM_UPDATED delta, or from a later snapshot if B reconnected).
5. **Browser B:** Refresh again. **Expect:** Latest name is shown (snapshot is authoritative).

## 3. Role change while offline

1. User A (OWNER) promotes User B to ADMIN.
2. User B is offline or has the tab closed.
3. User B opens the app (or refreshes). **Expect:** User B sees their role as ADMIN in Group info and in the room list (from ROOMS_SNAPSHOT or ROOM_MEMBERS_UPDATED when they reconnect).

## 4. Removed user sees room disappear

1. **Browser A:** User A (OWNER) removes User B from the room.
2. **Browser B:** User B has the app open (same room or another tab). **Expect:** The room disappears from User B’s sidebar (they receive ROOM_MEMBERS_UPDATED where they are not in `members`).
3. If User B had that room open, **expect:** Active conversation clears or switches; they cannot send messages in that room.
4. User B refreshes. **Expect:** The room does not reappear (not in ROOMS_SNAPSHOT).

## 5. Versioning / no stale overwrite

1. Open a room; note the current name (or version if visible in devtools).
2. In another client/tab, rename the room twice (so version increases by 2).
3. On the first client, receive the first ROOM_UPDATED (e.g. version 2). Then receive a delayed ROOM_UPDATED for version 1. **Expect:** The client does **not** overwrite with the older version; the UI keeps the newer name (version 2).

## 6. Smoke script (backend)

From repo root:

```bash
cd backend && PORT=8000 ADMIN_USER=dev_admin ADMIN_PASS=dev_admin node scripts/room_resume_smoke.js
```

**Expect:** Connects, HELLO, RESUME; receives RESYNC_START, RESYNC_COMPLETE, ROOMS_SNAPSHOT; script exits with PASS. ROOMS_SNAPSHOT.rooms is an array; each room has id and (recommended) version/updatedAt.

## Summary

| Check | Expected |
|-------|----------|
| Hard refresh | Sidebar shows correct rooms; group info shows correct members/roles. |
| Reconnect | Room list comes from ROOMS_SNAPSHOT; then deltas (ROOM_UPDATED / ROOM_MEMBERS_UPDATED) apply. |
| Rename while other offline | After reconnect/refresh, other user sees latest name. |
| Role change while offline | After reconnect, user sees updated role. |
| Removed user | Room disappears from their sidebar; refresh does not bring it back. |
| Stale delta | Incoming update with version ≤ local version is ignored. |
