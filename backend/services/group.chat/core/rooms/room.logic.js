/**
 * core/rooms/room.logic.js
 *
 * Room semantics only: membership boundary, fan-out domain, delivery coordination.
 * In-memory; no transport, persistence, or scaling. Answers: "Who should receive
 * this room message?"
 */

"use strict";

// -----------------------------------------------------------------------------
// Errors (invariant violations — interview-friendly, explicit)
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

function NotRoomMemberError(roomId, userId) {
  this.name = "NotRoomMemberError";
  this.message = `User ${userId} is not a member of room ${roomId}`;
  this.roomId = roomId;
  this.userId = userId;
}
NotRoomMemberError.prototype = Object.create(Error.prototype);
NotRoomMemberError.prototype.constructor = NotRoomMemberError;

function AlreadyRoomMemberError(roomId, userId) {
  this.name = "AlreadyRoomMemberError";
  this.message = `User ${userId} is already a member of room ${roomId}`;
  this.roomId = roomId;
  this.userId = userId;
}
AlreadyRoomMemberError.prototype = Object.create(Error.prototype);
AlreadyRoomMemberError.prototype.constructor = AlreadyRoomMemberError;

// -----------------------------------------------------------------------------
// In-memory store: roomId -> Set<userId> (current members only)
// -----------------------------------------------------------------------------

const rooms = new Map();

function getRoom(roomId) {
  return rooms.get(roomId) || null;
}

function requireRoom(roomId) {
  const room = getRoom(roomId);
  if (!room) throw new RoomNotFoundError(roomId);
  return room;
}

// -----------------------------------------------------------------------------
// Input validation (non-empty string identifiers)
// -----------------------------------------------------------------------------

function validateId(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${name} must be a non-empty string`);
  }
}

function validateRoomId(roomId) {
  validateId(roomId, "roomId");
}

function validateUserId(userId) {
  validateId(userId, "userId");
}

// -----------------------------------------------------------------------------
// Membership (O(1)); returned data is never mutated
// -----------------------------------------------------------------------------

/**
 * Create a room. Creator becomes the sole initial member.
 * Throws RoomAlreadyExistsError if roomId already exists.
 */
function createRoom(options) {
  const { roomId, creatorId } = options;
  validateRoomId(roomId);
  validateUserId(creatorId);

  if (rooms.has(roomId)) {
    throw new RoomAlreadyExistsError(roomId);
  }

  const members = new Set();
  members.add(creatorId);
  rooms.set(roomId, members);
}

/**
 * Add a user to a room. Idempotent for "already member" is not required:
 * second join throws AlreadyRoomMemberError (invariant: cannot join twice).
 */
function joinRoom(options) {
  const { roomId, userId } = options;
  validateRoomId(roomId);
  validateUserId(userId);

  const members = requireRoom(roomId);

  if (members.has(userId)) {
    throw new AlreadyRoomMemberError(roomId, userId);
  }

  members.add(userId);
}

/**
 * Remove a user from a room. Throws if not a member (invariant: cannot leave
 * a room you are not in).
 */
function leaveRoom(options) {
  const { roomId, userId } = options;
  validateRoomId(roomId);
  validateUserId(userId);

  const members = requireRoom(roomId);

  if (!members.has(userId)) {
    throw new NotRoomMemberError(roomId, userId);
  }

  members.delete(userId);
}

/**
 * Returns true iff userId is a current member of the room.
 */
function isMember(options) {
  const { roomId, userId } = options;
  validateRoomId(roomId);
  validateUserId(userId);

  const members = requireRoom(roomId);
  return members.has(userId);
}

/**
 * Returns a copy of current member userIds, in deterministic (sorted) order.
 * Caller cannot mutate room state via this array.
 */
function getRoomMembers(roomId) {
  validateRoomId(roomId);
  const members = requireRoom(roomId);
  return Array.from(members).sort();
}

/**
 * Compute who should receive a message sent to the room by senderId.
 * Side-effect free; returns a new, deterministic array of userIds.
 *
 * Rules:
 * - Sender must be a room member.
 * - Sender does NOT receive their own message.
 * - Only current members receive the message.
 *
 * Throws RoomNotFoundError if room does not exist.
 * Throws NotRoomMemberError if senderId is not a member.
 */
function computeFanOut(options) {
  const { roomId, senderId } = options;
  validateRoomId(roomId);
  validateUserId(senderId);

  const members = requireRoom(roomId);

  if (!members.has(senderId)) {
    throw new NotRoomMemberError(roomId, senderId);
  }

  const recipients = [];
  for (const uid of members) {
    if (uid !== senderId) {
      recipients.push(uid);
    }
  }

  return recipients.sort();
}

// -----------------------------------------------------------------------------
// Exports
// -----------------------------------------------------------------------------

module.exports = {
  createRoom,
  joinRoom,
  leaveRoom,
  isMember,
  getRoomMembers,
  computeFanOut,
  RoomNotFoundError,
  RoomAlreadyExistsError,
  NotRoomMemberError,
  AlreadyRoomMemberError,
};
