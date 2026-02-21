'use strict';

/**
 * Admin controller for role management and admin UI.
 * Admin-only operations that require elevated privileges.
 *
 * NOTE: This controller violates HTTP architectural boundaries by accessing WebSocket
 * connection manager. This is intentional and limited to admin operations.
 */

const { ROLES } = require('../../auth/roles');
const { VALID_ROLES } = require('../../models/User.model');
const { capabilitiesFor } = require('../../auth/capabilities');
const logger = require('../../utils/logger');
const userDiagnostics = require('../../diagnostics/userDiagnosticsAggregator');
const connectionManager = require('../../websocket/connection/connectionManager');
const observability = require('../../observability');
const suspiciousDetector = require('../../suspicious/suspicious.detector');
const { sendError, sendSuccess } = require('../../utils/errorResponse');
const {
  validateUserId,
  validateReportId,
  validateOptionalString,
  validateConversationId,
  validateRequiredIntInRange,
  validateOptionalCursor,
  validateOptionalSenderId,
} = require('../../utils/adminValidation');
const userStoreStorage = require('../../storage/user.store');
const reportsStore = require('../../storage/reports.store');
const messageStore = require('../../services/message.store');
const { toApiShape } = require('../../models/Message.model');
const { toApiMessage } = require('../../utils/apiShape');
const warningsStore = require('../../storage/warnings.store');
const config = require('../../config/constants');
const { isRootUser, guardRootTarget } = require('../../auth/rootProtection');
const redisBus = require('../../services/redisBus');
const adminDashboardBuffer = require('../../observability/adminDashboardBuffer');
const adminActivityBuffer = require('../../observability/adminActivityBuffer');
const messagesAggregator = require('../../observability/aggregators/messages');
const { getLiveWindowMs, isLiveSession } = require('../../utils/sessionLive');
const { normalizeIp } = require('../../utils/ip');

/**
 * List users for root admin (id, email, username, role, createdAt).
 * GET /admin/root/users — requireRootAdmin only.
 */
async function getRootUsersList(req, res) {
  const users = userStoreStorage.listAllWithEmail
    ? await userStoreStorage.listAllWithEmail()
    : (await userStoreStorage.listAll()).map((u) => ({ ...u, email: null }));
  if (!userStoreStorage.listAllWithEmail && users.length) {
    for (const u of users) {
      const full = await userStoreStorage.findById(u.id);
      u.email = full?.email ?? null;
    }
  }
  return sendSuccess(res, { users });
}

/**
 * Promote / set user role (root only).
 * POST /admin/users/:id/role or POST /admin/root/users/:id/role
 * Root invariants: only root can change roles; root cannot be demoted.
 * 
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 */
async function promoteUserToAdmin(req, res) {
  const { id } = req.params;
  const { role } = req.body;
  const actorUserId = req.user.userId;
  const actorIsRootAdmin = !!req.user.isRootAdmin;

  // Root invariant: only root can change other users' roles
  if (!actorIsRootAdmin) {
    return res.status(403).json({
      success: false,
      error: 'Only root admin can change roles',
      code: 'ROOT_REQUIRED',
    });
  }

  const idRes = validateUserId(id);
  if (!idRes.ok) {
    logger.warn('Admin', 'role_promote_validation', { actor: actorUserId, target: id, error: idRes.error });
    return res.status(400).json({ success: false, error: idRes.error, code: idRes.code });
  }

  // Validate payload: role must be one of USER, ADMIN (cannot assign unknown roles)
  if (role === undefined || role === null || typeof role !== 'string') {
    return res.status(400).json({
      success: false,
      error: 'Role is required',
      code: 'INVALID_PAYLOAD',
    });
  }
  if (!VALID_ROLES.includes(role)) {
    return res.status(400).json({
      success: false,
      error: `Role must be one of: ${VALID_ROLES.join(', ')}`,
      code: 'INVALID_PAYLOAD',
    });
  }

  const targetId = idRes.value;
  // Cannot change your own role
  if (targetId === actorUserId) {
    return res.status(400).json({
      success: false,
      error: 'Cannot change your own role',
      code: 'SELF_ROLE_CHANGE_NOT_ALLOWED',
    });
  }

  const targetUser = await userStoreStorage.findById(targetId);
  if (!targetUser) {
    return res.status(404).json({
      success: false,
      error: 'User not found',
      code: 'USER_NOT_FOUND',
    });
  }

  // Root invariant: root role is immutable (no one can modify it)
  if (isRootUser(targetUser)) {
    return sendError(res, 403, 'Root admin is protected', 'ROOT_ADMIN_PROTECTED');
  }

  const oldRole = targetUser.role != null ? targetUser.role : ROLES.USER;
  const newRole = role;

  await userStoreStorage.updateRole(targetId, newRole);

  // Audit logging (non-blocking)
  const auditInfo = {
    actor: actorUserId,
    target: targetId,
    oldRole,
    newRole,
    timestamp: Date.now(),
  };
  logger.info('Admin', 'role_promoted', auditInfo);

  // Recompute capabilities immediately (role is the ONLY input)
  const newCapabilities = capabilitiesFor(newRole);

  // Propagate capabilities to active WebSocket connections
  // NOTE: This violates HTTP architectural boundaries but is necessary for admin operations
  try {
    const connectionManager = require('../../websocket/connection/connectionManager');
    const socketSafety = require('../../websocket/safety/socketSafety');
    
    const ws = connectionManager.getSocket(targetId);
    if (ws && ws.context) {
      // Option A: Soft update - update context and push capabilities live
      ws.context.role = newRole;
      ws.context.capabilities = newCapabilities;

      // Emit SYSTEM_CAPABILITIES to active connection
      const result = socketSafety.sendMessage(ws, {
        type: 'SYSTEM_CAPABILITIES',
        capabilities: newCapabilities
      });

      if (result.shouldClose) {
        socketSafety.closeAbusiveConnection(ws, 'Slow consumer: queue overflow', 1008);
      }

      logger.info('Admin', 'capabilities_propagated', {
        userId: targetId,
        queued: result.queued,
      });
    }
  } catch (error) {
    // Log error but don't fail the promotion
    logger.error('Admin', 'capability_propagation_error', {
      userId: targetId,
      error: error.message,
    });
  }

  // Target is never root when we allow the change; include isRootAdmin for client consistency
  res.status(200).json({
    success: true,
    message: 'Role updated',
    user: {
      userId: targetId,
      username: targetUser.username ?? targetId,
      role: newRole,
      isRootAdmin: false,
    },
  });
}

/**
 * Get dashboard aggregates for admin UI.
 * GET /api/admin/dashboard
 * ADMIN only.
 */
function getDashboard(req, res) {
  try {
    const capabilities = capabilitiesFor(ROLES.ADMIN);
    const snapshot = observability.getSnapshot(capabilities);

    const connections = snapshot.network?.connections || {};
    const countByRole = connections.countByRole || { admin: 0, user: 0 };
    const latency = snapshot.network?.latency || {};
    const events = snapshot.events || {};

    const suspiciousFlags = suspiciousDetector.getTotalFlagsCount();

    // Online users = unique userIds with at least one active WS (not total socket count)
    const onlineUsers = (() => { try { return connectionManager.getOnlineUserCount(); } catch { return 0; } })();

    // MPS and latency from backend-only delta-based buffer (1s sampling, 60-sample ring). Frontend must NOT compute rates.
    const extendedStats = adminDashboardBuffer.getExtendedStats();

    let messagesPerSecondAvg60 = adminDashboardBuffer.getMpsAvg60();
    const messagesLastMinute = events.messagesLastMinute ?? 0;

    // Fallback: If avg60 is 0 or missing but messagesLastMinute > 0, compute avg from lastMinute/60.
    // This handles cases where the buffer hasn't filled yet (< 60s of data) or delta calculation shows 0.
    // Log once when mismatch occurs (avg60 is 0 but lastMinute > 0) to help diagnose metrics issues.
    if ((messagesPerSecondAvg60 == null || messagesPerSecondAvg60 === 0) && messagesLastMinute > 0) {
      const computedAvg = Math.round((messagesLastMinute / 60) * 100) / 100;
      if (messagesPerSecondAvg60 === 0) {
        // Debug log only when there's a mismatch (avg60 is 0 but lastMinute > 0)
        logger.info('Admin', 'dashboard_mps_fallback', {
          messagesPerSecondAvg60,
          messagesLastMinute,
          computedAvg,
          note: 'Using computed avg from messagesLastMinute/60 as fallback',
        });
      }
      messagesPerSecondAvg60 = computedAvg;
    }

    const data = {
      onlineUsers,
      messagesPerSecond: adminDashboardBuffer.getCurrentMps(),
      messagesPerSecondAvg60,
      messagesPerSecondPeak: extendedStats.messagesPerSecondPeak ?? undefined,
      messagesPerSecondP95: extendedStats.messagesPerSecondP95 ?? undefined,
      messagesLastMinute,
      latencyAvg: latency.avgLatency ?? 0,
      latencyP95: latency.p95Latency ?? extendedStats.latencyAvgP95 ?? undefined,
      suspiciousFlags,
      adminsCount: countByRole.admin ?? 0,
      regularUsersCount: countByRole.user ?? 0,
    };

    sendSuccess(res, data);
  } catch (err) {
    logger.warn('Admin', 'dashboard_error', { error: err.message });
    sendError(res, 500, 'Dashboard unavailable', 'DASHBOARD_ERROR');
  }
}

const MAX_BUCKETS = 96;

/**
 * GET /api/admin/dashboard/timeseries
 * Chart data: points with time, messages, connections. Bounded: max 96 buckets. No WS dependency.
 *
 * Semantics: points[].messages and points[].messagesPerSecond are RATE (messages per second)
 * at that bucket time, from adminDashboardBuffer (one sample per interval). They are NOT
 * message counts; decimals are expected. UI should label as "msg/s".
 */
function getDashboardTimeseries(req, res) {
  try {
    let windowSeconds = parseInt(req.query.windowSeconds, 10) || 86400;
    let bucketSeconds = parseInt(req.query.bucketSeconds, 10) || 3600;
    windowSeconds = Math.min(Math.max(windowSeconds, 60), 86400 * 7);
    const maxBuckets = MAX_BUCKETS;
    const minBucketSeconds = Math.ceil(windowSeconds / maxBuckets);
    if (bucketSeconds < minBucketSeconds) {
      bucketSeconds = minBucketSeconds;
    }
    const series = adminDashboardBuffer.getSeries({ windowSeconds, intervalSeconds: bucketSeconds });
    const rawPoints = Array.isArray(series.points) ? series.points : [];

    // Use per-point values from buffer so the chart shows message rate and connections over time (not a flat line).
    const points = rawPoints.slice(-maxBuckets).map((p) => {
      const ts = typeof p.ts === 'number' && p.ts > 0 ? p.ts : Date.now();
      const timeIso = new Date(ts).toISOString();
      const messagesPerSecond = typeof p.messagesPerSecondAvg === 'number' && p.messagesPerSecondAvg >= 0
        ? Math.round(p.messagesPerSecondAvg * 100) / 100
        : 0;
      const connections = typeof p.connectionsAvg === 'number' && p.connectionsAvg >= 0 ? p.connectionsAvg : 0;
      return {
        ts,
        time: timeIso,
        label: typeof p.label === 'string' ? p.label : null,
        messages: messagesPerSecond,
        messagesPerSecond,
        connections: Math.max(0, connections),
      };
    });

    sendSuccess(res, { windowSeconds, bucketSeconds, points });
  } catch (err) {
    logger.warn('Admin', 'dashboard_timeseries_error', { error: err.message });
    sendError(res, 500, 'Dashboard timeseries unavailable', 'DASHBOARD_ERROR');
  }
}

/**
 * GET /api/admin/dashboard/history
 * Coarse snapshots from DB for history charts. Query: minutes (default 60). Returns ascending by createdAt.
 */
async function getDashboardHistory(req, res) {
  try {
    const metricsSnapshotStore = require('../../storage/metricsSnapshot.mongo');
    const minutes = Math.min(Math.max(parseInt(req.query.minutes, 10) || 60, 1), 10080);
    const snapshots = await metricsSnapshotStore.findSnapshotsSince({ minutes });
    sendSuccess(res, { minutes, snapshots });
  } catch (err) {
    logger.warn('Admin', 'dashboard_history_error', { error: err.message });
    sendError(res, 500, 'Dashboard history unavailable', 'DASHBOARD_ERROR');
  }
}

/**
 * GET /api/admin/dashboard/series
 * Time-series for traffic chart. Bounded: points <= 60.
 */
function getDashboardSeries(req, res) {
  try {
    const windowSeconds = parseInt(req.query.windowSeconds, 10) || 3600;
    const intervalSeconds = parseInt(req.query.intervalSeconds, 10) || 60;
    const data = adminDashboardBuffer.getSeries({ windowSeconds, intervalSeconds });
    sendSuccess(res, data);
  } catch (err) {
    logger.warn('Admin', 'dashboard_series_error', { error: err.message });
    sendError(res, 500, 'Dashboard series unavailable', 'DASHBOARD_ERROR');
  }
}

/**
 * GET /api/admin/dashboard/stats
 * Extended stats (peak, p95, delta) for badges.
 */
function getDashboardStats(req, res) {
  try {
    const data = adminDashboardBuffer.getExtendedStats();
    sendSuccess(res, data);
  } catch (err) {
    logger.warn('Admin', 'dashboard_stats_error', { error: err.message });
    sendError(res, 500, 'Dashboard stats unavailable', 'DASHBOARD_ERROR');
  }
}

/** Dashboard/activity feed: only these event types by default (excludes high-volume 'info' e.g. Message processed). */
const DASHBOARD_ACTIVITY_TYPES = ['connect', 'disconnect', 'failure', 'report', 'flag', 'ban', 'admin', 'spike'];

/**
 * GET /api/admin/activity
 * Activity feed events. Bounded: maxEvents <= 50.
 * Default: only allowlisted types (same as dashboard) so feed is not dominated by high-volume info.
 * Override: ?types=connect,disconnect,info to request specific types (comma-separated).
 */
function getActivity(req, res) {
  try {
    const windowSeconds = parseInt(req.query.windowSeconds, 10) || 3600;
    const maxEvents = parseInt(req.query.maxEvents, 10) || 50;
    let typeAllowlist = DASHBOARD_ACTIVITY_TYPES;
    if (typeof req.query.types === 'string' && req.query.types.trim()) {
      const override = req.query.types.split(',').map((t) => t.trim()).filter(Boolean);
      if (override.length > 0) typeAllowlist = override;
    }
    const data = adminActivityBuffer.getEvents({ windowSeconds, maxEvents, typeAllowlist });
    sendSuccess(res, data);
  } catch (err) {
    logger.warn('Admin', 'activity_error', { error: err.message });
    sendError(res, 500, 'Activity feed unavailable', 'ADMIN_ERROR');
  }
}

/**
 * GET /api/admin/dashboard/activity
 * Activity feed for dashboard. Reads from DB (admin_events); falls back to in-memory ring buffer on DB failure.
 * Default: only returns allowlisted types (connect, disconnect, failure, report, flag, ban, admin, spike). Query: limit, types (comma-separated override), since (ISO).
 */
async function getDashboardActivity(req, res) {
  try {
    const adminEventStore = require('../../storage/adminEvent.mongo');
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);
    const since = typeof req.query.since === 'string' ? req.query.since : undefined;
    // Optional override: types=connect,disconnect,info (comma-separated); default = DASHBOARD_ACTIVITY_TYPES
    let types = DASHBOARD_ACTIVITY_TYPES;
    if (typeof req.query.types === 'string' && req.query.types.trim()) {
      const override = req.query.types.split(',').map((t) => t.trim()).filter(Boolean);
      if (override.length > 0) types = override;
    }
    const { events, ok } = await adminEventStore.findEvents({ limit, types, since });
    if (ok && Array.isArray(events)) {
      const items = events.map((e) => ({
        id: e.id,
        type: e.type || 'info',
        title: e.title || '',
        detail: e.detail || '',
        createdAt: e.createdAt != null ? new Date(e.createdAt).toISOString() : new Date(0).toISOString(),
      }));
      return sendSuccess(res, { items, fromDb: true });
    }
    const windowSeconds = Math.min(Math.max(parseInt(req.query.windowSeconds, 10) || 86400, 60), 86400 * 7);
    const data = adminActivityBuffer.getEvents({ windowSeconds, maxEvents: limit, typeAllowlist: types });
    const items = (data.events || []).map((e, i) => ({
      id: `${e.ts}-${e.type}-${i}`,
      type: e.type || 'info',
      title: e.title || '',
      detail: e.detail || '',
      createdAt: new Date(e.ts).toISOString(),
    }));
    sendSuccess(res, { windowSeconds, items, fromDb: false });
  } catch (err) {
    logger.warn('Admin', 'dashboard_activity_error', { error: err.message });
    sendError(res, 500, 'Dashboard activity unavailable', 'ADMIN_ERROR');
  }
}

/**
 * Derive device label from User-Agent string.
 * @param {string|null} ua
 * @returns {string}
 */
function deviceFromUserAgent(ua) {
  if (!ua || typeof ua !== 'string') return 'Unknown';
  const s = ua.toLowerCase();
  if (s.includes('iphone')) return 'iPhone';
  if (s.includes('ipad')) return 'iPad';
  if (s.includes('android')) return 'Android';
  if (s.includes('mac')) return 'Mac';
  if (s.includes('windows')) return 'Windows';
  if (s.includes('linux')) return 'Linux';
  return 'Web';
}

/** Normalize to ISO string or null for session date fields. */
function toIsoOrNull(v) {
  if (v == null) return null;
  if (typeof v === 'string') return v;
  try {
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d.toISOString();
  } catch (_) {
    return null;
  }
}

const MAX_SESSIONS = 20;

const authSessionStore = require('../../auth/sessionStore');

/**
 * GET /api/admin/users/:id/sessions
 * Returns stable session list: sessionId, createdAt (ISO), lastSeenAt (ISO), revokedAt (ISO|null), userAgent, ip, device.
 * Includes active and revoked when activeOnly=false (default). 404 USER_NOT_FOUND if user does not exist.
 */
async function getUserSessions(req, res) {
  try {
    const idRes = validateUserId(req.params.id);
    if (!idRes.ok) {
      logger.warn('Admin', 'user_sessions_validation', { error: idRes.error });
      return sendError(res, 400, idRes.error, idRes.code);
    }
    const userId = idRes.value;

    const user = await userStoreStorage.findById(userId);
    if (!user) {
      return sendError(res, 404, 'User not found', 'USER_NOT_FOUND');
    }
    const liveOnly = String(req.query.liveOnly || '') === '1';
    const activeOnly = liveOnly ? true : false;
    let raw = await authSessionStore.listSessions(userId, { activeOnly });
    if (liveOnly) {
      const now = Date.now();
      const liveWindowMs = getLiveWindowMs(config);
      raw = raw.filter((s) => isLiveSession(s.lastSeenAt, now, liveWindowMs));
    }

    let limit = parseInt(req.query.limit, 10) || 10;
    limit = Math.min(Math.max(limit, 1), MAX_SESSIONS);
    const sessions = raw.slice(0, limit).map((s) => ({
      sessionId: String(s.sessionId),
      createdAt: toIsoOrNull(s.createdAt) ?? new Date(0).toISOString(),
      lastSeenAt: toIsoOrNull(s.lastSeenAt) ?? new Date(0).toISOString(),
      revokedAt: toIsoOrNull(s.revokedAt),
      userAgent: s.userAgent != null ? String(s.userAgent) : null,
      ip: normalizeIp(s.ip) ?? null,
      device: deviceFromUserAgent(s.userAgent) || 'Unknown',
    }));

    sendSuccess(res, { userId, sessions });
  } catch (err) {
    logger.warn('Admin', 'user_sessions_error', { error: err.message });
    sendError(res, 500, 'Sessions unavailable', 'ADMIN_ERROR');
  }
}

/**
 * Map stored role to stable lowercase for Admin Users UI: "admin" | "user".
 */
function roleToStableKey(role) {
  if (role === ROLES.ADMIN) return 'admin';
  return 'user';
}

/**
 * Get admin users list with search and pagination.
 * GET /api/admin/users?q=...&limit=...&cursor=...
 * ADMIN only.
 * Returns stable UI-ready shape: every user has id, username, role, status, banned, flagged,
 * lastSeen, messages, reconnects, failures, violations, avgLatencyMs, email (all keys present).
 */
async function getUsers(req, res) {
  try {
    const q = (req.query.q || '').trim().toLowerCase();
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
    const cursor = Math.max(0, parseInt(req.query.cursor, 10) || 0);

    const listFn = userStoreStorage.listAllWithEmail || userStoreStorage.listAll;
    let users = await listFn();

    if (q) {
      users = users.filter(
        (u) =>
          (u.username || '').toLowerCase().includes(q) ||
          (u.id || '').toLowerCase().includes(q)
      );
    }

    const total = users.length;
    const page = users.slice(cursor, cursor + limit);

    const connectedUserIds = Object.create(null);
    try {
      const connected = connectionManager.getConnectedUsers() || [];
      connected.forEach((id) => { connectedUserIds[id] = true; });
    } catch (_) {
      /* ignore */
    }

    const usersOut = await Promise.all(page.map(async (u) => {
      const diag = userDiagnostics.getUserDiagnostics(u.id);
      const flags = suspiciousDetector.getUserFlags(u.id);
      const lastActivity = diag?.lastActivity ?? null;

      const lastSeen = connectedUserIds[u.id]
        ? 'online'
        : lastActivity
          ? formatLastSeen(lastActivity)
          : null;

      const banned = userStoreStorage.isBanned ? await userStoreStorage.isBanned(u.id) : false;
      const messageCount = diag?.messageCountWindow;
      const failureCount = diag?.deliveryFailures;
      const reconnectCount = diag?.reconnectCount;
      const isRootAdmin = isRootUser(u);

      return {
        id: String(u.id),
        username: String(u.username || u.id),
        role: roleToStableKey(u.role),
        status: connectedUserIds[u.id] ? 'online' : 'offline',
        banned: Boolean(banned),
        flagged: Array.isArray(flags) && flags.length > 0,
        lastSeen: lastSeen ?? null,
        messages: typeof messageCount === 'number' ? messageCount : 0,
        reconnects: typeof reconnectCount === 'number' ? reconnectCount : 0,
        failures: typeof failureCount === 'number' ? failureCount : 0,
        violations: 0,
        avgLatencyMs: (diag && typeof diag.avgLatencyMs === 'number' && diag.avgLatencyMs >= 0) ? Math.round(diag.avgLatencyMs) : null,
        email: u.email ?? null,
        isRootAdmin,
      };
    }));

    const nextCursor = cursor + limit < total ? String(cursor + limit) : null;

    sendSuccess(res, {
      users: usersOut,
      nextCursor,
      total,
      notAvailable: [],
    });
  } catch (err) {
    logger.warn('Admin', 'users_error', { error: err.message });
    sendError(res, 500, 'Users list unavailable', 'USERS_ERROR');
  }
}

function formatLastSeen(ts) {
  if (!ts || typeof ts !== 'number') return null;
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  const secs = Math.floor((diff % 60000) / 1000);
  if (mins >= 60) return `${Math.floor(mins / 60)}h ago`;
  if (mins > 0) return `${mins}m ago`;
  if (secs >= 30) return 'just now';
  return 'online';
}

/**
 * Get diagnostics for a user. Stable contract: never missing keys.
 * GET /admin/diagnostics/:userId
 * Protected by requireAuth + requireAdmin.
 * 200: { userId, timestamp (ISO), online, metrics, lastActivityAt, suspiciousFlags, notes }.
 * 404: { success: false, error: "Not found", code: "NOT_FOUND" }.
 */
async function getDiagnostics(req, res) {
  try {
    const idRes = validateUserId(req.params.userId);
    if (!idRes.ok) {
      logger.warn('Admin', 'diagnostics_validation', { error: idRes.error });
      return res.status(400).json({ success: false, error: idRes.error, code: idRes.code });
    }
    const userId = idRes.value;

    const storeUser = await userStoreStorage.findById(userId);
    const userExists = storeUser
      || userDiagnostics.getUserDiagnostics(userId)
      || connectionManager.getSocket(userId);
    if (!userExists) {
      return sendError(res, 404, 'Not found', 'NOT_FOUND');
    }

    const diag = userDiagnostics.getUserDiagnostics(userId);
    let online = false;
    let activeConnectionCount = 0;
    let connectionKeys = [];
    try {
      online = connectionManager.isUserConnected(userId) === true;
      activeConnectionCount = connectionManager.getActiveConnectionCount(userId);
      connectionKeys = connectionManager.getConnectionKeys(userId);
    } catch (_) {
      /* ignore */
    }

    const lastActivity = diag?.lastActivity;
    const lastActivityAt =
      typeof lastActivity === 'number' ? new Date(lastActivity).toISOString() : null;

    const flags = suspiciousDetector.getUserFlags(userId);
    const suspiciousFlags = Array.isArray(flags) ? flags.length : 0;

    const data = {
      userId,
      timestamp: new Date().toISOString(),
      online,
      activeConnectionCount,
      connectionKeys,
      metrics: {
        messagesWindow: typeof diag?.messageCountWindow === 'number' ? diag.messageCountWindow : 0,
        reconnectsWindow: typeof diag?.reconnectCount === 'number' ? diag.reconnectCount : 0,
        deliveryFailuresWindow: typeof diag?.deliveryFailures === 'number' ? diag.deliveryFailures : 0,
        violationsWindow: 0,
        avgLatencyMs: typeof diag?.avgLatencyMs === 'number' && diag.avgLatencyMs >= 0 ? Math.round(diag.avgLatencyMs) : null,
      },
      lastActivityAt,
      suspiciousFlags,
      notes: [],
    };

    sendSuccess(res, data);
  } catch (err) {
    logger.warn('Admin', 'diagnostics_error', { error: err.message });
    sendError(res, 500, 'Diagnostics unavailable', 'DIAGNOSTICS_ERROR');
  }
}

/**
 * Resolve userId to display string (username or id fallback).
 */
async function userIdToUser(userId) {
  if (!userId || typeof userId !== 'string') return '—';
  const u = userStoreStorage.findById ? await userStoreStorage.findById(userId) : null;
  return u?.username || userId;
}

/** Suspicious thresholds: backend single source of truth. */
const SUSPICIOUS_TARGET_WINDOW_MS = 2 * 60 * 1000;
const SUSPICIOUS_TARGET_COUNT = 5;
const SUSPICIOUS_REPORTERS_NEW_ACCOUNT_MS = 48 * 60 * 60 * 1000;
const SUSPICIOUS_REPORTERS_WINDOW_MS = 10 * 60 * 1000;
const SUSPICIOUS_REPORTERS_NEW_COUNT = 3;
const SUSPICIOUS_SAME_IP_WINDOW_MS = 10 * 60 * 1000;
const SUSPICIOUS_SAME_IP_COUNT = 3;

/** Reporter trust score threshold (optional). If reporterTrustScore exists and is below this, report is suspicious. */
const SUSPICIOUS_TRUST_SCORE_THRESHOLD = (() => {
  const env = process.env.REPORT_SUSPICIOUS_TRUST_SCORE_THRESHOLD;
  if (env != null && env !== '') {
    const n = parseFloat(env);
    if (Number.isFinite(n) && n >= 0 && n <= 1) return n;
  }
  return null;
})();

/**
 * Compute whether a report is suspicious (automatic flags). Returns { suspicious, suspiciousReasons }.
 * Conditions: >=5 reports on same target in 2 min; >=3 reporters with account age < 48h in window;
 * >=3 reports from same IP in short window; reporter trust score < threshold (if exists).
 */
async function computeReportSuspicious(report) {
  const reasons = [];
  try {
    if (report.targetUserId) {
      const countTarget = await reportsStore.countReportsOnTargetInWindow(
        report.targetUserId,
        report.createdAt ?? Date.now(),
        SUSPICIOUS_TARGET_WINDOW_MS
      );
      if (countTarget >= SUSPICIOUS_TARGET_COUNT) {
        reasons.push(`>=${SUSPICIOUS_TARGET_COUNT} reports on same target within 2 minutes`);
      }
    }
    const windowEnd = report.createdAt ?? Date.now();
    const reportsInWindow = await reportsStore.listReportsInWindow(
      windowEnd,
      SUSPICIOUS_REPORTERS_WINDOW_MS,
      500
    );
    const newAccountReporters = new Set();
    for (const r of reportsInWindow) {
      const created = r.reporterAccountCreatedAt != null ? r.reporterAccountCreatedAt : Infinity;
      const ageAtReport = (r.createdAt ?? 0) - created;
      if (ageAtReport >= 0 && ageAtReport < SUSPICIOUS_REPORTERS_NEW_ACCOUNT_MS && r.reporterUserId) {
        newAccountReporters.add(r.reporterUserId);
      }
    }
    if (newAccountReporters.size >= SUSPICIOUS_REPORTERS_NEW_COUNT) {
      reasons.push(`>=${SUSPICIOUS_REPORTERS_NEW_COUNT} reporters with account age < 48h in window`);
    }
    if (report.reporterIp) {
      const countIp = await reportsStore.countReportsByReporterIpInWindow(
        report.reporterIp,
        windowEnd,
        SUSPICIOUS_SAME_IP_WINDOW_MS
      );
      if (countIp >= SUSPICIOUS_SAME_IP_COUNT) {
        reasons.push(`>=${SUSPICIOUS_SAME_IP_COUNT} reports from same IP within short window`);
      }
    }
    if (SUSPICIOUS_TRUST_SCORE_THRESHOLD != null && typeof report.reporterTrustScore === 'number' && report.reporterTrustScore < SUSPICIOUS_TRUST_SCORE_THRESHOLD) {
      reasons.push('Reporter trust score below threshold');
    }
  } catch (err) {
    logger.warn('Admin', 'compute_report_suspicious_error', { reportId: report?.id, error: err.message });
  }
  return { suspicious: reasons.length > 0, suspiciousReasons: reasons };
}

/**
 * Get reports moderation queue.
 * GET /admin/reports
 * Priority is derived from category only (admin cannot change). Returns category, priority, suspicious, suspiciousReasons.
 */
async function getReports(req, res) {
  try {
    const raw = await reportsStore.listReports({ limit: 200, status: 'open', sortByPriority: 'highFirst' });
    const reports = await Promise.all(raw.map(async (r) => {
      const userDisplay = r.targetUserId
        ? await userIdToUser(r.targetUserId)
        : await userIdToUser(r.reporterUserId);
      const priority = (r.priority && ['low', 'normal', 'high'].includes(r.priority)) ? r.priority : 'normal';
      const { suspicious, suspiciousReasons } = await computeReportSuspicious(r);
      const hasMessageContext = r.hasMessageContext ?? Boolean(r.messageId);
      const row = {
        id: r.id,
        date: reportsStore.formatDate(r.createdAt),
        user: userDisplay,
        category: r.category ?? null,
        priority,
        suspicious: !!suspicious,
        suspiciousReasons: Array.isArray(suspiciousReasons) ? suspiciousReasons : [],
        ...(r.reason != null && { reason: r.reason }),
        hasMessageContext,
        targetUserId: r.targetUserId ?? null,
      };
      if (r.conversationId != null) row.conversationId = r.conversationId;
      if (r.messageId != null) row.messageId = r.messageId;
      return row;
    }));
    sendSuccess(res, { reports });
  } catch (err) {
    logger.warn('Admin', 'reports_error', { error: err.message });
    sendError(res, 500, 'Reports unavailable', 'REPORTS_ERROR');
  }
}

/** Context window: 2 above + reported message + 2 below (max 5 total). */
const REPORT_CONTEXT_WINDOW = 2;
/** Hard cap: never return more than this many context items (bugs/malicious). */
const REPORT_CONTEXT_MAX = 5;
/** Max response payload size; above this return PAYLOAD_TOO_LARGE. */
const REPORT_PAYLOAD_MAX_BYTES = 200 * 1024;
/** Max content length per message in report details (chars). */
const REPORT_CONTENT_MAX_LENGTH = 10000;
/** Max attachments per message in report details (count). */
const REPORT_ATTACHMENTS_MAX = 5;
/** Max size per attachment blob in report (chars when stringified). */
const REPORT_ATTACHMENT_ITEM_MAX_CHARS = 2000;

/**
 * Clamp a message shape for report details: limit content length and attachments/metadata.
 * Does not leak or log message content; safe for logging ids/lengths only.
 */
function clampMessageForReport(msg) {
  if (!msg || typeof msg !== 'object') return msg;
  const out = { ...msg };
  if (typeof out.content === 'string' && out.content.length > REPORT_CONTENT_MAX_LENGTH) {
    out.content = out.content.slice(0, REPORT_CONTENT_MAX_LENGTH) + '…[truncated]';
  }
  if (Array.isArray(out.attachments) && out.attachments.length > REPORT_ATTACHMENTS_MAX) {
    out.attachments = out.attachments.slice(0, REPORT_ATTACHMENTS_MAX).map((a) => {
      if (a == null || typeof a !== 'object') return a;
      const s = JSON.stringify(a);
      if (s.length <= REPORT_ATTACHMENT_ITEM_MAX_CHARS) return a;
      return { _truncated: true, _length: s.length };
    });
  }
  if (out.metadata && typeof out.metadata === 'object') {
    const s = JSON.stringify(out.metadata);
    if (s.length > REPORT_ATTACHMENT_ITEM_MAX_CHARS) {
      out.metadata = { _truncated: true, _length: s.length };
    }
  }
  return out;
}

/**
 * Compute insights and userMeta for a target user.
 * @param {string} targetUserId
 * @returns {Promise<{ insights: object | null, userMeta: object | null }>}
 */
async function computeReportInsights(targetUserId) {
  if (!targetUserId) return { insights: null, userMeta: null };

  try {
    const user = await userStoreStorage.findById(targetUserId);
    const accountCreatedAt = user?.createdAt ?? null;
    const prevWarnings = await warningsStore.countByUser(targetUserId);
    const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
    const recentReports = await reportsStore.countRecentByTargetUser(targetUserId, oneDayAgo);
    // Request-time only; includes REPORT_THRESHOLD and all other flags (no caching).
    const flags = suspiciousDetector.getUserFlags(targetUserId);
    const rawFlags = Array.isArray(flags) ? flags : [];
    const suspiciousFlagsCount = rawFlags.length;
    // Safe, compact list for UI: { reason, count, lastDetectedAt }, newest first, max 10 (TTL-pruned via getUserFlags).
    const suspiciousFlags = rawFlags
      .map((f) => ({
        reason: typeof f.reason === 'string' ? f.reason : '',
        count: typeof f.count === 'number' && f.count >= 0 ? f.count : 0,
        lastDetectedAt: typeof f.lastDetectedAt === 'number' ? f.lastDetectedAt : 0,
      }))
      .sort((a, b) => (b.lastDetectedAt || 0) - (a.lastDetectedAt || 0))
      .slice(0, 10);
    const diag = userDiagnostics.getUserDiagnostics(targetUserId);
    let messageRate = 0;
    if (diag && diag.messageCountWindow != null && diag.connectionStartTime != null) {
      const minutes = (Date.now() - diag.connectionStartTime) / 60000;
      if (minutes > 0) {
        messageRate = diag.messageCountWindow / minutes;
      }
    }
    const rawLastKnownIp = await authSessionStore.getLastKnownIpForUser(targetUserId);
    const lastKnownIp = normalizeIp(rawLastKnownIp) ?? null;
    const totalReports = await reportsStore.countByTargetUser(targetUserId);

    const insights = {
      messageRate: Math.round(messageRate * 100) / 100,
      prevWarnings,
      recentReports,
      suspiciousFlagsCount,
      suspiciousFlags,
    };

    const userMeta = {
      accountCreatedAt: accountCreatedAt ? new Date(accountCreatedAt).toISOString() : null,
      lastKnownIp,
      totalReports,
    };

    return { insights, userMeta };
  } catch (err) {
    logger.warn('Admin', 'get_report_details_insights_error', {
      targetUserId,
      error: err.message,
    });
    return { insights: null, userMeta: null };
  }
}

/**
 * Get report details for moderation review.
 * GET /admin/reports/:id
 * Returns report (safe fields), reported message (if message report), and context messages (oldest→newest).
 * Uses getContextWindow: O(1) bounded queries instead of O(N) history scan.
 */
async function getReportDetails(req, res) {
  const reportIdParam = req.params.id;
  const reportIdRes = validateReportId(reportIdParam);
  if (!reportIdRes.ok) {
    logger.warn('Admin', 'get_report_details_validation', { error: reportIdRes.error });
    return sendError(res, 400, reportIdRes.error, reportIdRes.code);
  }
  const reportId = reportIdRes.value;

  const report = await reportsStore.getReportById(reportId);
  if (!report) {
    return sendError(res, 404, 'Report not found', 'REPORT_NOT_FOUND');
  }

  const dateFormatted = reportsStore.formatDate(report.createdAt);
  const priority = (report.priority && ['low', 'normal', 'high'].includes(report.priority)) ? report.priority : 'normal';
  const { suspicious, suspiciousReasons } = await computeReportSuspicious(report);
  const safeReport = {
    id: report.id,
    createdAt: report.createdAt,
    dateFormatted,
    reporterUserId: report.reporterUserId,
    targetUserId: report.targetUserId ?? null,
    type: report.type ?? (report.messageId ? 'message' : 'user'),
    reason: report.reason ?? null,
    details: report.details ?? null,
    status: report.status ?? 'open',
    category: report.category ?? null,
    priority,
    suspicious: !!suspicious,
    suspiciousReasons: Array.isArray(suspiciousReasons) ? suspiciousReasons : [],
    messageId: report.messageId ?? null,
    conversationId: report.conversationId ?? null,
    senderId: report.senderId ?? null,
  };

  if (report.type !== 'message' || !report.messageId) {
    if (config.ADMIN_REPORTS_DEBUG) {
      logger.info('Admin', 'get_report_details_context', { reportId, usedContextWindow: false, contextLength: 0 });
    } else {
      logger.debug('Admin', 'get_report_details_context', { reportId, usedContextWindow: false, contextLength: 0 });
    }
    const { insights, userMeta } = await computeReportInsights(safeReport.targetUserId);

    return sendSuccess(res, {
      report: safeReport,
      message: null,
      context: [],
      ...(insights && { insights }),
      ...(userMeta && { userMeta }),
    });
  }

  const before = 2;
  const after = 2;
  const { anchor, context: contextList } = await messageStore.getContextWindow(
    report.conversationId,
    report.messageId,
    { before, after }
  );

  if (!anchor) {
    if (config.ADMIN_REPORTS_DEBUG) {
      logger.info('Admin', 'get_report_details_context', { reportId, usedContextWindow: true, before, after, contextLength: 0 });
    } else {
      logger.debug('Admin', 'get_report_details_context', { reportId, usedContextWindow: true, before, after, contextLength: 0 });
    }
    return sendSuccess(res, {
      report: safeReport,
      message: null,
      context: [],
      contextError: 'MESSAGE_NOT_FOUND',
      window: REPORT_CONTEXT_WINDOW,
    });
  }

  let context = (contextList || []).map((m) => toApiShape(m)).filter(Boolean);
  // Worst-case clamp: even if store or bug returns more than 5, never return more (bugs/malicious).
  if (context && context.length > REPORT_CONTEXT_MAX) {
    context = context.slice(0, REPORT_CONTEXT_MAX);
  }
  context = context.map((m) => clampMessageForReport(m));
  const clampedAnchor = clampMessageForReport(toApiShape(anchor));

  // Logs: ids, lengths, flags only; no message content (no content/reason/attachments).
  if (config.ADMIN_REPORTS_DEBUG) {
    logger.info('Admin', 'get_report_details_context', {
      reportId,
      usedContextWindow: true,
      before,
      after,
      contextLength: context.length,
      messageId: anchor?.messageId ?? null,
      hasAnchor: !!anchor,
    });
  } else {
    logger.debug('Admin', 'get_report_details_context', {
      reportId,
      usedContextWindow: true,
      before,
      after,
      contextLength: context.length,
      messageId: anchor?.messageId ?? null,
      hasAnchor: !!anchor,
    });
  }

  const { insights, userMeta } = await computeReportInsights(safeReport.targetUserId);
  const warningCreatedForThisReport = safeReport.targetUserId
    ? await warningsStore.existsByUserAndReport(safeReport.targetUserId, reportId)
    : false;

  const payload = {
    report: safeReport,
    message: clampedAnchor,
    context,
    window: REPORT_CONTEXT_WINDOW,
    warningCreatedForThisReport,
    ...(insights && { insights }),
    ...(userMeta && { userMeta }),
  };

  const payloadJson = JSON.stringify(payload);
  const payloadBytes = Buffer.byteLength(payloadJson, 'utf8');
  if (payloadBytes > REPORT_PAYLOAD_MAX_BYTES) {
    logger.error('Admin', 'get_report_details_payload_too_large', { reportId, sizeBytes: payloadBytes });
    return sendSuccess(res, {
      report: safeReport,
      message: null,
      context: [],
      contextError: 'PAYLOAD_TOO_LARGE',
      window: REPORT_CONTEXT_WINDOW,
      warningCreatedForThisReport,
      ...(insights && { insights }),
      ...(userMeta && { userMeta }),
    });
  }

  return sendSuccess(res, payload);
}

/**
 * POST /admin/reports/:id/resolve
 * Resolve a report. Idempotent.
 */
async function resolveReport(req, res) {
  try {
    const adminId = req.user?.userId;
    const idRes = validateReportId(req.params.id);
    if (!idRes.ok) {
      logger.warn('Admin', 'resolve_report_validation', { adminId, error: idRes.error });
      return sendError(res, 400, idRes.error, idRes.code);
    }
    const reportId = idRes.value;
    const ok = await reportsStore.resolveReport(reportId, adminId);
    if (!ok) {
      return sendError(res, 404, 'Report not found', 'REPORT_NOT_FOUND');
    }
    try {
      adminActivityBuffer.recordEvent({
        type: 'admin',
        title: 'Report resolved',
        detail: `actor=${adminId ?? 'unknown'} reportId=${reportId}`,
        severity: 'info',
      });
    } catch (_) { /* no-op */ }
    logger.info('Admin', 'report_resolved', { reportId, adminId, timestamp: Date.now() });
    sendSuccess(res, { id: reportId, status: 'resolved' });
  } catch (err) {
    logger.warn('Admin', 'resolve_report_error', { error: err.message });
    sendError(res, 500, 'Failed to resolve report', 'REPORTS_ERROR');
  }
}

/** PATCH /admin/reports/:id/priority — set report priority (low | normal | high). */
async function updateReportPriority(req, res) {
  try {
    const idRes = validateReportId(req.params.id);
    if (!idRes.ok) {
      return sendError(res, 400, idRes.error, idRes.code);
    }
    const reportId = idRes.value;
    const priority = req.body?.priority;
    if (priority == null || typeof priority !== 'string' || priority.trim() === '') {
      return sendError(res, 400, 'priority is required', 'INVALID_PAYLOAD');
    }
    const p = priority.trim().toLowerCase();
    if (!['low', 'normal', 'high'].includes(p)) {
      return sendError(res, 400, 'priority must be one of: low, normal, high', 'INVALID_PAYLOAD');
    }
    const ok = await reportsStore.updateReportPriority(reportId, p);
    if (!ok) {
      return sendError(res, 404, 'Report not found', 'REPORT_NOT_FOUND');
    }
    sendSuccess(res, { priority: p });
  } catch (err) {
    logger.warn('Admin', 'update_report_priority_error', { error: err.message });
    sendError(res, 500, 'Failed to update priority', 'REPORTS_ERROR');
  }
}

/**
 * POST /admin/users/:id/warn
 * Create a warning record. When reportId is provided (e.g. from reports section),
 * at most one warning per user per report is allowed; duplicate returns 409.
 */
async function warnUser(req, res) {
  try {
    const adminId = req.user?.userId;
    const idRes = validateUserId(req.params.id);
    if (!idRes.ok) {
      logger.warn('Admin', 'warn_user_validation', { adminId, error: idRes.error });
      return sendError(res, 400, idRes.error, idRes.code);
    }
    const targetId = idRes.value;
    const reasonRes = validateOptionalString(req.body?.reason, 500);
    if (!reasonRes.ok) {
      return sendError(res, 400, reasonRes.error, reasonRes.code);
    }
    const reportIdRes = validateOptionalString(req.body?.reportId, 256);
    if (!reportIdRes.ok) {
      return sendError(res, 400, reportIdRes.error, reportIdRes.code);
    }
    const target = await userStoreStorage.findById(targetId);
    if (!target) {
      return sendError(res, 404, 'User not found', 'USER_NOT_FOUND');
    }
    if (guardRootTarget(req, target, res)) {
      try {
        adminActivityBuffer.recordEvent({
          type: 'admin',
          title: 'Admin action blocked',
          detail: `actor=${adminId ?? 'unknown'} reason=root_protected`,
          severity: 'warning',
        });
      } catch (_) { /* no-op */ }
      return;
    }
    const payload = {
      userId: targetId,
      adminId,
      reason: reasonRes.value,
    };
    if (reportIdRes.value != null && reportIdRes.value !== '') {
      payload.reportId = reportIdRes.value;
    }
    const record = await warningsStore.createWarning(payload);
    try {
      adminActivityBuffer.recordEvent({
        type: 'admin',
        title: 'User warned',
        detail: `actor=${adminId ?? 'unknown'} target=${targetId} reason=${(reasonRes.value || '').slice(0, 200)}`,
        severity: 'info',
      });
    } catch (_) { /* no-op */ }
    logger.info('Admin', 'user_warned', { targetId, adminId, warningId: record.id, timestamp: Date.now() });
    sendSuccess(res, { id: record.id, userId: targetId });
  } catch (err) {
    if (err.code === 'PAYLOAD_TOO_LARGE') {
      return sendError(res, 400, err.message, 'PAYLOAD_TOO_LARGE');
    }
    if (err.code === 'WARNING_ALREADY_CREATED_FOR_REPORT') {
      return sendError(res, 409, err.message, 'WARNING_ALREADY_CREATED_FOR_REPORT');
    }
    logger.warn('Admin', 'warn_user_error', { error: err.message });
    sendError(res, 500, 'Failed to warn user', 'ADMIN_ERROR');
  }
}

/**
 * POST /admin/users/:id/ban
 * Sets banned=true, revokes all auth sessions, disconnects all WS for user. Idempotent.
 * Guards: cannot ban self (SELF_BAN_NOT_ALLOWED); cannot ban another admin (CANNOT_BAN_ADMIN).
 */
async function banUser(req, res) {
  try {
    const adminId = req.user?.userId;
    const idRes = validateUserId(req.params.id);
    if (!idRes.ok) {
      logger.warn('Admin', 'ban_user_validation', { adminId, error: idRes.error });
      return sendError(res, 400, idRes.error, idRes.code);
    }
    const targetId = idRes.value;
    if (targetId === adminId) {
      return sendError(res, 400, 'Cannot ban yourself', 'SELF_BAN_NOT_ALLOWED');
    }
    const target = await userStoreStorage.findById(targetId);
    if (!target) {
      return sendError(res, 404, 'User not found', 'USER_NOT_FOUND');
    }
    if (guardRootTarget(req, target, res)) {
      try {
        adminActivityBuffer.recordEvent({
          type: 'admin',
          title: 'Admin action blocked',
          detail: `actor=${adminId ?? 'unknown'} reason=root_protected`,
          severity: 'warning',
        });
      } catch (_) { /* no-op */ }
      return;
    }
    if (target.role === ROLES.ADMIN) {
      return sendError(res, 403, 'Cannot ban another admin', 'CANNOT_BAN_ADMIN');
    }
    const alreadyBanned = await userStoreStorage.isBanned(targetId);
    await userStoreStorage.setBanned(targetId);

    await authSessionStore.revokeAllSessions(targetId);
    // Phase 6: Close all WS with code 4003 "ACCOUNT_SUSPENDED", optionally send ERROR first
    const sockets = connectionManager.getSockets(targetId);
    const suspendPayload = {
      type: 'ERROR',
      code: 'ACCOUNT_SUSPENDED',
      message: 'Account suspended',
      version: config.PROTOCOL_VERSION,
    };
    for (const ws of sockets) {
      try {
        if (ws.readyState === 1) {
          ws.send(JSON.stringify(suspendPayload));
        }
      } catch (_) { /* ignore send errors */ }
      try {
        if (ws.readyState === 1) ws.close(4003, 'ACCOUNT_SUSPENDED');
      } catch (_) { /* ignore close errors */ }
    }
    try {
      connectionManager.remove(targetId);
    } catch (_) {
      /* ignore if no session */
    }

    try {
      redisBus.publishAdminKick({
        type: 'admin.kick',
        originInstanceId: redisBus.getInstanceId(),
        action: 'BAN',
        targetUserId: targetId,
        ts: Date.now(),
      }).catch(() => {});
    } catch (_) { /* do not affect HTTP response */ }

    if (!alreadyBanned) {
      try {
        adminActivityBuffer.recordEvent({
          type: 'ban',
          title: 'User banned',
          detail: `actor=${adminId ?? 'unknown'} target=${targetId}`,
          severity: 'warning',
        });
      } catch (_) { /* no-op */ }
      logger.info('Admin', 'user_banned', { targetId, adminId, timestamp: Date.now() });
    }
    sendSuccess(res, { userId: targetId, banned: true });
  } catch (err) {
    logger.warn('Admin', 'ban_user_error', { error: err.message });
    sendError(res, 500, 'Failed to ban user', 'ADMIN_ERROR');
  }
}

/**
 * POST /api/admin/users/:id/sessions/:sessionId/revoke
 * Revoke one device session: auth store + WS kick only that session.
 * Ownership: session must belong to user :id (403 if not).
 * 404 SESSION_NOT_FOUND if sessionId does not exist; 404 USER_NOT_FOUND if user does not exist.
 */
async function revokeOneSession(req, res) {
  try {
    const adminId = req.user?.userId;
    const idRes = validateUserId(req.params.id);
    if (!idRes.ok) {
      logger.warn('Admin', 'revoke_one_session_validation', { adminId, error: idRes.error });
      return sendError(res, 400, idRes.error, idRes.code);
    }
    const userId = idRes.value;
    const sessionId = typeof req.params.sessionId === 'string' ? req.params.sessionId.trim() : '';
    if (!sessionId) {
      return sendError(res, 400, 'sessionId required', 'INVALID_SESSION_ID');
    }

    const target = await userStoreStorage.findById(userId);
    if (!target) {
      return sendError(res, 404, 'User not found', 'USER_NOT_FOUND');
    }
    if (guardRootTarget(req, target, res)) {
      try {
        adminActivityBuffer.recordEvent({
          type: 'admin',
          title: 'Admin action blocked',
          detail: `actor=${adminId ?? 'unknown'} reason=root_protected`,
          severity: 'warning',
        });
      } catch (_) { /* no-op */ }
      return;
    }

    const session = await authSessionStore.getSession(sessionId);
    if (!session) {
      return sendError(res, 404, 'Session not found', 'SESSION_NOT_FOUND');
    }
    if (session.userId !== userId) {
      return sendError(res, 403, 'Session does not belong to this user', 'FORBIDDEN');
    }

    await authSessionStore.revokeSession(sessionId);
    try {
      connectionManager.removeSession(sessionId);
    } catch (_) {
      /* ignore if no WS for this session */
    }
    try {
      redisBus.publishAdminKick({
        type: 'admin.kick',
        originInstanceId: redisBus.getInstanceId(),
        action: 'REVOKE_ONE',
        targetUserId: userId,
        targetSessionId: sessionId,
        ts: Date.now(),
      }).catch(() => {});
    } catch (_) { /* do not affect HTTP response */ }
    try {
      adminActivityBuffer.recordEvent({
        type: 'admin',
        title: 'Session revoked',
        detail: `actor=${adminId ?? 'unknown'} target=${userId} sessionId=${sessionId}`,
        severity: 'warning',
      });
    } catch (_) { /* no-op */ }
    logger.info('Admin', 'session_revoked', { userId, sessionId, adminId, timestamp: Date.now() });
    sendSuccess(res, { userId, sessionId, revoked: true });
  } catch (err) {
    logger.warn('Admin', 'revoke_one_session_error', { error: err.message });
    sendError(res, 500, 'Failed to revoke session', 'ADMIN_ERROR');
  }
}

/**
 * POST /api/admin/users/:id/revoke-sessions
 * Revoke all device sessions for user: auth store + disconnect all WS via connectionManager.remove(userId).
 * 404 USER_NOT_FOUND if user does not exist.
 * Response: { success: true, data: { userId, revoked: true, count: number } }.
 */
async function revokeSessions(req, res) {
  try {
    const adminId = req.user?.userId;
    const idRes = validateUserId(req.params.id);
    if (!idRes.ok) {
      logger.warn('Admin', 'revoke_sessions_validation', { adminId, error: idRes.error });
      return sendError(res, 400, idRes.error, idRes.code);
    }
    const targetId = idRes.value;
    const target = await userStoreStorage.findById(targetId);
    if (!target) {
      return sendError(res, 404, 'User not found', 'USER_NOT_FOUND');
    }
    if (guardRootTarget(req, target, res)) {
      try {
        adminActivityBuffer.recordEvent({
          type: 'admin',
          title: 'Admin action blocked',
          detail: `actor=${adminId ?? 'unknown'} reason=root_protected`,
          severity: 'warning',
        });
      } catch (_) { /* no-op */ }
      return;
    }

    const count = await authSessionStore.revokeAllSessions(targetId);
    try {
      connectionManager.remove(targetId);
    } catch (_) {
      /* ignore if no connections */
    }
    try {
      redisBus.publishAdminKick({
        type: 'admin.kick',
        originInstanceId: redisBus.getInstanceId(),
        action: 'REVOKE_ALL',
        targetUserId: targetId,
        ts: Date.now(),
      }).catch(() => {});
    } catch (_) { /* do not affect HTTP response */ }
    try {
      adminActivityBuffer.recordEvent({
        type: 'admin',
        title: 'Sessions revoked',
        detail: `actor=${adminId ?? 'unknown'} target=${targetId} count=${Number(count)}`,
        severity: 'warning',
      });
    } catch (_) { /* no-op */ }
    logger.info('Admin', 'sessions_revoked', { targetId, count, adminId, timestamp: Date.now() });
    sendSuccess(res, { userId: targetId, revoked: true, count: Number(count) });
  } catch (err) {
    logger.warn('Admin', 'revoke_sessions_error', { error: err.message });
    sendError(res, 500, 'Failed to revoke sessions', 'ADMIN_ERROR');
  }
}

/**
 * POST /admin/users/:id/unban
 * Sets banned=false. Idempotent.
 */
async function unbanUser(req, res) {
  try {
    const adminId = req.user?.userId;
    const idRes = validateUserId(req.params.id);
    if (!idRes.ok) {
      logger.warn('Admin', 'unban_user_validation', { adminId, error: idRes.error });
      return sendError(res, 400, idRes.error, idRes.code);
    }
    const targetId = idRes.value;
    const target = await userStoreStorage.findById(targetId);
    if (!target) {
      return sendError(res, 404, 'User not found', 'USER_NOT_FOUND');
    }
    if (guardRootTarget(req, target, res)) {
      try {
        adminActivityBuffer.recordEvent({
          type: 'admin',
          title: 'Admin action blocked',
          detail: `actor=${adminId ?? 'unknown'} reason=root_protected`,
          severity: 'warning',
        });
      } catch (_) { /* no-op */ }
      return;
    }
    const wasBanned = await userStoreStorage.isBanned(targetId);
    await userStoreStorage.setUnbanned(targetId);

    if (wasBanned) {
      try {
        adminActivityBuffer.recordEvent({
          type: 'admin',
          title: 'User unbanned',
          detail: `actor=${adminId ?? 'unknown'} target=${targetId}`,
          severity: 'info',
        });
      } catch (_) { /* no-op */ }
      logger.info('Admin', 'user_unbanned', { targetId, adminId, timestamp: Date.now() });
    }
    sendSuccess(res, { userId: targetId, banned: false });
  } catch (err) {
    logger.warn('Admin', 'unban_user_error', { error: err.message });
    sendError(res, 500, 'Failed to unban user', 'ADMIN_ERROR');
  }
}

/**
 * GET /api/admin/messages — Admin message inspection (requireAuth + requireAdmin).
 * Query: conversationId (required), limit (required, 1–100), senderId (optional), before (optional cursor).
 * No ownership check; admin can inspect any conversationId.
 */
async function getAdminMessages(req, res) {
  try {
    if (!req.user || !req.user.userId) {
      return sendError(res, 401, 'Not authenticated', 'UNAUTHORIZED');
    }
    const role = req.user.effectiveRole ?? req.user.role;
    if (role !== ROLES.ADMIN && !req.user.isRootAdmin) {
      return sendError(res, 403, 'Forbidden', 'FORBIDDEN');
    }
    const convRes = validateConversationId(req.query.conversationId);
    if (!convRes.ok) {
      return sendError(res, 400, convRes.error, convRes.code);
    }
    const limitRes = validateRequiredIntInRange(req.query.limit, 'limit', 1, 100);
    if (!limitRes.ok) {
      return sendError(res, 400, limitRes.error, limitRes.code);
    }
    const beforeRes = validateOptionalCursor(req.query.before, 'before');
    if (!beforeRes.ok) {
      return sendError(res, 400, beforeRes.error, beforeRes.code);
    }
    const senderRes = validateOptionalSenderId(req.query.senderId);
    if (!senderRes.ok) {
      return sendError(res, 400, senderRes.error, senderRes.code);
    }

    const conversationId = convRes.value;
    const limit = limitRes.value;
    const before = beforeRes.value;
    const senderId = senderRes.value;

    // getAllHistory(chatId) is scoped by chatId only (storage: find({ chatId })); no cross-chat.
    let all = await messageStore.getAllHistory(conversationId);
    if (senderId) {
      all = all.filter((m) => m.senderId === senderId);
    }

    const id = (m) => m.roomMessageId || m.messageId;
    all.sort((a, b) => {
      const ts = (b.timestamp || 0) - (a.timestamp || 0);
      if (ts !== 0) return ts;
      return (id(b) || '').localeCompare(id(a) || '');
    });

    let startIndex = 0;
    if (before != null && before !== '') {
      const idx = all.findIndex((m) => id(m) === before);
      startIndex = idx >= 0 ? idx + 1 : 0;
    }
    const page = all.slice(startIndex, startIndex + limit);
    const hasMore = startIndex + limit < all.length;
    const nextCursor = hasMore && page.length > 0 ? id(page[page.length - 1]) : null;

    const apiMessages = page.map((m) => toApiMessage(m)).filter(Boolean);
    logger.info('Admin', 'get_admin_messages_ok', {
      conversationId,
      limit,
      senderIdPresent: !!senderId,
      hasMore,
    });
    sendSuccess(res, {
      conversationId,
      messages: apiMessages,
      nextCursor,
      hasMore,
    });
  } catch (err) {
    logger.warn('Admin', 'get_admin_messages_error', { error: err.message });
    sendError(res, 500, 'Failed to load messages', 'ADMIN_ERROR');
  }
}

module.exports = {
  getRootUsersList,
  promoteUserToAdmin,
  getDiagnostics,
  getDashboard,
  getDashboardTimeseries,
  getDashboardSeries,
  getDashboardStats,
  getDashboardActivity,
  getDashboardHistory,
  getActivity,
  getUsers,
  getUserSessions,
  getReports,
  getReportDetails,
  resolveReport,
  updateReportPriority,
  warnUser,
  banUser,
  unbanUser,
  revokeOneSession,
  revokeSessions,
  getAdminMessages,
};
