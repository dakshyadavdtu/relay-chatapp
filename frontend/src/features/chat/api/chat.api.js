/**
 * Chat HTTP API. All calls go through Vite proxy /api.
 */
import { apiFetch, getApiOrigin } from "@/lib/http";
import { getAuthState } from "@/state/auth.state";
import { getServerConversationId } from "../utils/chatId.js";

export async function getChats() {
  const json = await apiFetch("/api/chats");
  return json?.data?.chats ?? [];
}

/**
 * Persist read cursor for direct chat (POST /api/chats/:chatId/read). Backend is source of truth; unread persists across refresh.
 * @param {string} conversationId - Canonical conversation id (e.g. direct:u1:u2)
 * @param {string} lastReadMessageId - Latest message id to mark as read
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function markChatRead(conversationId, lastReadMessageId) {
  if (!conversationId || !lastReadMessageId) return { ok: false, error: "Missing conversationId or lastReadMessageId" };
  const me = getAuthState().user?.id;
  if (!me) return { ok: false, error: "Not authenticated" };
  const serverChatId = getServerConversationId(conversationId, me);
  const url = `/api/chats/${encodeURIComponent(serverChatId)}/read`;
  try {
    const json = await apiFetch(url, {
      method: "POST",
      body: { lastReadMessageId },
    });
    return json?.data?.ok === true ? { ok: true } : { ok: false, error: json?.error || "Mark read failed" };
  } catch (e) {
    return { ok: false, error: e?.message || "Mark read failed" };
  }
}

/**
 * @deprecated Use getServerConversationId from ../utils/chatId.js for consistency.
 * Convert frontend conversationId to backend chatId (same as getServerConversationId).
 */
export function toBackendChatId(conversationId, currentUserId) {
  return getServerConversationId(conversationId, currentUserId);
}

/**
 * Get paginated chat history. Supports both direct (direct:u1:u2) and room (room:<roomId>) conversations.
 * Backend: GET /api/chat?chatId=...&limit=...&beforeId=... (same endpoint for DM and room).
 */
export async function getHistory(chatId, { limit = 50, beforeId } = {}) {
  const currentUserId = getAuthState().user?.id;
  const serverChatId = getServerConversationId(chatId, currentUserId);
  const params = new URLSearchParams({ chatId: serverChatId, limit: String(limit) });
  if (beforeId) params.set("beforeId", beforeId);
  const url = `/api/chat?${params.toString()}`;
  const json = await apiFetch(url);
  const messages = json?.data?.messages ?? [];
  const nextCursor = json?.data?.nextCursor ?? null;
  const hasMore = json?.data?.hasMore ?? false;
  return { messages, nextCursor, hasMore };
}

/**
 * Export chat as JSON. Requires auth. Triggers browser download.
 * @param {string} chatId - Backend chatId (direct:u1:u2 or room:roomId)
 * @returns {Promise<{ ok: boolean, error?: string, status?: number }>}
 */
export async function exportChatJson(chatId) {
  const base = getApiOrigin();
  const url = base ? `${base}/api/export/chat/${encodeURIComponent(chatId)}.json` : `/api/export/chat/${encodeURIComponent(chatId)}.json`;
  // TEMP Phase 1 debug: remove in Phase 2
  console.debug("[export] exportChatJson URL=", url);
  const res = await fetch(url, { method: "GET", credentials: "include" }); // Session cookie required
  // TEMP Phase 1 debug: remove in Phase 2
  console.debug("[export] exportChatJson res.status=", res.status, "Content-Type=", res.headers.get("Content-Type"), "Content-Disposition=", res.headers.get("Content-Disposition"));
  if (!res.ok) {
    const text = await res.text();
    let errMsg = "Export failed";
    try {
      const j = JSON.parse(text);
      errMsg = j?.error || errMsg;
    } catch (_) {}
    return { ok: false, error: errMsg, status: res.status };
  }
  const blob = await res.blob();
  const disposition = res.headers.get("Content-Disposition");
  let filename = `chat_export.json`;
  if (disposition) {
    const m = disposition.match(/filename="?([^";\n]+)"?/);
    if (m) filename = m[1].trim();
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
  return { ok: true };
}

/**
 * Export chat as PDF. Requires auth. Triggers browser download.
 * @param {string} chatId - Backend chatId (direct:u1:u2 or room:roomId)
 * @returns {Promise<{ ok: boolean, error?: string, status?: number }>}
 */
export async function exportChatPdf(chatId) {
  const base = getApiOrigin();
  const url = base ? `${base}/api/export/chat/${encodeURIComponent(chatId)}.pdf` : `/api/export/chat/${encodeURIComponent(chatId)}.pdf`;
  const res = await fetch(url, { method: "GET", credentials: "include" }); // Session cookie required
  if (!res.ok) {
    const text = await res.text();
    let errMsg = "Export failed";
    try {
      const j = JSON.parse(text);
      errMsg = j?.error || errMsg;
    } catch (_) {}
    return { ok: false, error: errMsg, status: res.status };
  }
  const blob = await res.blob();
  const disposition = res.headers.get("Content-Disposition");
  let filename = `chat_export.pdf`;
  if (disposition) {
    const m = disposition.match(/filename="?([^";\n]+)"?/);
    if (m) filename = m[1].trim();
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
  return { ok: true };
}

/** DEPRECATED: Realtime send must use WebSocket. HTTP send disabled. */
export async function sendMessage(recipientId, content, clientMessageId) {
  throw new Error("HTTP /api/chat/send disabled. Use WebSocket (transport/wsClient) for realtime messages.");
  const json = await apiFetch("/api/chat/send", {
    method: "POST",
    body: { recipientId, content, clientMessageId },
  });
  return json?.data?.message ?? null;
}
