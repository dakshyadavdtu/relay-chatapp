/**
 * User search API for chat sidebar / DM picker.
 */
import { apiFetch } from "@/lib/http";

/**
 * Search users by username/email (server-side). Shape: id, username, displayName, avatarUrl, email.
 * @param {string} q - Search query
 * @returns {Promise<{ users: Array<{ id, username, displayName, avatarUrl?, email? }> }>}
 */
export async function searchUsers(q) {
  const trimmed = typeof q === "string" ? q.trim() : "";
  if (!trimmed) return { users: [] };
  const json = await apiFetch(`/api/users/search?q=${encodeURIComponent(trimmed)}`);
  return json?.data ?? json ?? { users: [] };
}
