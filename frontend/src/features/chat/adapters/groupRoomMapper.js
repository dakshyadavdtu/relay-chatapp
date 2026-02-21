/**
 * Phase 3 Fix A: Adapter mapping between backend rooms and UI group models.
 * Pure functions only; no WS calls; no state mutation.
 * Backend roles: OWNER | ADMIN | MEMBER.
 */

/**
 * Normalize backend role to UI role. Backend uses OWNER/ADMIN/MEMBER.
 * @param {string} role - Backend role (OWNER, ADMIN, MEMBER or lowercase)
 * @returns {string} UI role (OWNER, ADMIN, MEMBER)
 */
export function uiRoleFromBackendRole(role) {
  if (role == null || role === "") return "MEMBER";
  const r = String(role).toUpperCase();
  if (r === "OWNER" || r === "ADMIN" || r === "MEMBER") return r;
  return "MEMBER";
}

/**
 * Convert UI group patch to backend room meta patch.
 * UI: { title?, photo? } -> Backend: { name?, thumbnailUrl? }
 * @param {{ title?: string, photo?: string | null }} patch - UI group patch
 * @returns {{ name?: string, thumbnailUrl?: string | null }} Backend room patch
 */
export function backendPatchFromGroupPatch(patch) {
  if (!patch || typeof patch !== "object") return {};
  const out = {};
  if (patch.title !== undefined) out.name = patch.title;
  if (patch.photo !== undefined) out.thumbnailUrl = patch.photo ?? null;
  return out;
}

/**
 * Resolve members list and roles from room + members payload.
 * membersByRoomId can be { members: string[], roles: Record<string, string> } or string[].
 */
function getMembersAndRoles(room, members) {
  const fromRoom = Array.isArray(room?.members) ? room.members : [];
  const rolesFromRoom = room?.roles && typeof room.roles === "object" ? room.roles : {};
  let memberIds = fromRoom;
  let roles = rolesFromRoom;
  if (members != null) {
    if (Array.isArray(members)) {
      memberIds = members;
    } else if (members?.members && Array.isArray(members.members)) {
      memberIds = members.members;
      if (members.roles && typeof members.roles === "object") roles = members.roles;
    }
  }
  return { memberIds, roles };
}

/**
 * Map a single room to UI group shape.
 * room.id -> group.id
 * room.meta.name | room.name -> group.title
 * room.thumbnailUrl | room.meta?.thumbnailUrl -> group.photo
 * room.members + room.roles -> group.members[] with .role from roles[userId]
 *
 * @param {object} room - Room snapshot { id?, roomId?, name?, meta?, thumbnailUrl?, members?, roles? }
 * @param {object|string[]|undefined} members - Optional { members: string[], roles: {} } or string[] (e.g. membersByRoomId[roomId])
 * @param {Record<string, object>} usersById - User id -> { id, displayName?, username?, ... } for member display
 * @param {string|null|undefined} myUserId - Current user id (for optional "me" flag)
 * @returns {object} Group { id, title, photo, members: [{ userId, role, displayName?, isMe? }] }
 */
export function roomToGroup(room, members, usersById, myUserId) {
  if (!room) return { id: null, title: "", photo: null, members: [] };
  const id = room.id ?? room.roomId ?? null;
  const title = room.meta?.name ?? room.name ?? "";
  const photo = room.thumbnailUrl ?? room.meta?.thumbnailUrl ?? null;
  const { memberIds, roles } = getMembersAndRoles(room, members);
  const users = usersById && typeof usersById === "object" ? usersById : {};
  const myId = myUserId != null ? String(myUserId) : null;
  const groupMembers = memberIds.map((uid) => {
    const userId = typeof uid === "string" ? uid : (uid?.userId ?? uid?.id ?? String(uid));
    const role = uiRoleFromBackendRole(roles[userId]);
    const u = users[userId];
    const displayName = u?.displayName ?? u?.username ?? null;
    return {
      userId,
      role,
      displayName: displayName ?? undefined,
      isMe: myId !== null && String(userId) === myId,
    };
  });
  return {
    id,
    title,
    photo,
    members: groupMembers,
  };
}

/**
 * Map multiple rooms to UI groups array.
 *
 * @param {string[]} roomIds - List of room ids
 * @param {Record<string, object>} roomsById - roomId -> room snapshot
 * @param {Record<string, object|string[]>} membersByRoomId - roomId -> { members, roles } or string[]
 * @param {Record<string, object>} usersById - User id -> user object
 * @param {string|null|undefined} myUserId - Current user id
 * @returns {object[]} Array of groups (same shape as roomToGroup)
 */
export function roomsToGroups(roomIds, roomsById, membersByRoomId, usersById, myUserId) {
  if (!Array.isArray(roomIds)) return [];
  const rid = roomsById && typeof roomsById === "object" ? roomsById : {};
  const mid = membersByRoomId && typeof membersByRoomId === "object" ? membersByRoomId : {};
  const uid = usersById && typeof usersById === "object" ? usersById : {};
  const myId = myUserId != null ? myUserId : null;
  return roomIds
    .map((id) => {
      const room = rid[id];
      const members = mid[id];
      return roomToGroup(room ?? { id, roomId: id }, members, uid, myId);
    })
    .filter((g) => g.id != null);
}
