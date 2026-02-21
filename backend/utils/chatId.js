'use strict';

/**
 * Canonical chatId format for API and persistence.
 * Single source of truth so GET /api/chat?chatId=... matches UI conversationId.
 *
 * - DM: direct:<u1>:<u2> (sorted)
 * - Room: room:<roomId>
 */

const ROOM_PREFIX = 'room:';
const DIRECT_PREFIX = 'direct:';

/**
 * @param {string} roomId - Raw room id
 * @returns {string} room:<roomId>
 */
function toRoomChatId(roomId) {
  if (!roomId || typeof roomId !== 'string') return '';
  return `${ROOM_PREFIX}${roomId.trim()}`;
}

/**
 * @param {string} chatId - room:<roomId> or legacy raw roomId
 * @returns {string|null} roomId or null if not a room chatId
 */
function parseRoomChatId(chatId) {
  if (!chatId || typeof chatId !== 'string') return null;
  const t = chatId.trim();
  if (t.startsWith(ROOM_PREFIX)) return t.slice(ROOM_PREFIX.length) || null;
  return null;
}

/**
 * Normalize roomId: correct known client/server typo "oom_..." -> "room_..."
 * so that room:oom_xxx resolves to the same room as room:room_xxx.
 * @param {string} roomId
 * @returns {string}
 */
function normalizeRoomId(roomId) {
  if (!roomId || typeof roomId !== 'string') return roomId;
  const t = roomId.trim();
  if (t.startsWith('oom_')) return 'room_' + t.slice(4);
  return t;
}

/**
 * Resolve chatId to roomId for room chats. Accepts both room:<id> and raw roomId (legacy).
 * Normalizes oom_ -> room_ so lookup succeeds when client sends the typo.
 * @param {string} chatId
 * @returns {string|null} roomId or null
 */
function toRoomId(chatId) {
  const parsed = parseRoomChatId(chatId);
  const raw = parsed || (chatId && typeof chatId === 'string' && !chatId.startsWith(DIRECT_PREFIX) ? chatId.trim() : null);
  if (!raw) return null;
  return normalizeRoomId(raw);
}

/**
 * @param {string} userId1
 * @param {string} userId2
 * @returns {string} direct:<smaller>:<larger>
 */
function toDirectChatId(userId1, userId2) {
  if (!userId1 || !userId2) return '';
  const [a, b] = [String(userId1), String(userId2)].sort();
  return `${DIRECT_PREFIX}${a}:${b}`;
}

function isRoomChatId(chatId) {
  return chatId && typeof chatId === 'string' && chatId.startsWith(ROOM_PREFIX);
}

module.exports = {
  toRoomChatId,
  parseRoomChatId,
  toRoomId,
  normalizeRoomId,
  toDirectChatId,
  isRoomChatId,
  ROOM_PREFIX,
  DIRECT_PREFIX,
};
