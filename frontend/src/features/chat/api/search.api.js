/**
 * Global search API: groups, contacts, and message content.
 * GET /api/search?q=<query>&includeClientMsgId=<id> (optional, for read-your-write).
 */
import { apiFetch } from "@/lib/http";

/**
 * @param {string} q - Search query
 * @param {{ includeClientMsgId?: string }} [opts] - optional; includeClientMsgId forces-include that message in results
 * @returns {Promise<{ groups: Array<{ id, name, thumbnailUrl }>, contacts: Array<APIUser>, messages: Array<{ messageId, chatId, chatType, senderId, preview, createdAt }> }>}
 */
export async function globalSearch(q, opts = {}) {
  const trimmed = typeof q === "string" ? q.trim() : "";
  if (!trimmed) return { groups: [], contacts: [], messages: [] };
  const params = new URLSearchParams({ q: trimmed });
  if (opts.includeClientMsgId && typeof opts.includeClientMsgId === "string") {
    params.set("includeClientMsgId", opts.includeClientMsgId.trim());
  }
  const json = await apiFetch(`/api/search?${params.toString()}`);
  const data = json?.data ?? json ?? {};
  return {
    groups: Array.isArray(data.groups) ? data.groups : [],
    contacts: Array.isArray(data.contacts) ? data.contacts : [],
    messages: Array.isArray(data.messages) ? data.messages : [],
  };
}
