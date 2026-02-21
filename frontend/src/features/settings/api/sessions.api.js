/**
 * Sessions API - active sessions and logout. Uses lib/http apiFetch.
 */

import { apiFetch } from "@/lib/http";

/**
 * GET /api/sessions/active - List active sessions for current user.
 * @param {{ liveOnly?: boolean }} [opts] - If liveOnly is true, appends ?liveOnly=1 (live sessions only).
 * @returns {Promise<{ success: boolean, data?: { sessions: Array<{ sessionId: string, userId: string, createdAt: string, lastSeenAt: string, userAgent?: string, ip?: string, device?: string, isCurrent: boolean }> } }>}
 */
export async function getActiveSessions(opts = {}) {
  const search = new URLSearchParams();
  if (opts.liveOnly === true) {
    search.set("liveOnly", "1");
  }
  const qs = search.toString();
  const path = qs ? `/api/sessions/active?${qs}` : "/api/sessions/active";
  return apiFetch(path, { method: "GET" });
}

/**
 * POST /api/sessions/logout - Log out a session.
 * With sessionId: invalidates that session (current or other device).
 * Without body: invalidates current session only.
 * @param {{ sessionId?: string }} [body] - Optional sessionId for "log out this session"
 * @returns {Promise<{ success: boolean, data?: object }>}
 */
export function logoutSession(body) {
  return apiFetch("/api/sessions/logout", { method: "POST", body: body ?? {} });
}

/**
 * POST /api/sessions/logout-all - Revoke all sessions for the current user.
 * On success, backend clears auth cookies; client should clear state and redirect to /login.
 * @returns {Promise<{ success: boolean, data?: { revokedCount?: number } }>}
 */
export function logoutAllSessions() {
  return apiFetch("/api/sessions/logout-all", { method: "POST", body: {} });
}
