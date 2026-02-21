/**
 * core/rooms/room.broadcast.js
 *
 * Selective message broadcast: fan-out to room members only.
 * This is ROUTING logic, not delivery logic.
 *
 * Rules:
 * - Messages delivered ONLY to members of target room
 * - Sender does NOT receive duplicate echo (unless explicitly required)
 * - No O(n²) broadcast loops
 * - No global broadcasts allowed
 * - No cross-room message leaks
 */

"use strict";

const roomManager = require("./room.manager");
const roomMembership = require("./room.membership");
const roomRbac = require("./room.rbac");
const { MESSAGE_TYPE, PERMISSION } = require("./room.types");

// -----------------------------------------------------------------------------
// Errors
// -----------------------------------------------------------------------------

function InvalidMessageTypeError(messageType) {
  this.name = "InvalidMessageTypeError";
  this.message = `Invalid message type: ${messageType}. Must be ${MESSAGE_TYPE.GROUP} or ${MESSAGE_TYPE.DIRECT}`;
  this.messageType = messageType;
}
InvalidMessageTypeError.prototype = Object.create(Error.prototype);
InvalidMessageTypeError.prototype.constructor = InvalidMessageTypeError;

// -----------------------------------------------------------------------------
// Broadcast Logic
// -----------------------------------------------------------------------------

/**
 * Compute fan-out targets for a room message.
 * Returns array of connectionIds that should receive the message.
 *
 * Rules:
 * - Sender must be room member
 * - Sender must have SEND_MESSAGE permission
 * - Only current room members receive message
 * - Sender excluded from recipients (no echo)
 * - Deterministic sorted order
 *
 * This is side-effect free: only computes targets, does not send.
 */
function computeFanOut(options) {
  const { roomId, senderConnectionId, includeSender = false } = options;

  // Validate inputs
  if (typeof roomId !== "string" || roomId.trim() === "") {
    throw new TypeError("roomId must be a non-empty string");
  }
  if (typeof senderConnectionId !== "string" || senderConnectionId.trim() === "") {
    throw new TypeError("senderConnectionId must be a non-empty string");
  }

  // Ensure room exists
  roomManager.requireRoom(roomId);

  // Sender must be member
  if (!roomMembership.isMember({ roomId, connectionId: senderConnectionId })) {
    throw new roomMembership.NotRoomMemberError(roomId, senderConnectionId);
  }

  // Sender must have permission
  roomRbac.requirePermission({
    roomId,
    connectionId: senderConnectionId,
    permission: PERMISSION.SEND_MESSAGE,
  });

  // Get all room connections
  const allConnections = roomMembership.getRoomConnectionsList(roomId);

  // Filter out sender unless explicitly included
  const recipients = includeSender
    ? allConnections
    : allConnections.filter(connId => connId !== senderConnectionId);

  // Return deterministic sorted array (already sorted by getRoomConnectionsList)
  return recipients;
}

/**
 * Route a message based on message type.
 * - GROUP messages: routed through rooms layer (requires roomId)
 * - DIRECT messages: bypass rooms layer (return empty array for routing)
 *
 * Returns array of connectionIds to deliver to, or null if message should bypass rooms.
 */
function routeMessage(options) {
  const {
    messageType,
    roomId,
    senderConnectionId,
    includeSender = false,
  } = options;

  // Validate message type
  if (messageType !== MESSAGE_TYPE.GROUP && messageType !== MESSAGE_TYPE.DIRECT) {
    throw new InvalidMessageTypeError(messageType);
  }

  // DIRECT messages bypass rooms layer
  if (messageType === MESSAGE_TYPE.DIRECT) {
    return null; // Signal to caller: bypass rooms, handle via direct messaging
  }

  // GROUP messages require roomId
  if (!roomId) {
    throw new TypeError("roomId is required for GROUP messages");
  }

  // Route through rooms
  return computeFanOut({
    roomId,
    senderConnectionId,
    includeSender,
  });
}

/**
 * Broadcast to room (routing only).
 * Returns connectionIds that should receive the message.
 * Does NOT actually send messages (that's transport layer's job).
 *
 * Integration point: called AFTER rate limiting and message validation,
 * BEFORE persistence and delivery acknowledgements.
 */
function broadcastToRoom(options) {
  const {
    roomId,
    senderConnectionId,
    includeSender = false,
  } = options;

  return computeFanOut({
    roomId,
    senderConnectionId,
    includeSender,
  });
}

// -----------------------------------------------------------------------------
// Safety Checks
// -----------------------------------------------------------------------------

/**
 * Validate that message can be sent to room.
 * Throws if sender not member or lacks permission.
 */
function validateRoomMessage(options) {
  const { roomId, senderConnectionId } = options;

  // Validate inputs
  if (typeof roomId !== "string" || roomId.trim() === "") {
    throw new TypeError("roomId must be a non-empty string");
  }
  if (typeof senderConnectionId !== "string" || senderConnectionId.trim() === "") {
    throw new TypeError("senderConnectionId must be a non-empty string");
  }

  // Room must exist
  roomManager.requireRoom(roomId);

  // Sender must be member
  if (!roomMembership.isMember({ roomId, connectionId: senderConnectionId })) {
    throw new roomMembership.NotRoomMemberError(roomId, senderConnectionId);
  }

  // Sender must have permission
  roomRbac.requirePermission({
    roomId,
    connectionId: senderConnectionId,
    permission: PERMISSION.SEND_MESSAGE,
  });
}

// -----------------------------------------------------------------------------
// Exports
// -----------------------------------------------------------------------------

module.exports = {
  computeFanOut,
  routeMessage,
  broadcastToRoom,
  validateRoomMessage,
  InvalidMessageTypeError,
};
