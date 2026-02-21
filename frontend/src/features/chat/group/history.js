/**
 * Group/room history loader. Fetches messages from GET /api/chat?chatId=room:<id>.
 */
import { getHistory } from "../api/chat.api";
import { toRoomChatId, normalizeRoomId } from "./identity";

/**
 * Fetch room message history from backend.
 * @param {string} roomIdRaw - Raw room id (or "room:xxx")
 * @param {number} [limit=50]
 * @param {string|null} [beforeId] - Cursor for pagination
 * @returns {Promise<{ messages: Array<object>, nextCursor: string|null, hasMore: boolean }>}
 */
export async function getRoomHistory(roomIdRaw, limit = 50, beforeId = null) {
  const raw = normalizeRoomId(roomIdRaw);
  if (!raw) {
    return { messages: [], nextCursor: null, hasMore: false };
  }
  const chatId = toRoomChatId(raw);
  return getHistory(chatId, { limit, beforeId });
}
