# Room WS Protocol (Phase 3B)

Room/group management over WebSocket with RBAC. All actions are possible via WS; no HTTP room endpoints required.

## Client → Server

| Type | Payload | Description |
|------|---------|-------------|
| **ROOM_CREATE** | `{ correlationId?, name?, thumbnailUrl?, memberIds?[] }` | Create room; server generates `roomId` if omitted. Creator is OWNER; optional `memberIds` are added as MEMBER. |
| **ROOM_UPDATE_META** | `{ correlationId?, roomId, patch: { name?, thumbnailUrl? } }` | Update name/thumbnail. RBAC: OWNER or ADMIN. |
| **ROOM_ADD_MEMBERS** | `{ correlationId?, roomId, userIds[] }` | Add users as MEMBER. RBAC: OWNER or ADMIN. Dedup. |
| **ROOM_REMOVE_MEMBER** | `{ correlationId?, roomId, userId }` | Remove member. RBAC: OWNER (anyone) or ADMIN (MEMBER only). |
| **ROOM_SET_ROLE** | `{ correlationId?, roomId, userId, role: "ADMIN"\|"MEMBER" }` | Set role. RBAC: OWNER only (ADMIN cannot set OWNER). |
| **ROOM_LEAVE** | `{ correlationId?, roomId }` | Leave room. Owner leave triggers transfer. |
| **ROOM_DELETE** | `{ correlationId?, roomId }` | Delete room. RBAC: OWNER only. |
| **ROOM_INFO** | `{ correlationId?, roomId }` | Get full snapshot. RBAC: must be member. |
| **ROOM_LIST** | `{ correlationId?, includeAll? }` | List rooms (user’s rooms or all if includeAll). |
| **ROOM_MEMBERS** | `{ correlationId?, roomId }` | Same as ROOM_INFO (full snapshot). RBAC: must be member. |

- `correlationId` is optional; when present it is echoed in the response so the client can match requests.
- **ROOM_JOIN** (existing): `{ roomId, correlationId? }` — join by roomId.
- **ROOM_MESSAGE** (existing): unchanged.

## Server → Client

| Type | Payload | When |
|------|---------|------|
| **ROOM_CREATED** | `{ correlationId?, room }` | Response to ROOM_CREATE; `room` is full snapshot. Also used for ROOM_INFO / ROOM_MEMBERS response. |
| **ROOM_UPDATED** | `{ correlationId?, roomId, patch, version, updatedAt }` | Response to ROOM_UPDATE_META; broadcast to members. |
| **ROOM_MEMBERS_UPDATED** | `{ correlationId?, roomId, members[], roles{}, version, updatedAt, name?, thumbnailUrl? }` | Response to add/remove/setRole; broadcast to members. Includes room meta so clients show name without extra ROOM_INFO. |
| **ROOM_DELETED** | `{ correlationId?, roomId }` | Response to ROOM_DELETE; broadcast to (former) members. |
| **ERROR** | `{ correlationId?, code, message }` | Any forbidden/validation/not-found error. |

Room snapshot shape (for `room` in ROOM_CREATED and ROOM_INFO/ROOM_MEMBERS):

```json
{
  "id": "roomId",
  "meta": { "name", "thumbnailUrl", "createdAt", "createdBy" },
  "version": 1,
  "updatedAt": 1234567890,
  "members": ["userId1", "userId2"],
  "roles": { "userId1": "OWNER", "userId2": "MEMBER" }
}
```

## Error codes

| Code | Meaning |
|------|--------|
| **UNAUTHORIZED** | Not authenticated (no/invalid session). |
| **VALIDATION_ERROR** | Invalid or missing payload (e.g. missing roomId, empty userIds). |
| **NOT_FOUND** | Room does not exist (or not a member where membership is required). |
| **FORBIDDEN** | RBAC: action not allowed for this role (e.g. MEMBER updating meta, ADMIN removing OWNER). |
| **CREATE_FAILED** | Room create failed (e.g. room already exists, max rooms). |
| **JOIN_FAILED** | Join failed (e.g. room full). |
| **LEAVE_FAILED** | Leave failed. |

## Broadcast semantics

On room mutations the server broadcasts to **all current members’** active sockets:

- **ROOM_UPDATE_META** → broadcast **ROOM_UPDATED** (patch, version, updatedAt).
- **ROOM_ADD_MEMBERS** / **ROOM_REMOVE_MEMBER** / **ROOM_SET_ROLE** (and owner transfer on leave) → broadcast **ROOM_MEMBERS_UPDATED** (members, roles, version, updatedAt).
- **ROOM_DELETE** → broadcast **ROOM_DELETED** to all members, then room is deleted.

All broadcast payloads include `version` and `updatedAt` for optimistic UI.

## Idempotency / duplicates

- **ROOM_CREATE**: If client sends same `correlationId` twice on same connection, server does not de-dup (optional future: connection-scoped correlationId cache).
- **ROOM_ADD_MEMBERS**: Server de-duplicates `userIds` before adding.

## Compatibility

- **ROOM_JOIN**, **ROOM_LEAVE**, **ROOM_MESSAGE** are unchanged; **ROOM_CREATE** accepts optional `roomId` (server-generated when omitted), optional `memberIds` and `thumbnailUrl`.
- **ROOM_INFO** / **ROOM_MEMBERS** now return **ROOM_CREATED**-style snapshot and require membership (FORBIDDEN if not member).
- **ROOM_LIST** returns `listRoomsForUser` shape (or all rooms if `includeAll`); response includes `correlationId` when provided.
