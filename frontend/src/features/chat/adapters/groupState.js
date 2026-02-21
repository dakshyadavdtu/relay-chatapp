/**
 * Group state adapter: selectors over existing store snapshot.
 * Does NOT import or modify ChatAdapterContext. Reads store shape defensively.
 */
import { toRoomChatId, normalizeRoomId } from "../group/identity.js";

/**
 * Get raw active room id from store (activeGroupId or parsed from activeConversationId).
 * @param {object} existingStoreState - Current store/context value snapshot
 * @returns {string|null} Raw room id or null
 */
export function selectActiveRoomIdRaw(existingStoreState) {
  if (!existingStoreState || typeof existingStoreState !== "object") return null;
  const activeGroupId = existingStoreState.activeGroupId;
  if (activeGroupId != null && activeGroupId !== "") return String(activeGroupId);
  const cid = existingStoreState.activeConversationId;
  if (typeof cid === "string" && cid.startsWith("room:")) return cid.slice(5);
  if (typeof cid === "string" && cid.startsWith("group-")) return cid.slice(7);
  return null;
}

/**
 * Get active room as canonical room chat id ("room:<raw>").
 * @param {object} existingStoreState - Current store snapshot
 * @returns {string|null} "room:<raw>" or null if no active room
 */
export function selectActiveRoomChatId(existingStoreState) {
  const raw = selectActiveRoomIdRaw(existingStoreState);
  if (!raw) return null;
  const chatId = toRoomChatId(raw);
  return chatId || null;
}

/**
 * Get group (room) by raw room id.
 * @param {object} existingStoreState - Current store snapshot
 * @param {string} roomId - Raw room id or "room:xxx"
 * @returns {object|undefined} Room snapshot or undefined
 */
export function selectGroupByRoomId(existingStoreState, roomId) {
  if (!existingStoreState || typeof existingStoreState !== "object") return undefined;
  const roomsById = existingStoreState.roomsById;
  if (!roomsById || typeof roomsById !== "object") return undefined;
  const raw = normalizeRoomId(roomId);
  if (!raw) return undefined;
  return roomsById[raw];
}

/**
 * Get group members for a room.
 * @param {object} existingStoreState - Current store snapshot
 * @param {string} roomId - Raw room id or "room:xxx"
 * @returns {string[]} Member user ids (empty array if missing)
 */
export function selectGroupMembers(existingStoreState, roomId) {
  if (!existingStoreState || typeof existingStoreState !== "object") return [];
  const membersByRoomId = existingStoreState.membersByRoomId;
  if (!membersByRoomId || typeof membersByRoomId !== "object") return [];
  const raw = normalizeRoomId(roomId);
  if (!raw) return [];
  const entry = membersByRoomId[raw];
  if (Array.isArray(entry)) return [...entry];
  if (entry && Array.isArray(entry.members)) return [...entry.members];
  return [];
}

/**
 * Get group roles for a room (userId -> role).
 * @param {object} existingStoreState - Current store snapshot
 * @param {string} roomId - Raw room id or "room:xxx"
 * @returns {Record<string, string>} Roles map (empty object if missing)
 */
export function selectGroupRoles(existingStoreState, roomId) {
  if (!existingStoreState || typeof existingStoreState !== "object") return {};
  const membersByRoomId = existingStoreState.membersByRoomId;
  if (!membersByRoomId || typeof membersByRoomId !== "object") return {};
  const raw = normalizeRoomId(roomId);
  if (!raw) return {};
  const entry = membersByRoomId[raw];
  if (entry && entry.roles && typeof entry.roles === "object") return { ...entry.roles };
  return {};
}
