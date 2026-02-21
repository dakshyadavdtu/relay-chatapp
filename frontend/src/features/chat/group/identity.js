/**
 * Group/room identity helpers.
 * Normalizes room/group identity; canonical chat id format for rooms is "room:<raw>".
 */

const ROOM_PREFIX = "room:";

/**
 * Strip "room:" prefix if present; return raw room id.
 * @param {string} input - Room id or chat id (e.g. "room:abc", "abc")
 * @returns {string} Raw room id
 */
export function normalizeRoomId(input) {
  if (input == null || typeof input !== "string") return "";
  const s = String(input).trim();
  if (s.startsWith(ROOM_PREFIX)) return s.slice(ROOM_PREFIX.length);
  return s;
}

/**
 * Build canonical room chat id from raw room id.
 * @param {string} roomId - Raw room id
 * @returns {string} "room:<raw>"
 */
export function toRoomChatId(roomId) {
  const raw = normalizeRoomId(roomId);
  return raw ? `${ROOM_PREFIX}${raw}` : "";
}

/**
 * Whether the chat id is a room/group chat id (canonical "room:" prefix).
 * @param {string} chatId - Chat id to check
 * @returns {boolean}
 */
export function isRoomChatId(chatId) {
  return typeof chatId === "string" && chatId.startsWith(ROOM_PREFIX) && chatId.length > ROOM_PREFIX.length;
}

/**
 * Extract raw room id from a room chat id. Returns null if not a room chat id.
 * @param {string} chatId - Chat id (e.g. "room:abc")
 * @returns {string|null} Raw room id or null
 */
export function roomIdFromChatId(chatId) {
  if (!isRoomChatId(chatId)) return null;
  return chatId.slice(ROOM_PREFIX.length);
}
