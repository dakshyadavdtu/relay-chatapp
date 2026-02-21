# Room resume and live consistency (Phase 3D)

Deterministic reconnect/resume for rooms: snapshot then deltas, versioning, and reliable propagation of membership/role changes.

## RESUME and ROOMS_SNAPSHOT

- **Client** sends `RESUME` (with optional `lastSeenMessageId`, `limit`) after `HELLO_ACK` when reconnecting.
- **Server** handles RESUME in order:
  1. Sends `RESYNC_START`.
  2. Replays undelivered DM/room messages (existing replay pipeline).
  3. Sends `RESYNC_COMPLETE` with `messageCount`.
  4. Sends **ROOMS_SNAPSHOT** with the current room list for the user.

**ROOMS_SNAPSHOT** payload:

```json
{
  "type": "ROOMS_SNAPSHOT",
  "rooms": [
    { "id": "room_1", "name": "...", "thumbnailUrl": null, "memberCount": 2, "myRole": "OWNER", "version": 3, "updatedAt": 1234567890 }
  ],
  "timestamp": 1234567890
}
```

- `rooms`: same shape as `listRoomsForUser(userId)` — ids, meta summary, `myRole`, `version`, `updatedAt`.
- Client must **replace** its room list with this snapshot (authoritative), then apply subsequent deltas.

## Versioning and ordering

- Every room mutation (meta update, add/remove member, set role, leave, delete) increments `room.version` and sets `room.updatedAt`.
- Every push event includes `version` and `updatedAt`:
  - **ROOM_UPDATED**: `version`, `updatedAt`, `patch`
  - **ROOM_MEMBERS_UPDATED**: `version`, `updatedAt`, `members`, `roles`
  - **ROOM_DELETED**: room is removed; no version needed.

**Client rule:** ignore out-of-order updates:

- If `incoming.version <= localRoom.version`, drop the update (do not apply).

This prevents stale reconnects or out-of-order delivery from overwriting newer state.

## Broadcast and removed-user notification

- **ROOM_UPDATED** and **ROOM_MEMBERS_UPDATED** are broadcast to **remaining** room members via `broadcastToRoom(roomId, payload)`.
- When a user is **removed** (ROOM_REMOVE_MEMBER):
  - Server removes the user, then gets the new snapshot.
  - Server broadcasts **ROOM_MEMBERS_UPDATED** to remaining members.
  - Server also sends **ROOM_MEMBERS_UPDATED** to the **removed user** (via `sendToUserSocket(targetUserId, payload)`).
- The removed user’s client receives a ROOM_MEMBERS_UPDATED where they are no longer in `members`; it should remove that room from the sidebar and clear it from local state.

So: one consistent behaviour — **ROOM_MEMBERS_UPDATED** for everyone (remaining + removed), with the same payload (current members/roles). Removed user infers “I’m out” from not being in `members`.

## Frontend flow

1. **On HELLO_ACK:** send `RESUME` (no separate ROOM_LIST request for initial load).
2. **On ROOMS_SNAPSHOT:** replace `roomsById`, `roomIds`, `rolesByRoom` (and optionally clear or preserve `membersByRoomId` for listed rooms). Do not merge; this is the authoritative snapshot.
3. **On ROOM_UPDATED:** apply only if `msg.version > localRoom.version`; then update meta and version.
4. **On ROOM_MEMBERS_UPDATED:**  
   - If current user is **not** in `msg.members`: remove room from list and clear active conversation if needed.  
   - If current user **is** in `msg.members`: apply only if `msg.version > localRoom.version`; update members/roles and version.
5. **On ROOM_DELETED:** remove room from list and clear active if needed.

## Hard refresh behaviour

- User refreshes the page → new WS connection → HELLO → HELLO_ACK → RESUME → RESYNC_* → **ROOMS_SNAPSHOT**.
- Client replaces room state with the snapshot; sidebar and group info reflect current membership and roles.
- Role or name changes that happened while offline are reflected because the snapshot is built from current server state.

## Summary

| Topic              | Behaviour |
|--------------------|-----------|
| After RESUME       | Server sends ROOMS_SNAPSHOT; client replaces room list. |
| Versioning         | All mutations bump version; every push has version/updatedAt. |
| Stale updates      | Client drops ROOM_* updates when incoming version ≤ local version. |
| Removed user       | Server sends ROOM_MEMBERS_UPDATED to removed user; client removes room when self not in members. |
| No HTTP fallback   | Room state is WS-only; no HTTP room list for resume. |
