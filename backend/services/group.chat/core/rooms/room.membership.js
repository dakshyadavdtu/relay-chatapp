/**
 * core/rooms/room.membership.js
 *
 * Room membership management: join/leave, role assignment, connection tracking.
 * Implements socket multiplexing: one connection can belong to multiple rooms.
 *
 * Tracks:
 * - connectionId → Set<roomId> (which rooms a connection is in)
 * - roomId → Set<connectionId> (which connections are in a room)
 * - roomId → Map<connectionId, role> (role per connection per room)
 */

"use strict";

const roomManager = require("./room.manager");
const { ROLE, isValidRole } = require("./room.types");

// -----------------------------------------------------------------------------
// Errors
// -----------------------------------------------------------------------------

function NotRoomMemberError(roomId, connectionId) {
  this.name = "NotRoomMemberError";
  this.message = `Connection ${connectionId} is not a member of room ${roomId}`;
  this.roomId = roomId;
  this.connectionId = connectionId;
}
NotRoomMemberError.prototype = Object.create(Error.prototype);
NotRoomMemberError.prototype.constructor = NotRoomMemberError;

function AlreadyRoomMemberError(roomId, connectionId) {
  this.name = "AlreadyRoomMemberError";
  this.message = `Connection ${connectionId} is already a member of room ${roomId}`;
  this.roomId = roomId;
  this.connectionId = connectionId;
}
AlreadyRoomMemberError.prototype = Object.create(Error.prototype);
AlreadyRoomMemberError.prototype.constructor = AlreadyRoomMemberError;

// -----------------------------------------------------------------------------
// Membership State (in-memory, deterministic)
// -----------------------------------------------------------------------------

// connectionId → Set<roomId> (which rooms this connection belongs to)
const connectionRooms = new Map();

// roomId → Set<connectionId> (which connections are in this room)
const roomConnections = new Map();

// roomId → Map<connectionId, role> (role per connection per room)
const roomRoles = new Map();

// -----------------------------------------------------------------------------
// Validation
// -----------------------------------------------------------------------------

function validateConnectionId(connectionId) {
  if (typeof connectionId !== "string" || connectionId.trim() === "") {
    throw new TypeError("connectionId must be a non-empty string");
  }
}

function validateRole(role) {
  if (!isValidRole(role)) {
    throw new TypeError(`Invalid role: ${role}. Must be one of: ${Object.values(ROLE).join(", ")}`);
  }
}

// -----------------------------------------------------------------------------
// Internal Helpers
// -----------------------------------------------------------------------------

function getConnectionRooms(connectionId) {
  return connectionRooms.get(connectionId) || new Set();
}

function getRoomConnections(roomId) {
  return roomConnections.get(roomId) || new Set();
}

function getRoomRoleMap(roomId) {
  if (!roomRoles.has(roomId)) {
    roomRoles.set(roomId, new Map());
  }
  return roomRoles.get(roomId);
}

// -----------------------------------------------------------------------------
// Membership Operations
// -----------------------------------------------------------------------------

/**
 * Join a room. Assigns default role (MEMBER) unless specified.
 * Throws if room doesn't exist or connection already in room.
 */
function joinRoom(options) {
  const { roomId, connectionId, role = ROLE.MEMBER } = options;
  roomManager.validateRoomId(roomId);
  validateConnectionId(connectionId);
  validateRole(role);

  // Ensure room exists
  roomManager.requireRoom(roomId);

  // Get or create connection's room set
  if (!connectionRooms.has(connectionId)) {
    connectionRooms.set(connectionId, new Set());
  }
  const connRooms = connectionRooms.get(connectionId);

  // Check if already member
  if (connRooms.has(roomId)) {
    throw new AlreadyRoomMemberError(roomId, connectionId);
  }

  // Add connection to room
  connRooms.add(roomId);

  // Get or create room's connection set
  if (!roomConnections.has(roomId)) {
    roomConnections.set(roomId, new Set());
  }
  const roomConns = roomConnections.get(roomId);
  roomConns.add(connectionId);

  // Assign role
  const roleMap = getRoomRoleMap(roomId);
  roleMap.set(connectionId, role);
}

/**
 * Leave a room. Removes connection from room membership and role.
 * Throws if connection not in room.
 */
function leaveRoom(options) {
  const { roomId, connectionId } = options;
  roomManager.validateRoomId(roomId);
  validateConnectionId(connectionId);

  // Ensure room exists
  roomManager.requireRoom(roomId);

  const connRooms = getConnectionRooms(connectionId);
  const roomConns = getRoomConnections(roomId);

  // Check if member
  if (!connRooms.has(roomId)) {
    throw new NotRoomMemberError(roomId, connectionId);
  }

  // Remove bidirectional mapping
  connRooms.delete(roomId);
  roomConns.delete(connectionId);

  // Remove role
  const roleMap = getRoomRoleMap(roomId);
  roleMap.delete(connectionId);

  // Cleanup empty sets
  if (connRooms.size === 0) {
    connectionRooms.delete(connectionId);
  }
  if (roomConns.size === 0) {
    roomConnections.delete(roomId);
    roomRoles.delete(roomId);
  }
}

/**
 * Check if connection is member of room.
 */
function isMember(options) {
  const { roomId, connectionId } = options;
  roomManager.validateRoomId(roomId);
  validateConnectionId(connectionId);

  const connRooms = getConnectionRooms(connectionId);
  return connRooms.has(roomId);
}

/**
 * Get role of connection in room. Returns null if not member.
 */
function getRole(options) {
  const { roomId, connectionId } = options;
  roomManager.validateRoomId(roomId);
  validateConnectionId(connectionId);

  if (!isMember({ roomId, connectionId })) {
    return null;
  }

  const roleMap = getRoomRoleMap(roomId);
  return roleMap.get(connectionId) || ROLE.MEMBER; // Default fallback
}

/**
 * Update role of connection in room. Throws if not member.
 */
function setRole(options) {
  const { roomId, connectionId, role } = options;
  roomManager.validateRoomId(roomId);
  validateConnectionId(connectionId);
  validateRole(role);

  if (!isMember({ roomId, connectionId })) {
    throw new NotRoomMemberError(roomId, connectionId);
  }

  const roleMap = getRoomRoleMap(roomId);
  roleMap.set(connectionId, role);
}

/**
 * Get all rooms a connection belongs to. Returns deterministic sorted array.
 */
function getConnectionRoomsList(connectionId) {
  validateConnectionId(connectionId);
  const rooms = getConnectionRooms(connectionId);
  return Array.from(rooms).sort();
}

/**
 * Get all connections in a room. Returns deterministic sorted array.
 */
function getRoomConnectionsList(roomId) {
  roomManager.validateRoomId(roomId);
  const connections = getRoomConnections(roomId);
  return Array.from(connections).sort();
}

/**
 * Disconnect cleanup: remove connection from ALL rooms.
 * Called when WebSocket disconnects.
 */
function disconnect(connectionId) {
  validateConnectionId(connectionId);

  const connRooms = getConnectionRooms(connectionId);
  const roomIds = Array.from(connRooms); // Copy to avoid mutation during iteration

  for (const roomId of roomIds) {
    try {
      leaveRoom({ roomId, connectionId });
    } catch (err) {
      // Ignore errors during cleanup (room might have been deleted)
    }
  }
}

// -----------------------------------------------------------------------------
// Exports
// -----------------------------------------------------------------------------

module.exports = {
  joinRoom,
  leaveRoom,
  isMember,
  getRole,
  setRole,
  getConnectionRoomsList,
  getRoomConnectionsList,
  disconnect,
  NotRoomMemberError,
  AlreadyRoomMemberError,
};
