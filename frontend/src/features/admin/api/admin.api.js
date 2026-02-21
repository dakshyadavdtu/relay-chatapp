/**
 * Admin API - backend is source of truth.
 * All HTTP via apiFetch from lib/http.js. No direct fetch/axios.
 * Centralized normalizers so UI can rely on stable keys (no missing keys).
 */
import { apiFetch } from "@/lib/http";

// ─── Normalizers (backend → UI-stable shape) ─────────────────────────────────

/**
 * Normalize one user from GET /api/admin/users.
 * Ensures: numbers are numbers (default 0), avgLatencyMs null if missing, role lowercased.
 */
function normalizeUser(u) {
  if (!u || typeof u !== "object") return null;
  const role = (u.role != null && typeof u.role === "string")
    ? u.role.toLowerCase()
    : "user";
  return {
    id: u.id ?? "",
    username: u.username ?? u.id ?? "",
    role,
    status: u.status === "online" ? "online" : "offline",
    banned: Boolean(u.banned),
    flagged: Boolean(u.flagged),
    messages: typeof u.messages === "number" ? u.messages : 0,
    reconnects: typeof u.reconnects === "number" ? u.reconnects : 0,
    failures: typeof u.failures === "number" ? u.failures : 0,
    violations: typeof u.violations === "number" ? u.violations : 0,
    avgLatencyMs: u.avgLatencyMs != null && typeof u.avgLatencyMs === "number" ? u.avgLatencyMs : null,
    lastSeen: u.lastSeen ?? null,
    email: u.email ?? null,
    isRootAdmin: Boolean(u.isRootAdmin),
  };
}

/**
 * Normalize one session from GET /api/admin/users/:id/sessions.
 * Stable keys + UI aliases: id = sessionId, current = false, lastSeen = lastSeenAt.
 */
function normalizeSession(s) {
  if (!s || typeof s !== "object") return null;
  const sessionId = s.sessionId ?? s.id ?? "";
  const lastSeenAt = s.lastSeenAt ?? s.lastSeen ?? null;
  return {
    sessionId,
    createdAt: s.createdAt ?? null,
    lastSeenAt,
    revokedAt: s.revokedAt ?? null,
    userAgent: s.userAgent ?? null,
    ip: s.ip ?? null,
    device: typeof s.device === "string" && s.device ? s.device : "Unknown",
    id: sessionId,
    current: Boolean(s.current ?? s.isCurrent ?? false),
    lastSeen: lastSeenAt,
    location: s.location ?? null,
  };
}

/**
 * GET /api/admin/dashboard
 * Returns { success, data } where data has: onlineUsers, messagesPerSecond, latencyAvg,
 * suspiciousFlags, adminsCount, regularUsersCount.
 */
export async function fetchAdminDashboard() {
  const json = await apiFetch("/api/admin/dashboard", { method: "GET" });
  return json.data;
}

/**
 * GET /api/admin/dashboard/timeseries
 * Returns { success, data } where data has: windowSeconds, bucketSeconds, points[].
 * points: [{ time (ISO), messages, connections }]
 */
export async function fetchAdminDashboardTimeseries(params = {}) {
  const { windowSeconds, bucketSeconds } = params;
  const search = new URLSearchParams();
  if (windowSeconds != null) search.set("windowSeconds", String(windowSeconds));
  if (bucketSeconds != null) search.set("bucketSeconds", String(bucketSeconds));
  const query = search.toString();
  const path = query ? `/api/admin/dashboard/timeseries?${query}` : "/api/admin/dashboard/timeseries";
  const json = await apiFetch(path, { method: "GET" });
  return json.data;
}

/**
 * GET /api/admin/dashboard/series
 * Returns { success, data } where data has: windowSeconds, intervalSeconds, points[].
 * points: [{ ts, label, messagesPerSecondAvg, connectionsAvg }]
 */
export async function fetchAdminDashboardSeries(params = {}) {
  const { windowSeconds, intervalSeconds } = params;
  const search = new URLSearchParams();
  if (windowSeconds != null) search.set("windowSeconds", String(windowSeconds));
  if (intervalSeconds != null) search.set("intervalSeconds", String(intervalSeconds));
  const query = search.toString();
  const path = query ? `/api/admin/dashboard/series?${query}` : "/api/admin/dashboard/series";
  const json = await apiFetch(path, { method: "GET" });
  return json.data;
}

/**
 * GET /api/admin/dashboard/activity
 * Returns { success, data } where data has: windowSeconds, items[].
 * items: [{ id, type, title, detail, createdAt (ISO) }]
 */
export async function fetchAdminDashboardActivity(params = {}) {
  const { limit, windowSeconds } = params;
  const search = new URLSearchParams();
  if (limit != null) search.set("limit", String(limit));
  if (windowSeconds != null) search.set("windowSeconds", String(windowSeconds));
  const query = search.toString();
  const path = query ? `/api/admin/dashboard/activity?${query}` : "/api/admin/dashboard/activity";
  const json = await apiFetch(path, { method: "GET" });
  return json.data;
}

/**
 * GET /api/admin/dashboard/stats
 * Returns { success, data } with extended stats: messagesPerSecondPeak, messagesPerSecondP95,
 * latencyMaxMs, latencyAvgP95, suspiciousFlagsDeltaLastHour (optional).
 * Always returns an object so hook never receives undefined.
 */
export async function fetchAdminDashboardStats() {
  const json = await apiFetch("/api/admin/dashboard/stats", { method: "GET" });
  const data = json?.data ?? json;
  return data && typeof data === "object" ? data : {};
}

/**
 * GET /api/admin/activity
 * Returns { success, data } where data has: windowSeconds, maxEvents, events[].
 * events: [{ type, title, detail, ts, severity }]
 */
export async function fetchAdminActivity(params = {}) {
  const { windowSeconds, maxEvents } = params;
  const search = new URLSearchParams();
  if (windowSeconds != null) search.set("windowSeconds", String(windowSeconds));
  if (maxEvents != null) search.set("maxEvents", String(maxEvents));
  const query = search.toString();
  const path = query ? `/api/admin/activity?${query}` : "/api/admin/activity";
  const json = await apiFetch(path, { method: "GET" });
  return json.data;
}

/**
 * GET /api/admin/users/:id/sessions
 * Returns { userId, sessions } with each session normalized: sessionId, createdAt, lastSeenAt, revokedAt, userAgent, ip, device, id, current, lastSeen, location.
 */
export async function fetchAdminUserSessions(userId, params = {}) {
  const { limit, liveOnly } = params;
  const search = new URLSearchParams();
  if (limit != null) search.set("limit", String(limit));
  if (liveOnly === true) search.set("liveOnly", "1");
  const query = search.toString();
  const path = query
    ? `/api/admin/users/${encodeURIComponent(userId)}/sessions?${query}`
    : `/api/admin/users/${encodeURIComponent(userId)}/sessions`;
  const json = await apiFetch(path, { method: "GET" });
  const data = json.data ?? json;
  const raw = Array.isArray(data?.sessions) ? data.sessions : [];
  const sessions = raw.map((s) => normalizeSession(s)).filter(Boolean);
  return { userId: data?.userId ?? userId, sessions };
}

/**
 * GET /api/admin/users?q=...&cursor=...&limit=...
 * Returns { users, nextCursor, total, notAvailable } with each user normalized: id, username, role (lowercase), status, banned, flagged, messages, reconnects, failures, violations, avgLatencyMs, lastSeen, email.
 */
export async function fetchAdminUsers(params = {}) {
  const { q = "", cursor, limit } = params;
  const search = new URLSearchParams();
  if (q) search.set("q", q);
  if (cursor != null) search.set("cursor", String(cursor));
  if (limit != null) search.set("limit", String(limit));
  const query = search.toString();
  const path = query ? `/api/admin/users?${query}` : "/api/admin/users";
  const json = await apiFetch(path, { method: "GET" });
  const data = json.data ?? json;
  const raw = Array.isArray(data?.users) ? data.users : [];
  const users = raw.map((u) => normalizeUser(u)).filter(Boolean);
  return {
    users,
    nextCursor: data?.nextCursor ?? null,
    total: typeof data?.total === "number" ? data.total : 0,
    notAvailable: Array.isArray(data?.notAvailable) ? data.notAvailable : [],
  };
}

/**
 * Normalize report details from GET /api/admin/reports/:id.
 * Ensures UI always gets { report, message, context, window, contextError?, insights?, userMeta? } with safe defaults.
 */
function normalizeReportDetails(raw) {
  const report = raw?.report && typeof raw.report === "object" ? raw.report : {};
  const message = raw?.message != null && typeof raw.message === "object" ? raw.message : null;
  const context = Array.isArray(raw?.context) ? raw.context : [];
  const windowNum = typeof raw?.window === "number" && raw.window >= 0 ? raw.window : 0;
  const contextError =
    typeof raw?.contextError === "string" && raw.contextError ? raw.contextError : undefined;

  // Normalize insights (suspiciousFlagsCount + suspiciousFlags array from backend)
  const rawInsights = raw?.insights;
  const insights = rawInsights && typeof rawInsights === "object"
    ? {
        messageRate: typeof rawInsights.messageRate === "number" ? rawInsights.messageRate : 0,
        prevWarnings: typeof rawInsights.prevWarnings === "number" ? rawInsights.prevWarnings : 0,
        recentReports: typeof rawInsights.recentReports === "number" ? rawInsights.recentReports : 0,
        suspiciousFlagsCount:
          typeof rawInsights.suspiciousFlagsCount === "number" ? rawInsights.suspiciousFlagsCount
          : Array.isArray(rawInsights.suspiciousFlags) ? rawInsights.suspiciousFlags.length
          : 0,
        suspiciousFlags: Array.isArray(rawInsights.suspiciousFlags)
          ? rawInsights.suspiciousFlags
          : [],
      }
    : null;

  // Normalize userMeta
  const rawUserMeta = raw?.userMeta;
  const userMeta = rawUserMeta && typeof rawUserMeta === "object"
    ? {
        accountCreatedAt: rawUserMeta.accountCreatedAt ?? null,
        lastKnownIp: rawUserMeta.lastKnownIp ?? null,
        totalReports: typeof rawUserMeta.totalReports === "number" ? rawUserMeta.totalReports : 0,
      }
    : null;

  return {
    report,
    message,
    context,
    window: windowNum,
    ...(contextError !== undefined && { contextError }),
    ...(insights && { insights }),
    ...(userMeta && { userMeta }),
  };
}

/**
 * GET /api/admin/reports
 * Returns { success, data } where data has reports list or { notAvailable: true, reason }.
 */
export async function fetchAdminReports() {
  const json = await apiFetch("/api/admin/reports", { method: "GET" });
  return json.data;
}

/**
 * GET /api/admin/reports/:id
 * Returns normalized { report, message, context, window, contextError? } so UI never crashes on missing keys.
 */
export async function fetchAdminReportDetails(reportId) {
  const json = await apiFetch(`/api/admin/reports/${encodeURIComponent(reportId)}`, {
    method: "GET",
  });
  const data = json?.data ?? json ?? {};
  return normalizeReportDetails(data);
}

/**
 * POST /api/admin/reports/:id/resolve
 * Resolve a report by id. Returns { success } on 200.
 */
export async function resolveAdminReport(reportId) {
  return apiFetch(`/api/admin/reports/${encodeURIComponent(reportId)}/resolve`, {
    method: "POST",
  });
}

/**
 * POST /api/admin/users/:id/role
 * Body: { role }. Backend returns { success, message, user: { userId, role } }.
 */
export async function setUserRole(userId, role) {
  return apiFetch(`/api/admin/users/${encodeURIComponent(userId)}/role`, {
    method: "POST",
    body: { role },
  });
}

/**
 * POST /api/admin/users/:id/warn
 * Record a warning for the user. Body: { reason?, reportId? }.
 * When reportId is provided (e.g. from reports section), only one warning per user per report is allowed; duplicate returns 409.
 */
export async function adminWarnUser(userId, reason, reportId) {
  const body = {};
  if (reason != null && String(reason).trim()) body.reason = String(reason).trim().slice(0, 500);
  if (reportId != null && String(reportId).trim()) body.reportId = String(reportId).trim().slice(0, 256);
  return apiFetch(`/api/admin/users/${encodeURIComponent(userId)}/warn`, {
    method: "POST",
    body,
  });
}

/**
 * POST /api/admin/users/:id/ban
 * Soft-ban user. Returns { success, data: { userId, banned: true } }.
 */
export async function adminBanUser(userId) {
  return apiFetch(`/api/admin/users/${encodeURIComponent(userId)}/ban`, {
    method: "POST",
  });
}

/**
 * POST /api/admin/users/:id/unban
 * Remove ban. Returns { success, data: { userId, banned: false } }.
 */
export async function adminUnbanUser(userId) {
  return apiFetch(`/api/admin/users/${encodeURIComponent(userId)}/unban`, {
    method: "POST",
  });
}

/**
 * POST /api/admin/users/:id/revoke-sessions
 * Revoke all sessions for the user. Returns { success, data: { userId, revoked: true, count } }.
 */
export async function adminRevokeSessions(userId) {
  return apiFetch(`/api/admin/users/${encodeURIComponent(userId)}/revoke-sessions`, {
    method: "POST",
  });
}

/**
 * POST /api/admin/users/:id/sessions/:sessionId/revoke
 * Revoke one device session. Returns { success, data: { userId, sessionId, revoked: true } }.
 */
export async function adminRevokeOneSession(userId, sessionId) {
  return apiFetch(
    `/api/admin/users/${encodeURIComponent(userId)}/sessions/${encodeURIComponent(sessionId)}/revoke`,
    { method: "POST" }
  );
}
