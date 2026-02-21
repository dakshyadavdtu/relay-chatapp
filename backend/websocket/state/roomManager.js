'use strict';

/**
 * Tier-1: sole owner of room/group state (Phase 3A).
 * WhatsApp-like model: members (Set), roles (OWNER/ADMIN/MEMBER), meta, version, updatedAt.
 * Join-order tracking for owner-leave transfer (oldest admin / oldest member).
 *
 * Data model per roomId:
 *   members: Set<userId>
 *   roles: Map<userId, "OWNER"|"ADMIN"|"MEMBER">
 *   meta: { name, thumbnailUrl?, createdAt, createdBy }
 *   updatedAt: number
 *   version: integer (monotonic)
 *   joinedAtByUser: Map<userId, number>  — join timestamp for "oldest" ordering
 *
 * RBAC: OWNER (full), ADMIN (meta, add, remove MEMBER only), MEMBER (view, send, leave).
 * Owner leave policy: transfer to oldest admin, else oldest member; if none left, room is deleted.
 *
 * See: backend/docs/ROOM_RBAC_MODEL.md
 */

const logger = require('../../utils/logger');
const monitoring = require('../../utils/monitoring');
const config = require('../../config/constants');
const roomStore = require('../../storage/room.store');

const ROLE_OWNER = 'OWNER';
const ROLE_ADMIN = 'ADMIN';
const ROLE_MEMBER = 'MEMBER';
const ROLES = Object.freeze([ROLE_OWNER, ROLE_ADMIN, ROLE_MEMBER]);

/**
 * @typedef {Object} RoomMeta
 * @property {string} name
 * @property {string|null} [thumbnailUrl]
 * @property {number} createdAt
 * @property {string} createdBy
 */

/**
 * @typedef {Object} RoomState
 * @property {Set<string>} members
 * @property {Map<string, string>} roles
 * @property {RoomMeta} meta
 * @property {number} updatedAt
 * @property {number} version
 * @property {Map<string, number>} joinedAtByUser
 */

/** @type {Map<string, RoomState>} */
const rooms = new Map();

/** Reverse index: userId -> Set<roomId> */
const userRooms = new Map();

function now() {
  return Date.now();
}

/**
 * Serialize in-memory room to store record (id, meta, members, roles, joinedAtByUser, version, updatedAt).
 * @param {string} roomId
 * @returns {Object|null}
 */
function toRoomStoreRecord(roomId) {
  const room = rooms.get(roomId);
  if (!room) return null;
  const rolesObj = {};
  for (const [uid, role] of room.roles) rolesObj[uid] = role;
  const joinedObj = {};
  for (const [uid, ts] of room.joinedAtByUser) joinedObj[uid] = ts;
  return {
    id: roomId,
    meta: { ...room.meta },
    members: Array.from(room.members),
    roles: rolesObj,
    joinedAtByUser: joinedObj,
    version: room.version,
    updatedAt: room.updatedAt,
  };
}

async function persistRoom(roomId) {
  const record = toRoomStoreRecord(roomId);
  if (record) await roomStore.upsertRoom(record);
}

/**
 * Load rooms from store into in-memory Maps. Call once at startup (e.g. server.js start()).
 */
async function loadFromStore() {
  rooms.clear();
  userRooms.clear();
  const list = await roomStore.getAllRooms();
  for (const record of list) {
    if (!record || !record.id) continue;
    const rawMembers = Array.isArray(record.members) ? record.members : [];
    const members = new Set(rawMembers.map((m) => String(m).trim()));
    const roles = new Map();
    if (record.roles && typeof record.roles === 'object') {
      for (const [uid, role] of Object.entries(record.roles)) roles.set(String(uid).trim(), role);
    }
    const joinedAtByUser = new Map();
    if (record.joinedAtByUser && typeof record.joinedAtByUser === 'object') {
      for (const [uid, ts] of Object.entries(record.joinedAtByUser)) joinedAtByUser.set(String(uid).trim(), ts);
    }
    const meta = record.meta && typeof record.meta === 'object'
      ? { ...record.meta }
      : { name: record.id, thumbnailUrl: null, createdAt: record.updatedAt || Date.now(), createdBy: '' };
    rooms.set(record.id, {
      members,
      roles,
      meta,
      updatedAt: typeof record.updatedAt === 'number' ? record.updatedAt : Date.now(),
      version: typeof record.version === 'number' ? record.version : 1,
      joinedAtByUser,
    });
    for (const userId of members) {
      const u = String(userId).trim();
      if (!userRooms.has(u)) userRooms.set(u, new Set());
      userRooms.get(u).add(record.id);
    }
  }
  logger.info('RoomManager', 'loaded_from_store', { count: rooms.size });
}

function bumpVersion(room) {
  room.version += 1;
  room.updatedAt = now();
}

/** Resolve member key (string or original) so lookup works regardless of type. */
function getMemberKey(room, userId) {
  if (userId == null) return null;
  const u = String(userId).trim();
  if (room.members.has(u)) return u;
  if (room.members.has(userId)) return userId;
  return null;
}

// ─── RBAC helpers (throw on failure) ─────────────────────────────────────────

/**
 * Throws if room does not exist or user is not a member.
 * @param {string} roomId
 * @param {string} userId
 * @returns {void}
 * @throws {Error}
 */
function assertMember(roomId, userId) {
  const room = rooms.get(roomId);
  if (!room) throw new Error('Room not found');
  if (!getMemberKey(room, userId)) throw new Error('User is not a member of this room');
}

/**
 * @param {string} roomId
 * @param {string} userId
 * @returns {string|null} 'OWNER'|'ADMIN'|'MEMBER' or null if not member
 */
function getRole(roomId, userId) {
  const room = rooms.get(roomId);
  if (!room) return null;
  const key = getMemberKey(room, userId);
  if (!key) return null;
  return room.roles.get(key) || ROLE_MEMBER;
}

/**
 * @param {string} actorRole
 * @throws {Error}
 */
function assertCanUpdateMeta(actorRole) {
  if (actorRole !== ROLE_OWNER && actorRole !== ROLE_ADMIN) {
    throw new Error('Only OWNER or ADMIN can update room meta');
  }
}

/**
 * @param {string} actorRole
 * @throws {Error}
 */
function assertCanAddMembers(actorRole) {
  if (actorRole !== ROLE_OWNER && actorRole !== ROLE_ADMIN) {
    throw new Error('Only OWNER or ADMIN can add members');
  }
}

/**
 * ADMIN can remove MEMBER only. OWNER can remove anyone.
 * @param {string} actorRole
 * @param {string} targetRole
 * @throws {Error}
 */
function assertCanRemoveMember(actorRole, targetRole) {
  if (actorRole === ROLE_OWNER) return;
  if (actorRole === ROLE_ADMIN && targetRole === ROLE_MEMBER) return;
  throw new Error('Insufficient permission to remove this member');
}

/**
 * ADMIN cannot set OWNER. OWNER can set any role.
 * @param {string} actorRole
 * @param {string} targetRole
 * @param {string} newRole
 * @throws {Error}
 */
function assertCanSetRole(actorRole, targetRole, newRole) {
  if (actorRole !== ROLE_OWNER && actorRole !== ROLE_ADMIN) {
    throw new Error('Only OWNER or ADMIN can change roles');
  }
  if (actorRole === ROLE_ADMIN && newRole === ROLE_OWNER) {
    throw new Error('ADMIN cannot promote to OWNER');
  }
  if (actorRole === ROLE_ADMIN && targetRole === ROLE_OWNER) {
    throw new Error('ADMIN cannot modify OWNER');
  }
  if (!ROLES.includes(newRole)) throw new Error('Invalid role');
}

/**
 * @param {string} actorRole
 * @throws {Error}
 */
function assertCanDelete(actorRole) {
  if (actorRole !== ROLE_OWNER) throw new Error('Only OWNER can delete the room');
}

// ─── Owner leave: transfer to oldest admin, else oldest member; else delete ───
// Policy (WhatsApp-like): when OWNER leaves, the "oldest" admin (by join time) becomes OWNER.
// If no admins, oldest remaining member becomes OWNER. If no members left, room is deleted.

async function transferOwnershipOrDelete(roomId, room) {
  const ownerId = Array.from(room.roles.entries()).find(([, r]) => r === ROLE_OWNER)?.[0];
  if (ownerId) return; // still has owner

  const entries = Array.from(room.joinedAtByUser.entries())
    .filter(([uid]) => room.members.has(uid))
    .sort((a, b) => a[1] - b[1]);

  if (entries.length === 0) {
    await deleteRoomInternal(roomId);
    return;
  }

  const [newOwnerId] = entries[0];
  const wasRole = room.roles.get(newOwnerId) || ROLE_MEMBER;
  room.roles.set(newOwnerId, ROLE_OWNER);
  bumpVersion(room);
  await persistRoom(roomId);
  logger.info('RoomManager', 'ownership_transferred', {
    roomId,
    newOwnerId,
    previousRole: wasRole,
    reason: 'owner_left',
  });
}

async function deleteRoomInternal(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  for (const userId of room.members) {
    const set = userRooms.get(userId);
    if (set) {
      set.delete(roomId);
      if (set.size === 0) userRooms.delete(userId);
    }
  }
  rooms.delete(roomId);
  await roomStore.deleteRoom(roomId);
  monitoring.increment('rooms', 'deleted');
  logger.info('RoomManager', 'room_deleted', { roomId });
}

// ─── Public API (keep stable) ────────────────────────────────────────────────

/**
 * Create a new room. Creator becomes OWNER and sole member.
 * @param {string} roomId
 * @param {string} creatorUserId
 * @param {Object} [options]
 * @param {string} [options.name]
 * @param {string|null} [options.thumbnailUrl]
 * @param {Object} [options.metadata] — legacy; not stored in meta
 * @returns {{ success: boolean, error?: string }}
 */
async function createRoom(roomId, creatorUserId, options = {}) {
  if (!roomId || typeof roomId !== 'string') {
    return { success: false, error: 'Room ID is required and must be a string' };
  }
  if (rooms.has(roomId)) {
    return { success: false, error: 'Room already exists' };
  }
  if (config.ROOMS.maxRooms > 0 && rooms.size >= config.ROOMS.maxRooms) {
    logger.warn('RoomManager', 'max_rooms_reached', { current: rooms.size, max: config.ROOMS.maxRooms });
    return { success: false, error: 'Maximum number of rooms reached' };
  }

  const ts = now();
  const creator = String(creatorUserId).trim();
  const members = new Set([creator]);
  const roles = new Map([[creator, ROLE_OWNER]]);
  const joinedAtByUser = new Map([[creator, ts]]);
  const meta = {
    name: options.name || roomId,
    thumbnailUrl: options.thumbnailUrl ?? null,
    createdAt: ts,
    createdBy: creatorUserId,
  };

  rooms.set(roomId, {
    members,
    roles,
    meta,
    updatedAt: ts,
    version: 1,
    joinedAtByUser,
  });

  if (!userRooms.has(creator)) userRooms.set(creator, new Set());
  userRooms.get(creator).add(roomId);

  // Persist in background so WS handler can return ROOM_CREATED immediately (avoids client timeout when DB is slow/unreachable)
  persistRoom(roomId).catch((err) => {
    logger.error('RoomManager', 'persist_failed', { roomId, error: err?.message || String(err) });
  });
  monitoring.increment('rooms', 'created');
  logger.info('RoomManager', 'room_created', { roomId, creatorUserId, name: meta.name });
  return { success: true };
}

/**
 * Delete a room. Caller should enforce RBAC (only OWNER).
 * @param {string} roomId
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
async function deleteRoom(roomId) {
  if (!rooms.has(roomId)) {
    return { success: false, error: 'Room not found' };
  }
  await deleteRoomInternal(roomId);
  return { success: true };
}

/**
 * Add user to room as MEMBER. Join order is recorded for owner-transfer.
 * Auto-create room if config.ROOMS.autoCreate and room missing.
 * @param {string} roomId
 * @param {string} userId
 * @returns {{ success: boolean, alreadyMember?: boolean, error?: string }}
 */
async function joinRoom(roomId, userId) {
  if (!roomId || !userId) {
    return { success: false, error: 'Room ID and user ID are required' };
  }

  if (!rooms.has(roomId)) {
    if (config.ROOMS.autoCreate) {
      const createResult = await createRoom(roomId, userId, {});
      if (!createResult.success) return createResult;
    } else {
      return { success: false, error: 'Room not found' };
    }
  }

  const room = rooms.get(roomId);
  if (config.ROOMS.maxMembersPerRoom > 0 && room.members.size >= config.ROOMS.maxMembersPerRoom) {
    logger.warn('RoomManager', 'room_full', { roomId, current: room.members.size, max: config.ROOMS.maxMembersPerRoom });
    return { success: false, error: 'Room is full' };
  }
  const u = String(userId).trim();
  if (room.members.has(u) || room.members.has(userId)) {
    return { success: true, alreadyMember: true };
  }

  const ts = now();
  room.members.add(u);
  room.roles.set(u, ROLE_MEMBER);
  room.joinedAtByUser.set(u, ts);
  bumpVersion(room);

  if (!userRooms.has(u)) userRooms.set(u, new Set());
  userRooms.get(u).add(roomId);

  persistRoom(roomId).catch((err) => {
    logger.error('RoomManager', 'persist_failed', { roomId, error: err?.message || String(err) });
  });
  monitoring.increment('rooms', 'joins');
  logger.info('RoomManager', 'user_joined', { roomId, userId, memberCount: room.members.size });
  return { success: true };
}

/**
 * Remove a user from the room. If OWNER leaves, ownership transfers to oldest admin then oldest member; empty room is deleted.
 * @param {string} roomId
 * @param {string} userId
 * @returns {{ success: boolean, error?: string }}
 */
async function leaveRoom(roomId, userId) {
  if (!roomId || !userId) {
    return { success: false, error: 'Room ID and user ID are required' };
  }
  if (!rooms.has(roomId)) {
    return { success: false, error: 'Room not found' };
  }

  const room = rooms.get(roomId);
  const memberKey = getMemberKey(room, userId);
  if (!memberKey) {
    return { success: false, error: 'User not in room' };
  }

  const wasOwner = (room.roles.get(memberKey) || ROLE_MEMBER) === ROLE_OWNER;
  room.members.delete(memberKey);
  room.roles.delete(memberKey);
  room.joinedAtByUser.delete(memberKey);
  bumpVersion(room);

  const u = String(userId).trim();
  const userSet = userRooms.get(memberKey) || userRooms.get(u) || userRooms.get(userId);
  if (userSet) {
    userSet.delete(roomId);
    if (userSet.size === 0) {
      userRooms.delete(memberKey);
      userRooms.delete(u);
      userRooms.delete(userId);
    }
  }

  monitoring.increment('rooms', 'leaves');
  logger.info('RoomManager', 'user_left', { roomId, userId, memberCount: room.members.size, wasOwner });

  if (wasOwner) {
    await transferOwnershipOrDelete(roomId, room);
  }
  if (room.members.size === 0 && config.ROOMS.autoDeleteEmpty) {
    await deleteRoomInternal(roomId);
  } else {
    await persistRoom(roomId);
  }

  return { success: true };
}

/**
 * Get room members (array of userId).
 * @param {string} roomId
 * @returns {string[]}
 */
function getRoomMembers(roomId) {
  if (!rooms.has(roomId)) return [];
  return Array.from(rooms.get(roomId).members);
}

/**
 * Get room IDs the user is in.
 * @param {string} userId
 * @returns {string[]}
 */
function getUserRooms(userId) {
  if (!userRooms.has(userId)) return [];
  return Array.from(userRooms.get(userId));
}

/**
 * @param {string} roomId
 * @param {string} userId
 * @returns {boolean}
 */
function isRoomMember(roomId, userId) {
  if (!roomId || userId == null) return false;
  const r = String(roomId).trim();
  const u = String(userId).trim();
  const room = rooms.get(r) || rooms.get(roomId);
  if (!room) return false;
  return room.members.has(u) || room.members.has(userId);
}

/**
 * Legacy room info (backward compatible).
 * @param {string} roomId
 * @returns {Object|null}
 */
function getRoomInfo(roomId) {
  const room = rooms.get(roomId);
  if (!room) return null;
  return {
    roomId,
    ...room.meta,
    createdAt: room.meta.createdAt,
    createdBy: room.meta.createdBy,
    name: room.meta.name,
    thumbnailUrl: room.meta.thumbnailUrl ?? null,
    memberCount: room.members.size,
    version: room.version,
    updatedAt: room.updatedAt,
  };
}

/**
 * Full snapshot for UI: id, meta, version, updatedAt, members, roles.
 * @param {string} roomId
 * @returns {{ id: string, meta: RoomMeta, version: number, updatedAt: number, members: string[], roles: Object }|null}
 */
function getRoomSnapshot(roomId) {
  const room = rooms.get(roomId);
  if (!room) return null;
  const rolesObj = {};
  for (const [uid, role] of room.roles) {
    rolesObj[uid] = role;
  }
  return {
    id: roomId,
    meta: { ...room.meta },
    version: room.version,
    updatedAt: room.updatedAt,
    members: Array.from(room.members),
    roles: rolesObj,
  };
}

/**
 * Lightweight list for a user: rooms they are in with summary.
 * @param {string} userId
 * @returns {Array<{ id: string, name: string, thumbnailUrl: string|null, memberCount: number, myRole: string, version: number, updatedAt: number }>}
 */
function listRoomsForUser(userId) {
  const roomIds = getUserRooms(userId);
  const out = [];
  for (const id of roomIds) {
    const room = rooms.get(id);
    if (!room) continue;
    const myRole = room.roles.get(userId) || ROLE_MEMBER;
    out.push({
      id,
      name: room.meta.name,
      thumbnailUrl: room.meta.thumbnailUrl ?? null,
      memberCount: room.members.size,
      myRole,
      version: room.version,
      updatedAt: room.updatedAt,
    });
  }
  return out;
}

/**
 * Update room meta (name, thumbnailUrl). RBAC: OWNER or ADMIN.
 * @param {string} roomId
 * @param {string} actorUserId
 * @param {{ name?: string, thumbnailUrl?: string|null }} metaPatch
 * @returns {{ success: boolean, error?: string }}
 */
async function updateRoomMeta(roomId, actorUserId, metaPatch) {
  try {
    assertMember(roomId, actorUserId);
    const actorRole = getRole(roomId, actorUserId);
    assertCanUpdateMeta(actorRole);
  } catch (e) {
    return { success: false, error: e.message };
  }
  const room = rooms.get(roomId);
  if (!room) return { success: false, error: 'Room not found' };
  const maxName = config.MAX_ROOM_NAME_LENGTH ?? 200;
  const maxUrl = config.MAX_THUMBNAIL_URL_LENGTH ?? 2048;
  if (metaPatch.name !== undefined) room.meta.name = String(metaPatch.name).trim().slice(0, maxName);
  if (metaPatch.thumbnailUrl !== undefined) room.meta.thumbnailUrl = metaPatch.thumbnailUrl == null ? null : String(metaPatch.thumbnailUrl).trim().slice(0, maxUrl) || null;
  bumpVersion(room);
  await persistRoom(roomId);
  return { success: true };
}

/**
 * Remove a member (RBAC: OWNER can remove anyone; ADMIN can remove MEMBER only).
 * @param {string} roomId
 * @param {string} actorUserId
 * @param {string} targetUserId
 * @returns {{ success: boolean, error?: string }}
 */
async function removeMember(roomId, actorUserId, targetUserId) {
  try {
    assertMember(roomId, actorUserId);
    assertMember(roomId, targetUserId);
    const actorRole = getRole(roomId, actorUserId);
    const targetRole = getRole(roomId, targetUserId);
    assertCanRemoveMember(actorRole, targetRole);
  } catch (e) {
    return { success: false, error: e.message };
  }
  return await leaveRoom(roomId, targetUserId);
}

/**
 * Set a member's role. RBAC: OWNER can set any; ADMIN cannot set OWNER.
 * @param {string} roomId
 * @param {string} actorUserId
 * @param {string} targetUserId
 * @param {string} newRole
 * @returns {{ success: boolean, error?: string }}
 */
async function setMemberRole(roomId, actorUserId, targetUserId, newRole) {
  try {
    assertMember(roomId, actorUserId);
    assertMember(roomId, targetUserId);
    const actorRole = getRole(roomId, actorUserId);
    const targetRole = getRole(roomId, targetUserId);
    assertCanSetRole(actorRole, targetRole, newRole);
  } catch (e) {
    return { success: false, error: e.message };
  }
  const room = rooms.get(roomId);
  if (!room) return { success: false, error: 'Room not found' };
  room.roles.set(targetUserId, newRole);
  bumpVersion(room);
  await persistRoom(roomId);
  return { success: true };
}

/**
 * Get all rooms (legacy). Returns room info list.
 * @returns {Array}
 */
function getAllRooms() {
  const result = [];
  for (const [roomId, room] of rooms) {
    result.push({
      roomId,
      ...room.meta,
      memberCount: room.members.size,
      version: room.version,
      updatedAt: room.updatedAt,
    });
  }
  return result;
}

/**
 * Broadcast message to room members.
 * @param {string} roomId
 * @param {Object} message
 * @param {string|null} [excludeUserId]
 * @returns {{ success: boolean, sentCount: number, memberCount: number, error?: string }}
 */
function broadcastToRoom(roomId, message, excludeUserId = null) {
  if (!rooms.has(roomId)) {
    return { success: false, error: 'Room not found' };
  }
  const connectionManager = require('../connection/connectionManager');
  // Use backpressure + flowControl to avoid circular dependency (socketSafety -> backpressure -> message.store -> replay -> roomManager)
  const backpressure = require('../safety/backpressure');
  const flowControl = require('../safety/flowControl');
  const members = rooms.get(roomId).members;
  const memberCount = members.size;
  let sentCount = 0;
  for (const userId of members) {
    if (excludeUserId && userId === excludeUserId) continue;
    const sockets = connectionManager.getSockets(userId);
    for (const ws of sockets) {
      const result = backpressure.sendMessage(ws, message);
      if (result.shouldClose) {
        flowControl.closeAbusiveConnection(ws, 'Slow consumer: queue overflow', 1008);
        continue;
      }
      if (result.queued) sentCount += 1;
    }
  }
  monitoring.increment('rooms', 'broadcasts');
  return { success: true, sentCount, memberCount };
}

function getStats() {
  return {
    totalRooms: rooms.size,
    totalMembers: Array.from(userRooms.values()).reduce((sum, set) => sum + set.size, 0),
    rooms: rooms.size,
  };
}

/**
 * Clear all rooms (testing).
 */
function clear() {
  rooms.clear();
  userRooms.clear();
}

/**
 * Self-check for Phase 3A: create -> add members -> set role -> remove -> owner leave -> snapshot.
 * Call from dev script or test. Returns true if all checks pass.
 * @returns {boolean}
 */
function selfCheck() {
  clear();
  const roomId = 'selfcheck-room';
  const owner = 'user-owner';
  const admin = 'user-admin';
  const member = 'user-member';

  const cr = createRoom(roomId, owner, { name: 'Test' });
  if (!cr.success) return false;
  if (!isRoomMember(roomId, owner)) return false;
  if (getRole(roomId, owner) !== ROLE_OWNER) return false;

  joinRoom(roomId, admin);
  joinRoom(roomId, member);
  if (getRoomMembers(roomId).length !== 3) return false;

  const setAdmin = setMemberRole(roomId, owner, admin, ROLE_ADMIN);
  if (!setAdmin.success) return false;
  if (getRole(roomId, admin) !== ROLE_ADMIN) return false;

  const removeM = removeMember(roomId, owner, member);
  if (!removeM.success) return false;
  if (isRoomMember(roomId, member)) return false;

  const snap = getRoomSnapshot(roomId);
  if (!snap || snap.members.length !== 2 || snap.version < 1) return false;

  leaveRoom(roomId, owner);
  const roomAfter = rooms.get(roomId);
  if (!roomAfter) return false;
  const newOwner = getRole(roomId, admin);
  if (newOwner !== ROLE_OWNER) return false;

  leaveRoom(roomId, admin);
  if (rooms.has(roomId)) return false;

  clear();
  return true;
}

module.exports = {
  ROLE_OWNER,
  ROLE_ADMIN,
  ROLE_MEMBER,
  ROLES,
  createRoom,
  deleteRoom,
  joinRoom,
  leaveRoom,
  getRoomMembers,
  getUserRooms,
  isRoomMember,
  getRole,
  getRoomInfo,
  getRoomSnapshot,
  listRoomsForUser,
  getAllRooms,
  broadcastToRoom,
  getStats,
  clear,
  loadFromStore,
  assertMember,
  assertCanUpdateMeta,
  assertCanAddMembers,
  assertCanRemoveMember,
  assertCanSetRole,
  assertCanDelete,
  updateRoomMeta,
  removeMember,
  setMemberRole,
  selfCheck,
};
