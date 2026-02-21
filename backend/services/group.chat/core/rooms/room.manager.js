/**
 * core/rooms/room.manager.js
 *
 * Room registry and lifecycle management.
 * Tracks room existence and basic metadata.
 * Rooms are routing boundaries, not persistence boundaries.
 */

"use strict";

const { ROOM_ACTION } = require("./room.types");

// -----------------------------------------------------------------------------
// Errors
// -----------------------------------------------------------------------------

function RoomNotFoundError(roomId) {
  this.name = "RoomNotFoundError";
  this.message = `Room not found: ${roomId}`;
  this.roomId = roomId;
}
RoomNotFoundError.prototype = Object.create(Error.prototype);
RoomNotFoundError.prototype.constructor = RoomNotFoundError;

function RoomAlreadyExistsError(roomId) {
  this.name = "RoomAlreadyExistsError";
  this.message = `Room already exists: ${roomId}`;
  this.roomId = roomId;
}
RoomAlreadyExistsError.prototype = Object.create(Error.prototype);
RoomAlreadyExistsError.prototype.constructor = RoomAlreadyExistsError;

// -----------------------------------------------------------------------------
// Room Registry (in-memory, deterministic)
// -----------------------------------------------------------------------------

// roomId -> { createdAt, createdBy, metadata }
const roomRegistry = new Map();

// -----------------------------------------------------------------------------
// Validation
// -----------------------------------------------------------------------------

function validateRoomId(roomId) {
  if (typeof roomId !== "string" || roomId.trim() === "") {
    throw new TypeError("roomId must be a non-empty string");
  }
}

function validateCreatorId(creatorId) {
  if (typeof creatorId !== "string" || creatorId.trim() === "") {
    throw new TypeError("creatorId must be a non-empty string");
  }
}

// -----------------------------------------------------------------------------
// Room Lifecycle
// -----------------------------------------------------------------------------

/**
 * Create a room. Returns room metadata.
 * Throws RoomAlreadyExistsError if roomId already exists.
 */
function createRoom(options) {
  const { roomId, creatorId, metadata = {} } = options;
  validateRoomId(roomId);
  validateCreatorId(creatorId);

  if (roomRegistry.has(roomId)) {
    throw new RoomAlreadyExistsError(roomId);
  }

  const room = {
    roomId,
    createdAt: Date.now(),
    createdBy: creatorId,
    metadata: { ...metadata }, // Copy to avoid mutation
  };

  roomRegistry.set(roomId, room);
  return { ...room }; // Return copy
}

/**
 * Get room metadata. Returns null if room does not exist.
 */
function getRoom(roomId) {
  validateRoomId(roomId);
  const room = roomRegistry.get(roomId);
  return room ? { ...room } : null; // Return copy
}

/**
 * Require room to exist. Throws RoomNotFoundError if missing.
 */
function requireRoom(roomId) {
  const room = getRoom(roomId);
  if (!room) {
    throw new RoomNotFoundError(roomId);
  }
  return room;
}

/**
 * Check if room exists.
 */
function roomExists(roomId) {
  validateRoomId(roomId);
  return roomRegistry.has(roomId);
}

/**
 * Delete a room. Removes from registry.
 * Note: This does NOT clean up membership or connections.
 * Caller must handle cleanup separately.
 */
function deleteRoom(roomId) {
  validateRoomId(roomId);
  requireRoom(roomId); // Ensure exists
  roomRegistry.delete(roomId);
}

/**
 * List all room IDs. Returns deterministic sorted array.
 */
function listRooms() {
  return Array.from(roomRegistry.keys()).sort();
}

// -----------------------------------------------------------------------------
// Exports
// -----------------------------------------------------------------------------

module.exports = {
  createRoom,
  getRoom,
  requireRoom,
  roomExists,
  deleteRoom,
  listRooms,
  validateRoomId,
  RoomNotFoundError,
  RoomAlreadyExistsError,
};
