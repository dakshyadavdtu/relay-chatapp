/**
 * Report API - POST /api/reports.
 * category is required (Spam | Harassment | Hate speech | Sexual content | Illegal). priority is derived by backend.
 * User report: { targetUserId, category, reason, details? }
 * Message report: { messageId, conversationId, senderId, category, reason, details? }
 */
import { apiFetch } from "@/lib/http";

/**
 * Create a report (user or message). Backend derives priority from category; client must not send priority.
 * @param {Object} payload - category (required), reason (required), details?; plus targetUserId OR messageId+conversationId+senderId
 * @returns {Promise<{ success: boolean, data?: { id, createdAt, status } }>}
 */
export async function createReport(payload) {
  const json = await apiFetch("/api/reports", {
    method: "POST",
    body: payload,
  });
  return json;
}
