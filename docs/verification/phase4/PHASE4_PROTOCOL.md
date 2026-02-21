# Phase 4: ROOM_* Protocol Reference

**Source of truth:** backend code. All payloads below are derived from actual handler implementations, not invented.

---

## Incoming (Client → Server)

| Type | Required | Optional | Backend File:Line |
|------|----------|----------|-------------------|
| ROOM_CREATE | roomId | name, metadata | room.js:31 |
| ROOM_JOIN | roomId | — | room.js:88 |
| ROOM_LEAVE | roomId | — | room.js:157 |
| ROOM_MESSAGE | roomId, content | clientMessageId, messageType | room.js:208 |
| ROOM_INFO | roomId | — | room.js:248 |
| ROOM_LIST | — | includeAll | room.js:298 |
| ROOM_MEMBERS | roomId | — | room.js:332 |

---

## Outgoing (Server → Client)

### Responses (to requester)

| Type | Success fields | Error fields | Backend File:Line |
|------|----------------|--------------|-------------------|
| ROOM_CREATE_RESPONSE | success, roomId, name, joined, timestamp | error, code | room.js:61-68, 25-53 |
| ROOM_JOIN_RESPONSE | success, roomId, roomInfo, members, alreadyMember, timestamp | error, code | room.js:128-136, 82-111 |
| ROOM_LEAVE_RESPONSE | success, roomId, timestamp | error, code | room.js:192-197, 161-186 |
| ROOM_MESSAGE_RESPONSE | success, roomId, roomMessageId, messageIds, sentCount, memberCount, timestamp, duplicate? | error, code | group.service.js:125-134, room.js:206-225 |
| ROOM_INFO_RESPONSE | success, roomId, roomInfo, members, timestamp | error, code | room.js:270-277, 240-268 |
| ROOM_LIST_RESPONSE | success, rooms, count, timestamp | error, code | room.js:307-314, 286-296 |
| ROOM_MEMBERS_RESPONSE | success, roomId, members, count, timestamp | error, code | room.js:356-364, 325-354 |

### Broadcasts (to room members)

| Type | Fields | Backend File:Line |
|------|--------|-------------------|
| ROOM_MEMBER_JOINED | roomId, userId, timestamp | room.js:117-122 |
| ROOM_MEMBER_LEFT | roomId, userId, timestamp, reason? | room.js:170-175, 375-382 |
| ROOM_MESSAGE | messageId, roomId, roomMessageId, senderId, content, timestamp, messageType | group.service.js:101-110 |

---

## Payload Examples (from backend)

### ROOM_CREATE (client → server)
```json
{ "type": "ROOM_CREATE", "roomId": "room-1", "name": "My Room", "metadata": {} }
```

### ROOM_CREATE_RESPONSE (server → client, success)
```json
{ "type": "ROOM_CREATE_RESPONSE", "success": true, "roomId": "room-1", "name": "My Room", "joined": true, "timestamp": 1739184000000 }
```

### ROOM_CREATE_RESPONSE (server → client, error)
```json
{ "type": "ROOM_CREATE_RESPONSE", "success": false, "error": "Room already exists", "code": "CREATE_FAILED", "roomId": "room-1" }
```

### ROOM_JOIN (client → server)
```json
{ "type": "ROOM_JOIN", "roomId": "room-1" }
```

### ROOM_JOIN_RESPONSE (server → client, success)
```json
{ "type": "ROOM_JOIN_RESPONSE", "success": true, "roomId": "room-1", "roomInfo": { "roomId": "room-1", "name": "My Room", "createdAt": 1739184000000, "createdBy": "u1", "metadata": {}, "memberCount": 2 }, "members": ["u1", "u2"], "alreadyMember": false, "timestamp": 1739184001000 }
```

### ROOM_MEMBER_JOINED (broadcast to other members)
```json
{ "type": "ROOM_MEMBER_JOINED", "roomId": "room-1", "userId": "u2", "timestamp": 1739184001000 }
```

### ROOM_LEAVE (client → server)
```json
{ "type": "ROOM_LEAVE", "roomId": "room-1" }
```

### ROOM_LEAVE_RESPONSE (server → client, success)
```json
{ "type": "ROOM_LEAVE_RESPONSE", "success": true, "roomId": "room-1", "timestamp": 1739184002000 }
```

### ROOM_MEMBER_LEFT (broadcast)
```json
{ "type": "ROOM_MEMBER_LEFT", "roomId": "room-1", "userId": "u2", "timestamp": 1739184002000 }
```
On disconnect, includes `"reason": "disconnect"`.

### ROOM_MESSAGE (client → server)
```json
{ "type": "ROOM_MESSAGE", "roomId": "room-1", "content": "Hello", "clientMessageId": "cm-1", "messageType": "text" }
```

### ROOM_MESSAGE_RESPONSE (server → client, success)
```json
{ "type": "ROOM_MESSAGE_RESPONSE", "success": true, "roomId": "room-1", "roomMessageId": "rm_1739184003000_abc123", "messageIds": ["rm_rm_1739184003000_abc123_u2"], "sentCount": 1, "memberCount": 2, "timestamp": 1739184003000 }
```
Duplicate sends return same payload with `"duplicate": true`.

### ROOM_MESSAGE (server → client, broadcast to members)
```json
{ "type": "ROOM_MESSAGE", "messageId": "rm_rm_1739184003000_abc123_u2", "roomId": "room-1", "roomMessageId": "rm_1739184003000_abc123", "senderId": "u1", "content": "Hello", "timestamp": 1739184003000, "messageType": "text" }
```

### ROOM_INFO (client → server)
```json
{ "type": "ROOM_INFO", "roomId": "room-1" }
```

### ROOM_INFO_RESPONSE (server → client, success)
```json
{ "type": "ROOM_INFO_RESPONSE", "success": true, "roomId": "room-1", "roomInfo": { "roomId": "room-1", "name": "My Room", "createdAt": 1739184000000, "createdBy": "u1", "metadata": {}, "memberCount": 2 }, "members": ["u1", "u2"], "timestamp": 1739184004000 }
```

### ROOM_LIST (client → server)
```json
{ "type": "ROOM_LIST" }
```
Optional: `"includeAll": true` to list all rooms (otherwise user's rooms only).

### ROOM_LIST_RESPONSE (server → client, success)
```json
{ "type": "ROOM_LIST_RESPONSE", "success": true, "rooms": [{ "roomId": "room-1", "name": "My Room", "createdAt": 1739184000000, "createdBy": "u1", "metadata": {}, "memberCount": 2 }], "count": 1, "timestamp": 1739184005000 }
```

### ROOM_MEMBERS (client → server)
```json
{ "type": "ROOM_MEMBERS", "roomId": "room-1" }
```

### ROOM_MEMBERS_RESPONSE (server → client, success)
```json
{ "type": "ROOM_MEMBERS_RESPONSE", "success": true, "roomId": "room-1", "members": ["u1", "u2"], "count": 2, "timestamp": 1739184006000 }
```

---

## Error Codes (per operation)

| Operation | Error Codes |
|-----------|-------------|
| ROOM_CREATE | UNAUTHORIZED, MISSING_ROOM_ID, CREATE_FAILED |
| ROOM_JOIN | UNAUTHORIZED, MISSING_ROOM_ID, JOIN_FAILED |
| ROOM_LEAVE | UNAUTHORIZED, MISSING_ROOM_ID, LEAVE_FAILED |
| ROOM_MESSAGE | UNAUTHORIZED, MISSING_ROOM_ID, MISSING_CONTENT, CONTENT_TOO_LONG, NOT_A_MEMBER, BROADCAST_FAILED |
| ROOM_INFO | UNAUTHORIZED, MISSING_ROOM_ID, ROOM_NOT_FOUND |
| ROOM_LIST | UNAUTHORIZED |
| ROOM_MEMBERS | UNAUTHORIZED, MISSING_ROOM_ID, ROOM_NOT_FOUND |

Source: room.js handlers, group.service.js, errorCodes.js.

---

## Idempotency Rules

| Operation | Rule |
|-----------|------|
| ROOM_CREATE | Not idempotent. Duplicate roomId returns CREATE_FAILED (roomManager.js:49-51). |
| ROOM_JOIN | Idempotent. Already member returns success with `alreadyMember: true` (room.js:116, 134). |
| ROOM_MESSAGE | Idempotent key: (userId, roomId, clientMessageId). Duplicate returns ROOM_MESSAGE_RESPONSE with `duplicate: true`, same roomMessageId/messageIds (group.service.js:61-74). |

---

## Authorization

- All handlers require authenticated userId (connectionManager.getUserId(ws)).
- ROOM_MESSAGE requires membership: `roomManager.isRoomMember(roomId, userId)` (room.js:219).
- No admin-only room ops; any authenticated user can create/join/leave.
- roomManager enforces config limits: maxRooms, maxMembersPerRoom (constants.js ROOMS config).

---

## Verification: Backend File References

| Item | File | Lines |
|------|------|-------|
| Incoming ROOM_* payloads | backend/websocket/handlers/room.js | 31, 88, 157, 208, 248, 298, 332 |
| ROOM_CREATE_RESPONSE | backend/websocket/handlers/room.js | 24-69 |
| ROOM_JOIN_RESPONSE, ROOM_MEMBER_JOINED | backend/websocket/handlers/room.js | 80-137 |
| ROOM_LEAVE_RESPONSE, ROOM_MEMBER_LEFT | backend/websocket/handlers/room.js | 150-198, 369-383 |
| ROOM_MESSAGE_RESPONSE | backend/websocket/handlers/room.js | 204-227 |
| ROOM_MESSAGE (server→client) | backend/websocket/services/group.service.js | 101-110, 126-134 |
| ROOM_INFO_RESPONSE | backend/websocket/handlers/room.js | 236-278 |
| ROOM_LIST_RESPONSE | backend/websocket/handlers/room.js | 286-315 |
| ROOM_MEMBERS_RESPONSE | backend/websocket/handlers/room.js | 325-365 |
| roomInfo shape | backend/websocket/state/roomManager.js | 245-256 |
| Idempotency (ROOM_MESSAGE) | backend/websocket/services/group.service.js | 61-74 |
| Error codes | backend/utils/errorCodes.js | 27-36 |
