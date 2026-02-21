/**
 * Shared constants. WS_EVENTS for WebSocket integration.
 */

export const WS_EVENTS = {
  MESSAGE_SEND: "MESSAGE_SEND",
  TYPING_START: "TYPING_START",
  TYPING_STOP: "TYPING_STOP",
  MESSAGE_SENT: "MESSAGE_SENT",
  MESSAGE_DELIVERED: "MESSAGE_DELIVERED",
  MESSAGE_READ: "MESSAGE_READ",
  PRESENCE_UPDATE: "PRESENCE_UPDATE",
  TYPING_UPDATE: "TYPING_UPDATE",
  ERROR: "ERROR",
};

/** Connection status (frontend-only, not sent to backend) */
export const CONNECTION_STATUS = "CONNECTION_STATUS";

/** Auth error event (server sends when auth fails) */
export const AUTH_ERROR = "AUTH_ERROR";

/** All WebSocket event constants */
export const EVENTS = {
  ...WS_EVENTS,
  CONNECTION_STATUS,
  AUTH_ERROR,
};
