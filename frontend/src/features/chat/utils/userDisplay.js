/**
 * Canonical user display labels for sidebar and chat header.
 * Never show UUID as primary name; use displayName/username or "Unknown".
 */

/**
 * Primary display name: displayName ?? username ?? "Unknown"
 * @param {{ displayName?: string | null, username?: string | null } | null | undefined} user
 * @returns {string}
 */
export function resolveUserPrimary(user) {
  if (!user || typeof user !== "object") return "Unknown";
  const name = user.displayName ?? user.username;
  return typeof name === "string" && name.trim() ? name.trim() : "Unknown";
}

/**
 * Secondary line (e.g. under name in sidebar): email ?? @username ?? ""
 * @param {{ email?: string | null, username?: string | null } | null | undefined} user
 * @returns {string}
 */
export function resolveUserSecondary(user) {
  if (!user || typeof user !== "object") return "";
  const email = user.email;
  if (typeof email === "string" && email.trim()) return email.trim();
  const username = user.username;
  if (typeof username === "string" && username.trim()) return `@${username.trim()}`;
  return "";
}
