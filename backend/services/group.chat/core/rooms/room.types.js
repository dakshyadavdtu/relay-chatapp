/**
 * core/rooms/room.types.js
 *
 * Enums, constants, and type definitions for the rooms routing layer.
 * Rooms are routing boundaries, not persistence boundaries.
 */

"use strict";

// -----------------------------------------------------------------------------
// Room Roles (room-scoped RBAC)
// -----------------------------------------------------------------------------

const ROLE = {
  ADMIN: "admin",       // Full control: add/remove users, delete messages, modify room
  MODERATOR: "moderator", // Can delete messages, remove users (not admins)
  MEMBER: "member",     // Can send messages, view room
};

// Role hierarchy for permission checks
const ROLE_HIERARCHY = {
  [ROLE.ADMIN]: 3,
  [ROLE.MODERATOR]: 2,
  [ROLE.MEMBER]: 1,
};

// -----------------------------------------------------------------------------
// Room Permissions (room-scoped actions)
// -----------------------------------------------------------------------------

const PERMISSION = {
  SEND_MESSAGE: "send_message",           // Can send messages to room
  DELETE_MESSAGE: "delete_message",       // Can delete any message in room
  ADD_MEMBER: "add_member",               // Can add users to room
  REMOVE_MEMBER: "remove_member",         // Can remove users from room
  MODIFY_ROOM: "modify_room",             // Can change room settings/metadata
};

// -----------------------------------------------------------------------------
// Room Action Types
// -----------------------------------------------------------------------------

const ROOM_ACTION = {
  JOIN: "join",
  LEAVE: "leave",
  CREATE: "create",
  DELETE: "delete",
};

// -----------------------------------------------------------------------------
// Message Types (routing decisions)
// -----------------------------------------------------------------------------

const MESSAGE_TYPE = {
  GROUP: "group",       // Requires roomId, routed through rooms layer
  DIRECT: "direct",     // 1-to-1, bypasses rooms layer
};

// -----------------------------------------------------------------------------
// Validation
// -----------------------------------------------------------------------------

function isValidRole(role) {
  return Object.values(ROLE).includes(role);
}

function isValidPermission(permission) {
  return Object.values(PERMISSION).includes(permission);
}

function compareRoles(role1, role2) {
  const level1 = ROLE_HIERARCHY[role1] || 0;
  const level2 = ROLE_HIERARCHY[role2] || 0;
  return level1 - level2;
}

// -----------------------------------------------------------------------------
// Exports
// -----------------------------------------------------------------------------

module.exports = {
  ROLE,
  ROLE_HIERARCHY,
  PERMISSION,
  ROOM_ACTION,
  MESSAGE_TYPE,
  isValidRole,
  isValidPermission,
  compareRoles,
};
