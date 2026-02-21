/**
 * Unified backend error mapping. Source of truth: backend/utils/errorCodes.js.
 * All backend error codes have a user-facing message; no "unknown error code" logs.
 */

/** @typedef {'transient'|'persistent'|'auth'} ErrorSeverity */
/** @typedef {{ code?: string, message: string, severity: ErrorSeverity }} NormalizedError */

const USER_MESSAGES = {
  AUTH_REQUIRED: "Please sign in to continue.",
  UNAUTHORIZED: "Session expired. Please sign in again.",
  INVALID_PAYLOAD: "Invalid request. Please try again.",
  INVALID_SCHEMA: "Invalid request format. Please refresh and try again.",
  INVALID_FIELD_TYPE: "Invalid data. Please check your input.",
  MISSING_FIELD: "Required field missing. Please complete the form.",
  MISSING_TYPE: "Invalid request. Missing type.",
  INVALID_JSON: "Invalid data. Please try again.",
  INVALID_ACK_TYPE: "Invalid acknowledgment. Please try again.",
  INVALID_TRANSITION: "Operation not allowed. Retrying…",
  MESSAGE_NOT_FOUND: "Message not found. It may have been deleted.",
  PERSISTENCE_ERROR: "Unable to save. Please try again.",
  REPLAY_ERROR: "Unable to sync messages. Reconnecting…",
  SYNC_ERROR: "Sync failed. Please refresh.",
  VERSION_MISMATCH: "App update required. Please refresh.",
  RATE_LIMIT_EXCEEDED: "Too many requests. Slow down and try again.",
  RECIPIENT_BUFFER_FULL: "Recipient is busy. Try again later.",
  PAYLOAD_TOO_LARGE: "Data too large. Please reduce size.",
  NOT_AUTHORIZED: "You don't have permission for this action.",
  FORBIDDEN: "Access denied (requires ADMIN).",
  ROOM_NOT_FOUND: "Room not found. It may have been deleted.",
  ROOM_FULL: "Room is full. Try another room.",
  NOT_A_MEMBER: "You must join the room first.",
  MISSING_ROOM_ID: "Room ID is required.",
  CREATE_FAILED: "Could not create room. It may already exist.",
  JOIN_FAILED: "Could not join room. Check the room ID.",
  LEAVE_FAILED: "Could not leave room. Try again.",
  MISSING_CONTENT: "Message cannot be empty.",
  CONTENT_TOO_LONG: "Message is too long. Shorten it.",
  BROADCAST_FAILED: "Message could not be sent. Try again.",
  INVALID_LAST_MESSAGE_ID: "Sync failed. Reconnecting…",
  CONNECTION_LIMIT: "Too many connections. Try again later.",
};

const SEVERITY_MAP = {
  AUTH_REQUIRED: "auth",
  UNAUTHORIZED: "auth",
  INVALID_PAYLOAD: "transient",
  INVALID_SCHEMA: "transient",
  INVALID_FIELD_TYPE: "transient",
  MISSING_FIELD: "transient",
  MISSING_TYPE: "transient",
  INVALID_JSON: "transient",
  INVALID_ACK_TYPE: "transient",
  INVALID_TRANSITION: "transient",
  MESSAGE_NOT_FOUND: "transient",
  PERSISTENCE_ERROR: "persistent",
  REPLAY_ERROR: "transient",
  SYNC_ERROR: "transient",
  VERSION_MISMATCH: "persistent",
  RATE_LIMIT_EXCEEDED: "persistent",
  RECIPIENT_BUFFER_FULL: "transient",
  PAYLOAD_TOO_LARGE: "transient",
  NOT_AUTHORIZED: "persistent",
  FORBIDDEN: "persistent",
  ROOM_NOT_FOUND: "transient",
  ROOM_FULL: "transient",
  NOT_A_MEMBER: "persistent",
  MISSING_ROOM_ID: "transient",
  CREATE_FAILED: "transient",
  JOIN_FAILED: "transient",
  LEAVE_FAILED: "transient",
  MISSING_CONTENT: "transient",
  CONTENT_TOO_LONG: "transient",
  BROADCAST_FAILED: "transient",
  INVALID_LAST_MESSAGE_ID: "transient",
  CONNECTION_LIMIT: "persistent",
};

/**
 * Normalize backend error shape (HTTP or WS).
 * @param {{ code?: string, error?: string, message?: string, details?: string }} raw
 * @returns {NormalizedError}
 */
export function normalizeBackendError(raw = {}) {
  const code = (raw.code || "").toUpperCase().replace(/-/g, "_");
  const serverMsg = raw.error || raw.message || raw.details || "";
  const message = serverMsg && typeof serverMsg === "string" ? serverMsg : toUserMessage(code, {});
  return {
    code: code || undefined,
    message,
    severity: severityForCode(code),
  };
}

/**
 * Get user-facing message for a backend error code.
 * @param {string} code
 * @param {{ context?: 'room'|'dm'|'auth'|'' }} [context]
 * @returns {string}
 */
export function toUserMessage(code, context = {}) {
  const c = (code || "").toUpperCase().replace(/-/g, "_");
  if (USER_MESSAGES[c]) return USER_MESSAGES[c];
  return "Something went wrong. Please try again.";
}

/**
 * @param {string} code
 * @returns {ErrorSeverity}
 */
export function severityForCode(code) {
  const c = (code || "").toUpperCase().replace(/-/g, "_");
  return SEVERITY_MAP[c] || "transient";
}
