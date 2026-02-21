'use strict';

/**
 * Room handler - thin orchestration only.
 * Phase 3B: RBAC-enforced room/group actions via WS; correlationId echoed; broadcast on mutations.
 * Delegates to group.service and roomManager.
 */

const crypto = require('crypto');
const connectionManager = require('../connection/connectionManager');
const roomManager = require('../state/roomManager');
const groupService = require('../services/group.service');
const { sendToUserSocket } = require('../services/message.service');
const logger = require('../../utils/logger');
const ErrorCodes = require('../../utils/errorCodes');
const { MAX_CONTENT_LENGTH, MAX_ROOM_NAME_LENGTH, MAX_THUMBNAIL_URL_LENGTH } = require('../../config/constants');
const userStore = require('../../storage/user.store');
const { ROLES } = require('../../auth/roles');

const ROOM_CREATED = 'ROOM_CREATED';
const ROOM_UPDATED = 'ROOM_UPDATED';
const ROOM_MEMBERS_UPDATED = 'ROOM_MEMBERS_UPDATED';
const ROOM_DELETED = 'ROOM_DELETED';
const ERROR = 'ERROR';

const ROOM_ID_PREFIX = 'room_';

function generateRoomId() {
  return ROOM_ID_PREFIX + Date.now().toString(36) + '_' + (crypto.randomBytes(6).toString('hex'));
}

function errResponse(correlationId, code, message) {
  return { type: ERROR, correlationId: correlationId ?? null, code: code || 'ERROR', message: message || 'Error' };
}

/** Audit log when a room action is denied (authorization or not-found). Call before returning errResponse for FORBIDDEN/NOT_FOUND. */
function auditDenied(action, userId, roomId, code, message, extra = {}) {
  if (code === 'FORBIDDEN' || code === 'NOT_FOUND') {
    logger.warn('RoomEngine', 'action_denied', { action, userId, roomId: roomId ?? null, code, message, ...extra });
  }
}

function broadcastRoomMutation(roomId, message) {
  roomManager.broadcastToRoom(roomId, message);
}

/** Build ROOM_MEMBERS_UPDATED payload from snapshot (includes meta so clients get room name without extra request). */
function buildRoomMembersUpdatedPayload(snap) {
  return {
    type: ROOM_MEMBERS_UPDATED,
    roomId: snap.id,
    members: snap.members,
    roles: snap.roles,
    version: snap.version,
    updatedAt: snap.updatedAt,
    name: snap.meta?.name ?? null,
    thumbnailUrl: snap.meta?.thumbnailUrl ?? null,
  };
}

/**
 * Handle ROOM_CREATE message.
 * Phase 3B: roomId optional (server-generated if omitted); memberIds[] added after create; returns ROOM_CREATED with snapshot.
 */
async function handleRoomCreate(ws, payload, context = {}) {
  const userId = connectionManager.getUserId(ws);
  const correlationId = payload.correlationId ?? context.correlationId ?? null;

  if (!userId) {
    return errResponse(correlationId, 'UNAUTHORIZED', 'Not authenticated');
  }

  const roomId = payload.roomId || generateRoomId();
  const rawName = payload.name || roomId;
  const name = String(rawName).trim().slice(0, MAX_ROOM_NAME_LENGTH);
  const rawThumb = payload.thumbnailUrl ?? null;
  const thumbnailUrl = rawThumb == null ? null : String(rawThumb).trim().slice(0, MAX_THUMBNAIL_URL_LENGTH) || null;
  const memberIds = Array.isArray(payload.memberIds) ? [...new Set(payload.memberIds)] : [];

  const result = await roomManager.createRoom(roomId, userId, { name, thumbnailUrl });

  if (!result.success) {
    return errResponse(correlationId, result.error === 'Room already exists' ? 'VALIDATION_ERROR' : 'CREATE_FAILED', result.error);
  }

  for (const uid of memberIds) {
    if (uid === userId) continue;
    await roomManager.joinRoom(roomId, uid);
  }

  const snapshot = roomManager.getRoomSnapshot(roomId);
  broadcastRoomMutation(roomId, buildRoomMembersUpdatedPayload(snapshot));

  logger.info('RoomEngine', 'room_created', { correlationId, roomId, userId, name });
  return { type: ROOM_CREATED, correlationId, room: snapshot };
}

/**
 * Handle ROOM_JOIN message (existing; backward compatible).
 */
async function handleRoomJoin(ws, payload, context = {}) {
  const userId = connectionManager.getUserId(ws);
  const correlationId = payload.correlationId ?? context.correlationId ?? null;

  if (!userId) {
    return errResponse(correlationId, 'UNAUTHORIZED', 'Not authenticated');
  }

  const { roomId } = payload;
  if (!roomId) {
    return errResponse(correlationId, 'VALIDATION_ERROR', 'Room ID is required');
  }

  const result = await roomManager.joinRoom(roomId, userId);
  if (!result.success) {
    const code = result.error === 'Room not found' ? 'NOT_FOUND' : 'JOIN_FAILED';
    auditDenied('ROOM_JOIN', userId, roomId, code, result.error);
    return errResponse(correlationId, code, result.error);
  }

  if (!result.alreadyMember) {
    roomManager.broadcastToRoom(roomId, { type: 'ROOM_MEMBER_JOINED', roomId, userId, timestamp: Date.now() }, userId);
    const snap = roomManager.getRoomSnapshot(roomId);
    if (snap) {
      broadcastRoomMutation(roomId, {
        type: ROOM_MEMBERS_UPDATED,
        roomId,
        members: snap.members,
        roles: snap.roles,
        version: snap.version,
        updatedAt: snap.updatedAt,
      });
    }
  }

  const roomInfo = roomManager.getRoomInfo(roomId);
  return {
    type: 'ROOM_JOIN_RESPONSE',
    success: true,
    roomId,
    roomInfo,
    members: roomManager.getRoomMembers(roomId),
    alreadyMember: result.alreadyMember || false,
    timestamp: Date.now(),
    correlationId,
  };
}

/**
 * Handle ROOM_LEAVE message. Broadcasts ROOM_MEMBERS_UPDATED to remaining members.
 */
async function handleRoomLeave(ws, payload, context = {}) {
  const userId = connectionManager.getUserId(ws);
  const correlationId = payload.correlationId ?? context.correlationId ?? null;

  if (!userId) return errResponse(correlationId, 'UNAUTHORIZED', 'Not authenticated');
  const { roomId } = payload;
  if (!roomId) return errResponse(correlationId, 'VALIDATION_ERROR', 'Room ID is required');

  try {
    roomManager.assertMember(roomId, userId);
  } catch (e) {
    auditDenied('ROOM_LEAVE', userId, roomId, 'NOT_FOUND', e.message);
    return errResponse(correlationId, 'NOT_FOUND', e.message);
  }

  roomManager.broadcastToRoom(roomId, { type: 'ROOM_MEMBER_LEFT', roomId, userId, timestamp: Date.now() }, userId);
  const result = await roomManager.leaveRoom(roomId, userId);
  if (!result.success) {
    return errResponse(correlationId, 'LEAVE_FAILED', result.error);
  }

  const snap = roomManager.getRoomSnapshot(roomId);
  if (snap) {
    broadcastRoomMutation(roomId, buildRoomMembersUpdatedPayload(snap));
  }

  logger.info('RoomEngine', 'user_left_room', { correlationId, roomId, userId });
  return { type: 'ROOM_LEAVE_RESPONSE', success: true, roomId, timestamp: Date.now(), correlationId };
}

/**
 * Handle ROOM_MESSAGE - validate, delegate to groupService.
 */
async function handleRoomMessage(ws, payload, context = {}) {
  const userId = connectionManager.getUserId(ws);
  if (!userId) {
    return { type: 'ROOM_MESSAGE_RESPONSE', success: false, error: 'Not authenticated', code: ErrorCodes.UNAUTHORIZED };
  }
  const { roomId, content, clientMessageId, messageType } = payload;
  if (!roomId) {
    return { type: 'ROOM_MESSAGE_RESPONSE', success: false, error: 'Room ID is required', code: ErrorCodes.MISSING_ROOM_ID };
  }
  if (!content || typeof content !== 'string') {
    return { type: 'ROOM_MESSAGE_RESPONSE', success: false, error: 'Content is required', code: ErrorCodes.MISSING_CONTENT };
  }
  if (content.length > MAX_CONTENT_LENGTH) {
    return { type: 'ROOM_MESSAGE_RESPONSE', success: false, error: `Content exceeds maximum length of ${MAX_CONTENT_LENGTH} characters`, code: ErrorCodes.CONTENT_TOO_LONG };
  }
  if (!roomManager.isRoomMember(roomId, userId)) {
    return { type: 'ROOM_MESSAGE_RESPONSE', success: false, error: 'Not a member of this room', code: ErrorCodes.NOT_A_MEMBER, roomId };
  }
  const correlationId = context.correlationId || null;
  const result = await groupService.sendRoomMessage(userId, roomId, content, clientMessageId, messageType, { correlationId, originSocket: ws });
  if (!result.success && result.error) {
    return { type: 'ROOM_MESSAGE_RESPONSE', success: false, error: result.error, code: ErrorCodes.BROADCAST_FAILED, roomId };
  }
  // Message already persisted (and MPS counted once) in groupService via message.service; no duplicate persist/track.
  return result;
}

/**
 * Handle ROOM_INFO message. RBAC: must be member. Returns ROOM_CREATED-style snapshot.
 */
function handleRoomInfo(ws, payload, context = {}) {
  const userId = connectionManager.getUserId(ws);
  const correlationId = payload.correlationId ?? context.correlationId ?? null;

  if (!userId) return errResponse(correlationId, 'UNAUTHORIZED', 'Not authenticated');
  const { roomId } = payload;
  if (!roomId) return errResponse(correlationId, 'VALIDATION_ERROR', 'Room ID is required');

  const snapshot = roomManager.getRoomSnapshot(roomId);
  if (!snapshot) {
    auditDenied('ROOM_INFO', userId, roomId, 'NOT_FOUND', 'Room not found');
    return errResponse(correlationId, 'NOT_FOUND', 'Room not found');
  }
  try {
    roomManager.assertMember(roomId, userId);
  } catch (e) {
    auditDenied('ROOM_INFO', userId, roomId, 'FORBIDDEN', e.message);
    return errResponse(correlationId, 'FORBIDDEN', 'Not a member of this room');
  }

  return { type: ROOM_CREATED, correlationId, room: snapshot };
}

/**
 * Handle ROOM_LIST message. Returns listRoomsForUser (or all rooms if includeAll).
 */
async function handleRoomList(ws, payload, context = {}) {
  const userId = connectionManager.getUserId(ws);
  const correlationId = payload.correlationId ?? context.correlationId ?? null;

  if (!userId) return errResponse(correlationId, 'UNAUTHORIZED', 'Not authenticated');

  const { includeAll } = payload;
  if (includeAll) {
    const user = await userStore.findById(userId);
    const role = user?.role;
    if (role !== ROLES.ADMIN) {
      auditDenied('ROOM_LIST', userId, null, 'FORBIDDEN', 'includeAll not allowed', { includeAll: true });
      return errResponse(correlationId, 'FORBIDDEN', 'includeAll not allowed');
    }
  }
  const rooms = includeAll
    ? roomManager.getAllRooms()
    : roomManager.listRoomsForUser(userId);

  return {
    type: 'ROOM_LIST_RESPONSE',
    success: true,
    rooms,
    count: rooms.length,
    timestamp: Date.now(),
    correlationId,
  };
}

/**
 * Handle ROOM_MEMBERS message. RBAC: must be member. Returns ROOM_CREATED-style snapshot.
 */
function handleRoomMembers(ws, payload, context = {}) {
  const userId = connectionManager.getUserId(ws);
  const correlationId = payload.correlationId ?? context.correlationId ?? null;

  if (!userId) return errResponse(correlationId, 'UNAUTHORIZED', 'Not authenticated');
  const { roomId } = payload;
  if (!roomId) return errResponse(correlationId, 'VALIDATION_ERROR', 'Room ID is required');

  const snapshot = roomManager.getRoomSnapshot(roomId);
  if (!snapshot) {
    auditDenied('ROOM_MEMBERS', userId, roomId, 'NOT_FOUND', 'Room not found');
    return errResponse(correlationId, 'NOT_FOUND', 'Room not found');
  }
  try {
    roomManager.assertMember(roomId, userId);
  } catch (e) {
    auditDenied('ROOM_MEMBERS', userId, roomId, 'FORBIDDEN', e.message);
    return errResponse(correlationId, 'FORBIDDEN', 'Not a member of this room');
  }

  return { type: ROOM_CREATED, correlationId, room: snapshot };
}

/**
 * Handle ROOM_UPDATE_META. RBAC: OWNER or ADMIN. Broadcasts ROOM_UPDATED.
 */
async function handleRoomUpdateMeta(ws, payload, context = {}) {
  const userId = connectionManager.getUserId(ws);
  const correlationId = payload.correlationId ?? context.correlationId ?? null;

  if (!userId) return errResponse(correlationId, 'UNAUTHORIZED', 'Not authenticated');
  const { roomId, patch } = payload;
  if (!roomId || !patch || (patch.name === undefined && patch.thumbnailUrl === undefined)) {
    return errResponse(correlationId, 'VALIDATION_ERROR', 'roomId and patch (name or thumbnailUrl) required');
  }
  const sanitizedPatch = {};
  if (patch.name !== undefined) {
    sanitizedPatch.name = String(patch.name).trim().slice(0, MAX_ROOM_NAME_LENGTH);
  }
  if (patch.thumbnailUrl !== undefined) {
    const v = patch.thumbnailUrl;
    sanitizedPatch.thumbnailUrl = v == null ? null : String(v).trim().slice(0, MAX_THUMBNAIL_URL_LENGTH) || null;
  }

  const result = await roomManager.updateRoomMeta(roomId, userId, sanitizedPatch);
  if (!result.success) {
    const code = result.error && result.error.includes('not a member') ? 'FORBIDDEN' : result.error === 'Room not found' ? 'NOT_FOUND' : 'FORBIDDEN';
    auditDenied('ROOM_UPDATE_META', userId, roomId, code, result.error);
    return errResponse(correlationId, code, result.error);
  }

  const room = roomManager.getRoomSnapshot(roomId);
  if (room) {
    broadcastRoomMutation(roomId, {
      type: ROOM_UPDATED,
      roomId,
      patch: sanitizedPatch,
      version: room.version,
      updatedAt: room.updatedAt,
    });
  }
  return { type: ROOM_UPDATED, correlationId, roomId, patch: sanitizedPatch, version: room?.version, updatedAt: room?.updatedAt };
}

/**
 * Handle ROOM_ADD_MEMBERS. RBAC: OWNER or ADMIN. Dedup userIds. Broadcasts ROOM_MEMBERS_UPDATED.
 */
async function handleRoomAddMembers(ws, payload, context = {}) {
  const userId = connectionManager.getUserId(ws);
  const correlationId = payload.correlationId ?? context.correlationId ?? null;

  if (!userId) return errResponse(correlationId, 'UNAUTHORIZED', 'Not authenticated');
  const { roomId, userIds } = payload;
  if (!roomId || !Array.isArray(userIds) || userIds.length === 0) {
    return errResponse(correlationId, 'VALIDATION_ERROR', 'roomId and non-empty userIds required');
  }

  try {
    roomManager.assertMember(roomId, userId);
    const actorRole = roomManager.getRole(roomId, userId);
    roomManager.assertCanAddMembers(actorRole);
  } catch (e) {
    const code = roomManager.getRoomSnapshot(roomId) ? 'FORBIDDEN' : 'NOT_FOUND';
    auditDenied('ROOM_ADD_MEMBERS', userId, roomId, code, e.message);
    return errResponse(correlationId, code, e.message);
  }

  const dedup = [...new Set(userIds)];
  for (const uid of dedup) {
    await roomManager.joinRoom(roomId, uid);
  }

  const snap = roomManager.getRoomSnapshot(roomId);
  if (snap) {
    broadcastRoomMutation(roomId, buildRoomMembersUpdatedPayload(snap));
  }
  const membersPayload = snap ? buildRoomMembersUpdatedPayload(snap) : { type: ROOM_MEMBERS_UPDATED, correlationId, roomId };
  return { ...membersPayload, correlationId };
}

/**
 * Handle ROOM_REMOVE_MEMBER. RBAC: OWNER or ADMIN (ADMIN can remove MEMBER only). Broadcasts ROOM_MEMBERS_UPDATED.
 */
async function handleRoomRemoveMember(ws, payload, context = {}) {
  const userId = connectionManager.getUserId(ws);
  const correlationId = payload.correlationId ?? context.correlationId ?? null;

  if (!userId) return errResponse(correlationId, 'UNAUTHORIZED', 'Not authenticated');
  const { roomId, userId: targetUserId } = payload;
  if (!roomId || !targetUserId) return errResponse(correlationId, 'VALIDATION_ERROR', 'roomId and userId required');

  const result = await roomManager.removeMember(roomId, userId, targetUserId);
  if (!result.success) {
    const code = result.error === 'Room not found' ? 'NOT_FOUND' : 'FORBIDDEN';
    auditDenied('ROOM_REMOVE_MEMBER', userId, roomId, code, result.error, { targetUserId });
    return errResponse(correlationId, code, result.error);
  }

  const snap = roomManager.getRoomSnapshot(roomId);
  if (snap) {
    const membersPayload = buildRoomMembersUpdatedPayload(snap);
    broadcastRoomMutation(roomId, membersPayload);
    // Phase 3D: Notify removed user so they can remove room from their UI.
    sendToUserSocket(targetUserId, membersPayload);
    return { ...membersPayload, correlationId };
  }
  return { type: ROOM_MEMBERS_UPDATED, correlationId, roomId };
}

/**
 * Handle ROOM_SET_ROLE. RBAC: OWNER only (ADMIN cannot set OWNER). Broadcasts ROOM_MEMBERS_UPDATED.
 */
async function handleRoomSetRole(ws, payload, context = {}) {
  const userId = connectionManager.getUserId(ws);
  const correlationId = payload.correlationId ?? context.correlationId ?? null;

  if (!userId) return errResponse(correlationId, 'UNAUTHORIZED', 'Not authenticated');
  const { roomId, userId: targetUserId, role } = payload;
  if (!roomId || !targetUserId || !role) return errResponse(correlationId, 'VALIDATION_ERROR', 'roomId, userId, and role required');

  const result = await roomManager.setMemberRole(roomId, userId, targetUserId, role);
  if (!result.success) {
    const code = result.error === 'Room not found' ? 'NOT_FOUND' : 'FORBIDDEN';
    auditDenied('ROOM_SET_ROLE', userId, roomId, code, result.error, { targetUserId, role });
    return errResponse(correlationId, code, result.error);
  }

  const snap = roomManager.getRoomSnapshot(roomId);
  if (snap) {
    const membersPayload = buildRoomMembersUpdatedPayload(snap);
    broadcastRoomMutation(roomId, membersPayload);
    return { ...membersPayload, correlationId };
  }
  return { type: ROOM_MEMBERS_UPDATED, correlationId, roomId };
}

/**
 * Handle ROOM_DELETE. RBAC: OWNER only. Broadcasts ROOM_DELETED to all members then deletes.
 */
async function handleRoomDelete(ws, payload, context = {}) {
  const userId = connectionManager.getUserId(ws);
  const correlationId = payload.correlationId ?? context.correlationId ?? null;

  if (!userId) return errResponse(correlationId, 'UNAUTHORIZED', 'Not authenticated');
  const { roomId } = payload;
  if (!roomId) return errResponse(correlationId, 'VALIDATION_ERROR', 'roomId required');

  try {
    roomManager.assertMember(roomId, userId);
    roomManager.assertCanDelete(roomManager.getRole(roomId, userId));
  } catch (e) {
    const code = !roomManager.getRoomSnapshot(roomId) ? 'NOT_FOUND' : 'FORBIDDEN';
    auditDenied('ROOM_DELETE', userId, roomId, code, e.message);
    return errResponse(correlationId, code, e.message);
  }

  broadcastRoomMutation(roomId, { type: ROOM_DELETED, roomId });
  await roomManager.deleteRoom(roomId);
  return { type: ROOM_DELETED, correlationId, roomId };
}

/**
 * Handle user disconnection (clean up room membership)
 * @param {string} userId - User ID
 */
async function handleUserDisconnect(userId) {
  const userRooms = roomManager.getUserRooms(userId);
  for (const roomId of userRooms) {
    await roomManager.leaveRoom(roomId, userId);
    
    // Notify remaining members
    roomManager.broadcastToRoom(roomId, {
      type: 'ROOM_MEMBER_LEFT',
      roomId,
      userId,
      reason: 'disconnect',
      timestamp: Date.now(),
    }, userId);
  }
}

module.exports = {
  handleRoomCreate,
  handleRoomJoin,
  handleRoomLeave,
  handleRoomMessage,
  handleRoomInfo,
  handleRoomList,
  handleRoomMembers,
  handleRoomUpdateMeta,
  handleRoomAddMembers,
  handleRoomRemoveMember,
  handleRoomSetRole,
  handleRoomDelete,
  handleUserDisconnect,
};
