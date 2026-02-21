/**
 * Conversation domain helpers (from mychat source).
 */

import { toDirectIdFromUsers, toCanonicalChatId } from "../utils/chatId.js";

/**
 * Get conversation ID from active group/DM selection.
 * 
 * PHASE A2: If myUserId is provided and activeDmUser is set, returns canonical direct:* format.
 * Otherwise returns legacy dm-* format (for backward compatibility with legacy code).
 * 
 * @param {string|null} activeGroupId - Active group ID
 * @param {string|null} activeDmUser - Active DM user ID
 * @param {string|null} myUserId - Optional current user ID (if provided, returns canonical format for DMs)
 * @returns {string|null} Conversation ID (canonical direct:* if myUserId provided, else legacy dm-*)
 */
export function getConversationId(activeGroupId, activeDmUser, myUserId = null) {
  if (activeDmUser) {
    // PHASE A2: Return canonical format if myUserId is available
    if (myUserId) {
      return toDirectIdFromUsers(myUserId, activeDmUser);
    }
    // Legacy format for backward compatibility
    return `dm-${activeDmUser}`;
  }
  if (activeGroupId != null) return `room:${activeGroupId}`;
  return null;
}

export function sortChatItems(groups = [], users = [], lastActivityTimestamps = {}, myUserId = null) {
  const items = [];
  groups.forEach((g) => {
    items.push({ type: "group", id: `room:${g.id}`, group: g, timestamp: lastActivityTimestamps[`room:${g.id}`] || 0 });
  });
  users.forEach((u) => {
    // PHASE D: Use only direct:* for storage lookup; id is canonical so sidebar/selection use same key.
    const canonicalId = myUserId && u.id ? toDirectIdFromUsers(myUserId, u.id) : null;
    const lookupKey = canonicalId; // never dm-* — store keys are direct:*
    items.push({ type: "dm", id: canonicalId || `dm-${u.id}`, user: u, timestamp: lookupKey ? (lastActivityTimestamps[lookupKey] || 0) : 0 });
  });
  items.sort((a, b) => b.timestamp - a.timestamp);
  return items;
}
