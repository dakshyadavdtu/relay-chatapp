/**
 * Phase 3C: WS rooms API wrapper.
 * Sends WS messages with correlationId and awaits matching response or ERROR.
 * Normalizes responses for the store. Throws if ws not ready (no infinite spin).
 */

import { wsClient } from "@/transport/wsClient";

const DEFAULT_TIMEOUT_MS = 5000;

const pendingRequests = new Map();
let unsubscribe = null;

function generateCorrelationId() {
  return `room-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function ensureSubscribed() {
  if (unsubscribe) return;
  unsubscribe = wsClient.subscribe({
    handleMessage(msg) {
      const cid = msg.correlationId;
      if (cid == null) return;
      const entry = pendingRequests.get(cid);
      if (!entry) return;
      clearTimeout(entry.timeoutId);
      pendingRequests.delete(cid);

      if (msg.type === "ERROR" || msg.type === "MESSAGE_ERROR") {
        const err = new Error(msg.message || msg.error || msg.code || "Request failed");
        err.code = msg.code;
        err.correlationId = cid;
        entry.reject(err);
        return;
      }

      if (msg.type === "ROOM_CREATED" && msg.room) {
        entry.resolve(normalizeRoomSnapshot(msg.room));
        return;
      }
      if (msg.type === "ROOM_UPDATED") {
        entry.resolve({
          roomId: msg.roomId,
          patch: msg.patch,
          version: msg.version,
          updatedAt: msg.updatedAt,
        });
        return;
      }
      if (msg.type === "ROOM_MEMBERS_UPDATED") {
        entry.resolve({
          roomId: msg.roomId,
          members: msg.members ?? [],
          roles: msg.roles ?? {},
          version: msg.version,
          updatedAt: msg.updatedAt,
        });
        return;
      }
      if (msg.type === "ROOM_DELETED") {
        entry.resolve({ roomId: msg.roomId });
        return;
      }
      if (msg.type === "ROOM_LEAVE_RESPONSE" && msg.success) {
        entry.resolve({ roomId: msg.roomId, success: true });
        return;
      }
      if (msg.type === "ROOM_JOIN_RESPONSE" && msg.success) {
        entry.resolve({
          roomId: msg.roomId,
          success: true,
          roomInfo: msg.roomInfo,
          members: msg.members,
        });
        return;
      }
      if (msg.type === "ROOM_LIST_RESPONSE" && msg.success && Array.isArray(msg.rooms)) {
        entry.resolve(normalizeRoomList(msg.rooms));
        return;
      }
    },
  });
}

/**
 * Normalize backend room snapshot to { id, meta, members, roles, version, updatedAt }.
 */
function normalizeRoomSnapshot(room) {
  if (!room) return null;
  const id = room.id ?? room.roomId;
  const meta = room.meta ?? {};
  const members = Array.isArray(room.members) ? room.members : [];
  const roles = room.roles && typeof room.roles === "object" ? room.roles : {};
  return {
    id,
    meta: {
      name: meta.name ?? "",
      thumbnailUrl: meta.thumbnailUrl ?? null,
      createdAt: meta.createdAt,
      createdBy: meta.createdBy,
    },
    members,
    roles,
    version: room.version ?? 0,
    updatedAt: room.updatedAt ?? 0,
  };
}

/**
 * Normalize ROOM_LIST_RESPONSE.rooms to list shape.
 */
function normalizeRoomList(rooms) {
  if (!Array.isArray(rooms)) return [];
  return rooms.map((r) => ({
    id: r.id ?? r.roomId,
    name: r.name ?? "",
    thumbnailUrl: r.thumbnailUrl ?? null,
    memberCount: r.memberCount ?? 0,
    myRole: r.myRole ?? "MEMBER",
    version: r.version ?? 0,
    updatedAt: r.updatedAt ?? 0,
  }));
}

function sendAndWait(payload, responseHandler, timeoutMs = DEFAULT_TIMEOUT_MS) {
  if (!wsClient.isReady()) {
    throw new Error("WebSocket not ready");
  }
  ensureSubscribed();
  const cid = payload.correlationId ?? generateCorrelationId();
  const finalPayload = { ...payload, correlationId: cid };

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      if (pendingRequests.delete(cid)) {
        reject(new Error("Request timeout"));
      }
    }, timeoutMs);
    pendingRequests.set(cid, { resolve, reject, timeoutId });
    const sent = wsClient.send(finalPayload);
    if (!sent) {
      clearTimeout(timeoutId);
      pendingRequests.delete(cid);
      reject(new Error("Failed to send"));
    }
  });
}

export async function createRoom(payload) {
  const { name, thumbnailUrl, memberIds } = payload ?? {};
  return sendAndWait({
    type: "ROOM_CREATE",
    name: name ?? "",
    thumbnailUrl: thumbnailUrl ?? null,
    memberIds: Array.isArray(memberIds) ? memberIds : [],
  });
}

export async function updateRoomMeta(roomId, patch) {
  if (!roomId || !patch) throw new Error("roomId and patch required");
  return sendAndWait({
    type: "ROOM_UPDATE_META",
    roomId: String(roomId),
    patch: { name: patch.name, thumbnailUrl: patch.thumbnailUrl },
  });
}

export async function addMembers(roomId, userIds) {
  if (!roomId || !Array.isArray(userIds) || userIds.length === 0) {
    throw new Error("roomId and non-empty userIds required");
  }
  return sendAndWait({
    type: "ROOM_ADD_MEMBERS",
    roomId: String(roomId),
    userIds: userIds.map(String),
  });
}

export async function removeMember(roomId, userId) {
  if (!roomId || !userId) throw new Error("roomId and userId required");
  return sendAndWait({
    type: "ROOM_REMOVE_MEMBER",
    roomId: String(roomId),
    userId: String(userId),
  });
}

export async function setRole(roomId, userId, role) {
  if (!roomId || !userId || !role) throw new Error("roomId, userId and role required");
  if (role !== "ADMIN" && role !== "MEMBER") throw new Error("role must be ADMIN or MEMBER");
  return sendAndWait({
    type: "ROOM_SET_ROLE",
    roomId: String(roomId),
    userId: String(userId),
    role,
  });
}

export async function leaveRoom(roomId) {
  if (!roomId) throw new Error("roomId required");
  return sendAndWait({
    type: "ROOM_LEAVE",
    roomId: String(roomId),
  });
}

export async function deleteRoom(roomId) {
  if (!roomId) throw new Error("roomId required");
  return sendAndWait({
    type: "ROOM_DELETE",
    roomId: String(roomId),
  });
}

export async function getRoomInfo(roomId) {
  if (!roomId) throw new Error("roomId required");
  const snapshot = await sendAndWait({ type: "ROOM_INFO", roomId: String(roomId) });
  return snapshot;
}

export async function listRooms(includeAll = false) {
  const list = await sendAndWait({
    type: "ROOM_LIST",
    includeAll: !!includeAll,
  });
  return list;
}

export async function getRoomMembers(roomId) {
  if (!roomId) throw new Error("roomId required");
  const snapshot = await sendAndWait({ type: "ROOM_MEMBERS", roomId: String(roomId) });
  return snapshot;
}
