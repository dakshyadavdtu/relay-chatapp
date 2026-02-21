# Room RBAC Model (Phase 3A)

Backend room state is upgraded so that “rooms == WhatsApp groups” is fully representable: members (Set), roles (OWNER/ADMIN/MEMBER), meta, version/updatedAt, and join-order for owner-transfer.

## Data model (per room)

| Field | Type | Description |
|-------|------|-------------|
| `members` | `Set<userId>` | Member user IDs |
| `roles` | `Map<userId, role>` | Role per member: `"OWNER"` \| `"ADMIN"` \| `"MEMBER"` |
| `meta` | `Object` | `{ name, thumbnailUrl?, createdAt, createdBy }` |
| `updatedAt` | `number` | Last mutation timestamp (ms) |
| `version` | `number` | Monotonic integer, incremented on every mutation |
| `joinedAtByUser` | `Map<userId, number>` | Join timestamp (ms) for “oldest” ordering (owner transfer) |

- **meta.name**: Room display name.
- **meta.thumbnailUrl**: Optional; may be `null`.
- **meta.createdAt** / **meta.createdBy**: Set at creation; creator is the first OWNER.

Version is incremented on: meta update, add/remove member, role change, ownership transfer, and room delete.

## Roles

| Role | Update meta | Add members | Remove member | Set role | Delete room |
|------|-------------|-------------|---------------|----------|-------------|
| **OWNER** | ✓ | ✓ | Anyone | Any role | ✓ |
| **ADMIN** | ✓ | ✓ | MEMBER only | ADMIN/MEMBER (not OWNER) | ✗ |
| **MEMBER** | ✗ | ✗ | ✗ | ✗ | ✗ |

- **OWNER**: Full control; can update meta, add/remove anyone, promote/demote admins, delete room.
- **ADMIN**: Can update meta, add members, remove **MEMBER** only (cannot remove OWNER or another ADMIN). Cannot delete room or set anyone to OWNER.
- **MEMBER**: Can view room info and members/roles, send messages, and leave. Cannot update meta, change roles, or remove others.

## Owner-leave policy (WhatsApp-like)

When the **OWNER** leaves the room:

1. **Transfer ownership** to the “oldest” remaining member:
   - Prefer an **ADMIN** with the smallest `joinedAt` (oldest admin).
   - If there is no ADMIN, the **MEMBER** with the smallest `joinedAt` becomes OWNER.
2. If there are **no members left** after the owner leaves, the room is **deleted** (no empty room).

Join order is tracked in `joinedAtByUser`; “oldest” means smallest timestamp.

## Snapshot format

### getRoomSnapshot(roomId)

Returns a single room snapshot for the UI:

```json
{
  "id": "roomId",
  "meta": {
    "name": "Room Name",
    "thumbnailUrl": null,
    "createdAt": 1234567890,
    "createdBy": "userId"
  },
  "version": 2,
  "updatedAt": 1234567891,
  "members": ["user1", "user2"],
  "roles": {
    "user1": "OWNER",
    "user2": "MEMBER"
  }
}
```

### listRoomsForUser(userId)

Returns a lightweight list of rooms the user is in:

```json
[
  {
    "id": "roomId",
    "name": "Room Name",
    "thumbnailUrl": null,
    "memberCount": 5,
    "myRole": "ADMIN",
    "version": 3,
    "updatedAt": 1234567892
  }
]
```

## RBAC helpers (roomManager)

These throw on failure; handlers should catch and map to WS/HTTP error responses.

| Helper | Purpose |
|--------|---------|
| `assertMember(roomId, userId)` | Throws if room missing or user not a member |
| `getRole(roomId, userId)` | Returns `'OWNER'` \| `'ADMIN'` \| `'MEMBER'` or `null` |
| `assertCanUpdateMeta(actorRole)` | OWNER or ADMIN |
| `assertCanAddMembers(actorRole)` | OWNER or ADMIN |
| `assertCanRemoveMember(actorRole, targetRole)` | OWNER can remove anyone; ADMIN only MEMBER |
| `assertCanSetRole(actorRole, targetRole, newRole)` | OWNER can set any; ADMIN cannot set OWNER |
| `assertCanDelete(actorRole)` | OWNER only |

Mutation helpers that perform the check and update (return `{ success, error? }`):

- `updateRoomMeta(roomId, actorUserId, { name?, thumbnailUrl? })`
- `removeMember(roomId, actorUserId, targetUserId)`
- `setMemberRole(roomId, actorUserId, targetUserId, newRole)`

## Implementation notes

- **Atomicity**: Mutations (add/remove member, set role, update meta, owner transfer) update state and bump `version`/`updatedAt` in one pass; no partial updates on error.
- **Membership before role**: A user must be in `members` before having an entry in `roles`; role defaults to MEMBER when joining.
- **Backward compatibility**: `createRoom`, `joinRoom`, `leaveRoom`, `getRoomMembers`, `getRoomInfo`, `getAllRooms`, `broadcastToRoom` retain their existing semantics; `getRoomInfo` now includes `version` and `updatedAt` where applicable.

## Self-check

Run the built-in self-check (e.g. from a dev script):

```js
const roomManager = require('./websocket/state/roomManager');
console.log(roomManager.selfCheck()); // true if all checks pass
```

It exercises: create room → add members → set role → remove member → owner leave (ownership transfer) → snapshot correctness → empty room delete.
