/**
 * Frontend constants from backend CONTRACT.json.
 * Single source of truth for DM protocol limits.
 * Must match backend config/constants.js MAX_CONTENT_LENGTH.
 *
 * B2: Sending content with length > MAX_CONTENT_LENGTH (e.g. 10001 chars) must fail
 * client-side before WS send: ChatWindow.jsx blocks submit, wsClient.sendMessage/sendRoomMessage return false.
 */
export const MAX_CONTENT_LENGTH = 10000;
