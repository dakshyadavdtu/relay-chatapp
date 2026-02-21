/**
 * Phase 3C: lastSeenMessageId for RESUME flow.
 * Backend replays messages AFTER lastSeenMessageId (exclusive).
 * Persisted in memory; optional localStorage for cross-tab/session.
 */

const STORAGE_KEY = "chat:lastSeenMessageId";

function load() {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
    return raw || null;
  } catch {
    return null;
  }
}

function save(lastSeenMessageId) {
  if (lastSeenMessageId == null) return;
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(STORAGE_KEY, String(lastSeenMessageId));
    }
  } catch {
    // ignore
  }
}

let memoryLastSeen = load();

export function getLastSeenMessageId() {
  return memoryLastSeen || null;
}

/**
 * Update lastSeen. Use max of current and new (by string compare for time-ordered IDs).
 */
export function updateLastSeenMessageId(messageId) {
  if (!messageId) return memoryLastSeen;
  const current = memoryLastSeen || "";
  const next = String(messageId);
  if (next && (next > current || !current)) {
    memoryLastSeen = next;
    save(next);
  }
  return memoryLastSeen;
}

export function clearLastSeenMessageId() {
  memoryLastSeen = null;
  try {
    if (typeof localStorage !== "undefined") localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
