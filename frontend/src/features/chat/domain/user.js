/**
 * User domain helpers (from mychat source).
 * Presence: unknown (no entry) => "—"; online => Online/Away/Busy; known offline => Offline.
 */

export function formatUserStatus(presenceEntry) {
  if (presenceEntry == null || presenceEntry === undefined) return "—";
  const isOnline = presenceEntry.online === true;
  const status = presenceEntry.status ?? null;
  const lastSeen = presenceEntry.lastSeen ?? null;
  if (isOnline) return status === "away" ? "Away" : status === "busy" ? "Busy" : "Online";
  if (lastSeen) return "Last seen recently";
  return "Offline";
}

export function countOnlineUsers(users = [], onlineUserIds = new Set(), overrides = {}) {
  if (!Array.isArray(users)) return 0;
  return users.filter((user) => {
    if (overrides[user.id] !== undefined) return overrides[user.id];
    if (onlineUserIds.has(user.id)) return true;
    return user.isOnline === true;
  }).length;
}
