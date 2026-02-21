/**
 * Phase 2 Fix A: Group-style compatibility API.
 * Maps groupId === roomId; groups are rooms viewed through a group UI lens.
 * Uses existing rooms.ws.js (WS) and no mock data.
 * Thumbnail: pass File in payload.file or payload.thumbnail → upload then createRoom with thumbnailUrl.
 */

import * as roomsApi from "./rooms.ws.js";
import { uploadImage } from "./upload.api.js";

function toGroupListItem(room) {
  if (!room) return null;
  const id = room.id ?? room.roomId;
  const name = room.name ?? room.meta?.name ?? "";
  const thumbnailUrl = room.thumbnailUrl ?? room.meta?.thumbnailUrl ?? null;
  return { id, name, thumbnailUrl };
}

function toGroupInfo(snapshot) {
  if (!snapshot) return null;
  const id = snapshot.id ?? snapshot.roomId;
  const meta = snapshot.meta ?? {};
  const members = Array.isArray(snapshot.members) ? snapshot.members : [];
  return {
    id,
    name: meta.name ?? "",
    thumbnailUrl: meta.thumbnailUrl ?? null,
    createdBy: meta.createdBy ?? null,
    members: members.map((m) => (typeof m === "string" ? { userId: m, role: "MEMBER" } : { ...m, userId: m.userId ?? m.id ?? m })),
  };
}

function toGroupMembersResponse(result) {
  if (!result) return [];
  const members = result.members ?? [];
  const roles = result.roles ?? {};
  return members.map((userId) => ({
    userId: String(userId),
    role: roles[userId] ?? "MEMBER",
  }));
}

function normalizeRole(role) {
  if (role === "admin" || role === "ADMIN") return "ADMIN";
  if (role === "member" || role === "MEMBER") return "MEMBER";
  return "MEMBER";
}

async function safeCall(fn) {
  try {
    const result = await fn();
    return { ok: true, data: result };
  } catch (e) {
    const msg = e?.message === "WebSocket not ready" ? "WebSocket not ready" : e?.message === "Request timeout" ? "Request timeout" : e?.message === "Failed to send" ? "Failed to send" : e?.code ?? e?.message ?? "Request failed";
    return { ok: false, error: msg };
  }
}

/**
 * List groups (rooms). Uses ROOM_LIST over WS.
 */
export async function listGroups() {
  const out = await safeCall(() => roomsApi.listRooms());
  if (!out.ok) return out;
  const list = Array.isArray(out.data) ? out.data : [];
  return { ok: true, data: list.map(toGroupListItem).filter(Boolean) };
}

/**
 * Create a group (room). Payload: { name?, thumbnailUrl?, file?, thumbnail?, memberIds? }.
 * If file or thumbnail is a File, uploads it first and uses returned url as thumbnailUrl.
 */
export async function createGroup(payload) {
  const p = payload ?? {};
  let thumbnailUrl = p.thumbnailUrl ?? null;
  const file = p.file ?? p.thumbnail;
  if (file && typeof file === "object" && typeof file.constructor?.name === "string" && file.constructor.name === "File") {
    try {
      const { url } = await uploadImage(file);
      thumbnailUrl = url;
    } catch (e) {
      return { ok: false, error: e?.message ?? "Upload failed" };
    }
  }
  const out = await safeCall(() =>
    roomsApi.createRoom({
      name: p.name ?? "",
      thumbnailUrl,
      memberIds: Array.isArray(p.memberIds) ? p.memberIds : [],
    })
  );
  if (!out.ok) return out;
  const room = out.data;
  return { ok: true, data: toGroupInfo(room) ?? toGroupListItem(room) ?? room };
}

/**
 * Update group (room) metadata. Patch: { name?, thumbnailUrl?, file?, thumbnail? }.
 * If file or thumbnail is a File, uploads it first and uses returned url as thumbnailUrl.
 */
export async function updateGroupMeta(groupId, patch) {
  if (!groupId || !patch || typeof patch !== "object") return { ok: false, error: "Invalid groupId or patch" };
  let thumbnailUrl = patch.thumbnailUrl ?? undefined;
  const file = patch.file ?? patch.thumbnail;
  if (file && typeof file === "object" && typeof file.constructor?.name === "string" && file.constructor.name === "File") {
    try {
      const { url } = await uploadImage(file);
      thumbnailUrl = url;
    } catch (e) {
      return { ok: false, error: e?.message ?? "Upload failed" };
    }
  }
  const metaPatch = { name: patch.name, thumbnailUrl };
  const out = await safeCall(() => roomsApi.updateRoomMeta(String(groupId), metaPatch));
  if (!out.ok) return out;
  return { ok: true, data: out.data };
}

/**
 * Add members to a group (room).
 */
export async function addGroupMembers(groupId, memberIds) {
  if (!groupId) return { ok: false, error: "Invalid groupId" };
  if (!Array.isArray(memberIds) || memberIds.length === 0) return { ok: false, error: "memberIds required" };
  const out = await safeCall(() => roomsApi.addMembers(String(groupId), memberIds));
  if (!out.ok) return out;
  return { ok: true, data: out.data };
}

/**
 * Remove a member from a group (room).
 */
export async function removeGroupMember(groupId, memberId) {
  if (!groupId || !memberId) return { ok: false, error: "Invalid groupId or memberId" };
  const out = await safeCall(() => roomsApi.removeMember(String(groupId), String(memberId)));
  if (!out.ok) return out;
  return { ok: true, data: out.data };
}

/**
 * Set a member's role in a group (room). role: "admin" | "member" | "ADMIN" | "MEMBER".
 */
export async function setGroupRole(groupId, memberId, role) {
  if (!groupId || !memberId || !role) return { ok: false, error: "Invalid groupId, memberId or role" };
  const backendRole = normalizeRole(role);
  const out = await safeCall(() => roomsApi.setRole(String(groupId), String(memberId), backendRole));
  if (!out.ok) return out;
  return { ok: true, data: out.data };
}

/**
 * Leave a group (room).
 */
export async function leaveGroup(groupId) {
  if (!groupId) return { ok: false, error: "Invalid groupId" };
  const out = await safeCall(() => roomsApi.leaveRoom(String(groupId)));
  if (!out.ok) return out;
  return { ok: true, data: out.data };
}

/**
 * Delete a group (room).
 */
export async function deleteGroup(groupId) {
  if (!groupId) return { ok: false, error: "Invalid groupId" };
  const out = await safeCall(() => roomsApi.deleteRoom(String(groupId)));
  if (!out.ok) return out;
  return { ok: true, data: out.data };
}

/**
 * Get group (room) info. Uses ROOM_INFO over WS.
 */
export async function getGroupInfo(groupId) {
  if (!groupId) return { ok: false, error: "Invalid groupId" };
  const out = await safeCall(() => roomsApi.getRoomInfo(String(groupId)));
  if (!out.ok) return out;
  const info = toGroupInfo(out.data);
  return { ok: true, data: info ?? { id: groupId, name: "", thumbnailUrl: null, createdBy: null, members: [] } };
}

/**
 * Get group (room) members. Uses ROOM_MEMBERS over WS.
 */
export async function getGroupMembers(groupId) {
  if (!groupId) return { ok: false, error: "Invalid groupId" };
  const out = await safeCall(() => roomsApi.getRoomMembers(String(groupId)));
  if (!out.ok) return out;
  const members = toGroupMembersResponse(out.data);
  return { ok: true, data: members };
}
