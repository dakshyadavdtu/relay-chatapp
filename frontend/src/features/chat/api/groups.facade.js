/**
 * Group facade: speaks backend WS/HTTP via existing room APIs.
 * All functions delegate to rooms.ws.js; no direct wsClient usage unless a thin wrapper is needed.
 */
import * as rooms from "./rooms.ws.js";
import { normalizeRoomId } from "../group/identity.js";

/**
 * List groups (rooms). Uses rooms.ws list.
 * @param {boolean} [includeAll=false]
 * @returns {Promise<Array>} List of room summaries
 */
export async function listGroups(includeAll = false) {
  return rooms.listRooms(includeAll);
}

/**
 * Get group (room) info. Uses rooms.ws ROOM_INFO.
 * @param {string} roomId - Raw room id or "room:xxx"
 * @returns {Promise<object|null>} Room snapshot or null
 */
export async function getGroupInfo(roomId) {
  const raw = normalizeRoomId(roomId);
  if (!raw) throw new Error("roomId required");
  return rooms.getRoomInfo(raw);
}

/**
 * Get group members. Uses rooms.ws ROOM_MEMBERS.
 * @param {string} roomId - Raw room id or "room:xxx"
 * @returns {Promise<object>} { members, roles } or response shape
 */
export async function getGroupMembers(roomId) {
  const raw = normalizeRoomId(roomId);
  if (!raw) throw new Error("roomId required");
  return rooms.getRoomMembers(raw);
}

/**
 * Add members to group. Uses rooms.ws ROOM_ADD_MEMBERS.
 * @param {string} roomId - Raw room id or "room:xxx"
 * @param {string[]} userIds
 */
export async function addGroupMembers(roomId, userIds) {
  const raw = normalizeRoomId(roomId);
  if (!raw) throw new Error("roomId required");
  return rooms.addMembers(raw, userIds);
}

/**
 * Remove a member from group. Uses rooms.ws ROOM_REMOVE_MEMBER.
 * @param {string} roomId - Raw room id or "room:xxx"
 * @param {string} userId
 */
export async function removeGroupMember(roomId, userId) {
  const raw = normalizeRoomId(roomId);
  if (!raw) throw new Error("roomId required");
  return rooms.removeMember(raw, userId);
}

/**
 * Set a member's role. Uses rooms.ws ROOM_SET_ROLE.
 * @param {string} roomId - Raw room id or "room:xxx"
 * @param {string} userId
 * @param {string} role - "ADMIN" | "MEMBER"
 */
export async function setGroupRole(roomId, userId, role) {
  const raw = normalizeRoomId(roomId);
  if (!raw) throw new Error("roomId required");
  return rooms.setRole(raw, userId, role);
}

/**
 * Leave group. Uses rooms.ws ROOM_LEAVE.
 * @param {string} roomId - Raw room id or "room:xxx"
 */
export async function leaveGroup(roomId) {
  const raw = normalizeRoomId(roomId);
  if (!raw) throw new Error("roomId required");
  return rooms.leaveRoom(raw);
}

/**
 * Delete group. Uses rooms.ws ROOM_DELETE.
 * @param {string} roomId - Raw room id or "room:xxx"
 */
export async function deleteGroup(roomId) {
  const raw = normalizeRoomId(roomId);
  if (!raw) throw new Error("roomId required");
  return rooms.deleteRoom(raw);
}

/**
 * Update group (room) metadata. Uses rooms.ws ROOM_UPDATE_META.
 * @param {string} roomId - Raw room id or "room:xxx"
 * @param {{ name?: string, thumbnailUrl?: string | null }} patch
 */
export async function updateGroupMeta(roomId, patch) {
  const raw = normalizeRoomId(roomId);
  if (!raw) throw new Error("roomId required");
  return rooms.updateRoomMeta(raw, patch ?? {});
}
