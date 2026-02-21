/**
 * core/rooms/room.rbac.js
 *
 * Room-scoped Role-Based Access Control (RBAC).
 * Permissions exist ONLY within a room context.
 * RBAC does NOT leak into global auth logic.
 *
 * Enforces permissions BEFORE broadcast:
 * - who can send messages
 * - who can delete messages
 * - who can add/remove users
 */

"use strict";

const roomMembership = require("./room.membership");
const { ROLE, PERMISSION, compareRoles, isValidPermission } = require("./room.types");

// -----------------------------------------------------------------------------
// Errors
// -----------------------------------------------------------------------------

function PermissionDeniedError(roomId, connectionId, permission) {
  this.name = "PermissionDeniedError";
  this.message = `Connection ${connectionId} lacks permission '${permission}' in room ${roomId}`;
  this.roomId = roomId;
  this.connectionId = connectionId;
  this.permission = permission;
}
PermissionDeniedError.prototype = Object.create(Error.prototype);
PermissionDeniedError.prototype.constructor = PermissionDeniedError;

// -----------------------------------------------------------------------------
// Permission Matrix (role → permissions)
// -----------------------------------------------------------------------------

const ROLE_PERMISSIONS = {
  [ROLE.ADMIN]: [
    PERMISSION.SEND_MESSAGE,
    PERMISSION.DELETE_MESSAGE,
    PERMISSION.ADD_MEMBER,
    PERMISSION.REMOVE_MEMBER,
    PERMISSION.MODIFY_ROOM,
  ],
  [ROLE.MODERATOR]: [
    PERMISSION.SEND_MESSAGE,
    PERMISSION.DELETE_MESSAGE,
    PERMISSION.REMOVE_MEMBER, // Cannot remove admins
  ],
  [ROLE.MEMBER]: [
    PERMISSION.SEND_MESSAGE,
  ],
};

// -----------------------------------------------------------------------------
// Permission Checks
// -----------------------------------------------------------------------------

/**
 * Check if connection has permission in room.
 * Returns false if not a member or lacks permission.
 */
function hasPermission(options) {
  const { roomId, connectionId, permission } = options;
  
  if (!isValidPermission(permission)) {
    throw new TypeError(`Invalid permission: ${permission}`);
  }

  // Must be room member
  if (!roomMembership.isMember({ roomId, connectionId })) {
    return false;
  }

  // Get role
  const role = roomMembership.getRole({ roomId, connectionId });
  if (!role) {
    return false;
  }

  // Check permission matrix
  const permissions = ROLE_PERMISSIONS[role] || [];
  return permissions.includes(permission);
}

/**
 * Require permission. Throws PermissionDeniedError if lacking.
 */
function requirePermission(options) {
  const { roomId, connectionId, permission } = options;
  
  if (!hasPermission({ roomId, connectionId, permission })) {
    throw new PermissionDeniedError(roomId, connectionId, permission);
  }
}

/**
 * Check if connection can remove another connection from room.
 * Admins can remove anyone except other admins.
 * Moderators can remove members only.
 * Members cannot remove anyone.
 */
function canRemoveMember(options) {
  const { roomId, removerConnectionId, targetConnectionId } = options;

  // Remover must be member
  if (!roomMembership.isMember({ roomId, connectionId: removerConnectionId })) {
    return false;
  }

  // Target must be member
  if (!roomMembership.isMember({ roomId, connectionId: targetConnectionId })) {
    return false; // Can't remove non-member
  }

  const removerRole = roomMembership.getRole({ roomId, connectionId: removerConnectionId });
  const targetRole = roomMembership.getRole({ roomId, connectionId: targetConnectionId });

  // Admins can remove anyone except other admins
  if (removerRole === ROLE.ADMIN) {
    return targetRole !== ROLE.ADMIN;
  }

  // Moderators can remove members only
  if (removerRole === ROLE.MODERATOR) {
    return targetRole === ROLE.MEMBER;
  }

  // Members cannot remove anyone
  return false;
}

/**
 * Check if connection can modify room settings.
 * Only admins can modify room.
 */
function canModifyRoom(options) {
  const { roomId, connectionId } = options;
  return hasPermission({ roomId, connectionId, permission: PERMISSION.MODIFY_ROOM });
}

/**
 * Check if connection can send messages to room.
 * All members can send (enforced by permission check).
 */
function canSendMessage(options) {
  const { roomId, connectionId } = options;
  return hasPermission({ roomId, connectionId, permission: PERMISSION.SEND_MESSAGE });
}

/**
 * Check if connection can delete messages in room.
 * Admins and moderators can delete.
 */
function canDeleteMessage(options) {
  const { roomId, connectionId } = options;
  return hasPermission({ roomId, connectionId, permission: PERMISSION.DELETE_MESSAGE });
}

// -----------------------------------------------------------------------------
// Exports
// -----------------------------------------------------------------------------

module.exports = {
  hasPermission,
  requirePermission,
  canRemoveMember,
  canModifyRoom,
  canSendMessage,
  canDeleteMessage,
  PermissionDeniedError,
};
