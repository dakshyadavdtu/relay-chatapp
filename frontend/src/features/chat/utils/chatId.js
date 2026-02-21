/**
 * Chat ID utilities.
 *
 * Canonical formats:
 * - Direct messages: "direct:<minUserId>:<maxUserId>" (IDs sorted lexicographically as strings)
 * - Rooms: "room:<roomId>"
 * - Legacy DMs (UI only): "dm-<otherUserId>"
 *
 * These helpers are pure and have no store access, so they are easy to unit test.
 */

/** Returns true if id is a legacy DM id: "dm-<userId>". */
export function isDmId(id) {
  return typeof id === "string" && id.startsWith("dm-");
}

/** Returns true if id is a canonical direct-chat id: "direct:<min>:<max>". */
export function isDirectId(id) {
  return typeof id === "string" && id.startsWith("direct:");
}

/** Returns true if id is a room id: "room:<roomId>". */
export function isRoomId(id) {
  return typeof id === "string" && id.startsWith("room:");
}

/**
 * Canonical direct chat id for two users.
 * Always returns "direct:<minUserId>:<maxUserId>" where IDs are compared
 * lexicographically as strings (safe for numeric IDs and UUID strings).
 */
export function toDirectIdFromUsers(userId1, userId2) {
  if (!userId1 || !userId2) return null;
  const [a, b] = [String(userId1), String(userId2)].sort(); // lexicographic compare, current behavior
  return `direct:${a}:${b}`;
}

/**
 * Normalize any raw chat id to its canonical form for the current user.
 *
 * - "dm-<other>"  -> "direct:<min(meId,other)>:<max(meId,other)>" (if meId is known)
 * - "direct:*"    -> returned unchanged
 * - "room:*"      -> returned unchanged
 * - anything else -> returned unchanged
 *
 * Note: This helper is intentionally pure; callers must provide `meId`.
 */
export function toCanonicalChatId(rawId, meId) {
  if (!rawId || typeof rawId !== "string") return rawId;

  if (isDmId(rawId)) {
    const other = rawId.slice(3);
    if (!meId || !other) return rawId;
    return toDirectIdFromUsers(meId, other);
  }

  // direct:/room:/other are already in their final forms
  return rawId;
}

/**
 * Key for local UI state (unreadCounts, lastMessagePreviews, messagesByConversation).
 * Deterministic: same input + meId => same key. Use this for all in-memory maps.
 *
 * @param {string|null|undefined} chatIdFromApiOrState - Raw id (e.g. from GET /api/chats, or dm-*, direct:*, room:*)
 * @param {string|null|undefined} meId - Current user id
 * @returns {string|null|undefined} Normalized key (direct:min:max | room:roomId | unchanged)
 */
export function getUiConversationKey(chatIdFromApiOrState, meId) {
  return toCanonicalChatId(chatIdFromApiOrState, meId);
}

/**
 * Id to send to the server (POST /api/chats/:chatId/read, GET /api/chat?chatId=...).
 * Must match exactly what backend stores and returns: direct:min:max | room:roomId.
 *
 * @param {string|null|undefined} chatIdFromApiOrState - Raw id (e.g. from API, state, or legacy dm-/group-)
 * @param {string|null|undefined} meId - Current user id
 * @returns {string|null|undefined} Server-facing chatId (direct:min:max | room:roomId)
 */
export function getServerConversationId(chatIdFromApiOrState, meId) {
  if (!chatIdFromApiOrState || typeof chatIdFromApiOrState !== "string") return chatIdFromApiOrState;
  const t = chatIdFromApiOrState.trim();
  if (t.startsWith("direct:")) return t;
  if (t.startsWith("room:")) return t;
  if (isDmId(t)) {
    const other = t.slice(3);
    if (!meId || !other) return t;
    return toDirectIdFromUsers(meId, other);
  }
  if (t.startsWith("group-")) {
    const roomId = t.slice(6);
    return roomId ? `room:${roomId}` : t;
  }
  return `room:${t}`;
}

