/**
 * Conversation domain helpers.
 */

export function getConversationId(activeGroupId, activeDmUser) {
  if (activeDmUser) {
    const userId = typeof activeDmUser === "object" ? activeDmUser?.id : activeDmUser;
    return userId ? `dm-${userId}` : null;
  }
  if (activeGroupId != null) {
    return `group-${activeGroupId}`;
  }
  return null;
}

export function sortChatItems(groups = [], users = [], lastActivityTimestamps = {}) {
  const items = [];
  groups.forEach((g) => {
    items.push({ type: "group", id: `group-${g.id}`, group: g, timestamp: lastActivityTimestamps[`group-${g.id}`] || 0 });
  });
  users.forEach((u) => {
    items.push({ type: "dm", id: `dm-${u.id}`, user: u, timestamp: lastActivityTimestamps[`dm-${u.id}`] || 0 });
  });
  items.sort((a, b) => b.timestamp - a.timestamp);
  return items;
}
