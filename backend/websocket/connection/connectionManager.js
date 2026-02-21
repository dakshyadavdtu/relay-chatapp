'use strict';

const crypto = require('crypto');

/**
 * ConnectionManager - SINGLE SOURCE OF TRUTH for WebSocket socket lifecycle.
 * WS-MULTI-1: Multiple concurrent sockets per user/session (no "Replaced by new connection" kick).
 *
 * Public API:
 *   register(userId, socket, sessionId) - create or add socket to session (same sessionId = add socket)
 *   getSocket(userId)         - returns first live WebSocket for user
 *   getSockets(userId)       - returns all live sockets for user
 *   remove(userId)            - close all sockets for userId (revoke-all)
 *   removeSession(sessionId)  - close all sockets for that session
 *   removeConnection(ws)      - remove one socket by identity
 */
const logger = require('../../utils/logger');
const { logStateTransition, transition, TRANSITION_EVENT } = require('../../utils/logger');
const config = require('../../config/constants');
const sessionStore = require('../state/sessionStore');
const connectionStore = require('../state/connectionStore');
const lifecycle = require('./lifecycle');
const metrics = require('../../observability/metrics');
const userDiagnostics = require('../../diagnostics/userDiagnosticsAggregator');
const suspiciousDetector = require('../../suspicious/suspicious.detector');
const adminActivityBuffer = require('../../observability/adminActivityBuffer');

const OPEN = 1; // WebSocket.OPEN
const CLOSING = 2;
const CLOSED = 3;

/** Heartbeat interval: detect zombie connections (TCP open but client gone). */
const HEARTBEAT_INTERVAL_MS = 30000;


/** @type {'natural_close'|'forced_removal'|'lazy_cleanup'} */
const CleanupReason = { NATURAL: 'natural_close', FORCED: 'forced_removal', LAZY: 'lazy_cleanup' };

/** Socket is not open (CLOSING or CLOSED). Use for "do not use for delivery". */
function isSocketDead(ws) {
  return !ws || ws.readyState === CLOSING || ws.readyState === CLOSED;
}

/** Socket is fully closed. Use for lazy cleanup only; do NOT remove CLOSING sockets (close event will run). */
function isSocketTrulyClosed(ws) {
  return !ws || ws.readyState === CLOSED;
}

function getConnectionKey(ws, sessionId) {
  if (!ws) return null;
  const sid = sessionId || connectionStore.getSocketSession(ws) || '?';
  const addr = ws._socket ? `${ws._socket.remoteAddress}:${ws._socket.remotePort}` : '?';
  return `${sid}:${addr}`;
}

/**
 * Attach ping/pong heartbeat to a socket. If the socket misses one heartbeat,
 * it is terminated and existing cleanup runs. Timer is cleared on close.
 * @param {WebSocket} socket - WebSocket connection
 */
function attachHeartbeat(socket) {
  socket.isAlive = true;
  const intervalId = setInterval(() => {
    if (socket.isAlive === false) {
      clearInterval(intervalId);
      logger.info('ConnectionManager', 'heartbeat_failed', { action: 'terminating_socket' });
      socket.terminate();
      return;
    }
    socket.isAlive = false;
    socket.ping();
  }, HEARTBEAT_INTERVAL_MS);
  socket.once('close', () => clearInterval(intervalId));
  socket.on('pong', () => { socket.isAlive = true; });
}

class ConnectionManager {
  constructor() {
  }

  /**
   * Register a socket for a user and session. sessionId required for auth flow; use synthetic id for dev bypass.
   * If session already exists (reconnect), attach socket; else create new session.
   */
  register(userId, socket, sessionId) {
    if (!userId || !socket) {
      throw new Error('userId and socket are required');
    }
    const sid = sessionId || `bypass_${userId}`;
    const incomingConnectionId = socket._socket
      ? `${socket._socket.remoteAddress || '?'}:${socket._socket.remotePort || '?'}`
      : null;
    const existing = sessionStore.getSessionBySessionId(sid);
    const existingCountUserId = this.getSockets(userId).length;
    const existingCountSessionId = existing && existing.sockets ? existing.sockets.size : 0;
    let action = existing ? 'added_new' : 'created';
    let closeCode = null;
    let closeReason = null;

    if (socket.readyState !== OPEN) {
      logger.warn('ConnectionManager', 'register_rejected_socket_not_open', {
        userId,
        readyState: socket.readyState,
      });
      return;
    }

    const existingUserId = connectionStore.getSocketUser(socket);
    if (existingUserId != null && existingUserId !== userId) {
      logger.warn('ConnectionManager', 'register_rejected_same_socket_different_user', {
        userId,
        existingUserId,
      });
      return;
    }

    if (existing && existing.sockets && existing.sockets.has(socket)) {
      logger.debug('ConnectionManager', 'register_idempotent', { userId, sessionId: sid });
      return;
    }

    let evicted = null;
    if (existing) {
      const result = sessionStore.attachSocket(sid, socket);
      evicted = result.evicted || null;
      try { metrics.increment('reconnect_total'); } catch (_) { /* no-op */ }
      try { userDiagnostics.onReconnect(userId); userDiagnostics.markConnectionStart(userId); } catch (_) { /* no-op */ }
      try { suspiciousDetector.recordReconnect(userId); } catch (_) { /* no-op */ }
    } else {
      sessionStore.createSession(userId, sid, socket);
      try { userDiagnostics.markConnectionStart(userId); } catch (_) { /* no-op */ }
    }
    connectionStore.setSocketUser(socket, userId);
    connectionStore.setSocketSession(socket, sid);
    const connKey = socket._socket
      ? `${sid}:${socket._socket.remoteAddress}:${socket._socket.remotePort}:${Date.now()}`
      : `${sid}:${Date.now()}:${Math.random()}`;
    socket.__connKey = connKey;
    socket._connectionKey = getConnectionKey(socket, sid);
    socket._connectionId = crypto.randomBytes(6).toString('hex');
    socket._connectedAt = Date.now();
    this._attachCloseAndHeartbeat(userId, sid, socket);

    if (evicted) {
      closeCode = 4002;
      closeReason = 'Too many tabs';
      try {
        if (evicted.readyState === OPEN) evicted.close(4002, 'Too many tabs');
      } catch (err) {
        logger.warn('ConnectionManager', 'evict_close_error', { userId, sessionId: sid, error: err.message });
      }
      this.cleanup(userId, sid, evicted, CleanupReason.FORCED);
    }
    transition({
      event: TRANSITION_EVENT.CONNECTION_OPEN,
      messageId: null,
      connectionId: null,
      userId,
      fromState: null,
      toState: 'OPEN',
    });
    lifecycle.onConnect(userId);
    try {
      adminActivityBuffer.recordEvent({
        type: 'connect',
        title: 'WS connected',
        detail: `userId=${userId} sessionId=${sid} conn=${socket._connectionId}`,
        severity: 'info',
        userId,
        sessionId: sid,
      });
    } catch (_) { /* no-op */ }
  }

  /** Decode close reason (may be Buffer in Node 'ws'); cap at 200 chars for logging. */
  _decodeCloseReason(reason) {
    if (reason == null) return '';
    if (Buffer.isBuffer(reason)) {
      try {
        return reason.toString('utf8').slice(0, 200);
      } catch {
        return '[decode_error]';
      }
    }
    return String(reason).slice(0, 200);
  }

  _attachCloseAndHeartbeat(userId, sessionId, socket) {
    socket.once('close', (code, reason) => {
      const connectionId = socket._connectionKey || getConnectionKey(socket, sessionId);
      const closeCode = typeof code === 'number' ? code : 0;
      const closeReason = this._decodeCloseReason(reason);
      const connectedAt = socket._connectedAt;
      const durationMs = connectedAt ? Date.now() - connectedAt : 0;
      const connId = socket._connectionId || 'unknown';
      logger.info('ConnectionManager', 'active_socket_closed', {
        userId,
        sessionId,
        connectionId,
        code: closeCode,
        reason: closeReason || undefined,
      });
      sessionStore.markOffline(sessionId, socket);
      connectionStore.deleteSocketUser(socket);
      const activeConnectionsForUser = this.getSockets(userId).length;
      const isLastForUser = activeConnectionsForUser === 0;
      if (isLastForUser) {
        try { userDiagnostics.markConnectionEnd(userId); } catch (_) { /* no-op */ }
        lifecycle.requestDisconnect(userId, {
          graceMs: config.PRESENCE_OFFLINE_GRACE_MS,
          reason: CleanupReason.NATURAL,
        });
        try {
          adminActivityBuffer.recordEvent({
            type: 'disconnect',
            title: 'WS disconnected',
            detail: `userId=${userId} sessionId=${sessionId} conn=${connId} code=${closeCode} reason=${closeReason} durationMs=${durationMs}`,
            severity: 'info',
            userId,
            sessionId,
          });
        } catch (_) { /* no-op */ }
        transition({
          event: TRANSITION_EVENT.CONNECTION_CLOSE,
          messageId: null,
          connectionId: null,
          userId,
          fromState: 'OPEN',
          toState: 'CLOSED',
          reason: CleanupReason.NATURAL,
        });
        logger.info('ConnectionManager', 'connection_cleanup', { userId, sessionId, reason: CleanupReason.NATURAL });
      } else {
        logger.info('ConnectionManager', 'socket_removed_user_still_connected', { userId, sessionId, remainingForUser: activeConnectionsForUser });
      }
    });
    attachHeartbeat(socket);
  }

  cleanup(userId, sessionId, socket, reason) {
    const connectionId = socket._connectionKey || getConnectionKey(socket, sessionId);
    const connId = socket._connectionId || 'unknown';
    const connectedAt = socket._connectedAt;
    const durationMs = connectedAt ? Date.now() - connectedAt : 0;
    sessionStore.markOffline(sessionId, socket);
    connectionStore.deleteSocketUser(socket);
    const activeConnectionsForUser = this.getSockets(userId).length;
    const isLastForUser = activeConnectionsForUser === 0;
    if (isLastForUser) {
      try { userDiagnostics.markConnectionEnd(userId); } catch (_) { /* no-op */ }
      if (reason === CleanupReason.FORCED) {
        lifecycle.onDisconnect(userId);
      } else {
        lifecycle.requestDisconnect(userId, {
          graceMs: config.PRESENCE_OFFLINE_GRACE_MS,
          reason,
        });
      }
      try {
        adminActivityBuffer.recordEvent({
          type: 'disconnect',
          title: 'WS disconnected',
          detail: `userId=${userId} sessionId=${sessionId} conn=${connId} code=0 reason=${reason || ''} durationMs=${durationMs}`,
          severity: 'info',
          userId,
          sessionId,
        });
      } catch (_) { /* no-op */ }
      transition({
        event: TRANSITION_EVENT.CONNECTION_CLOSE,
        messageId: null,
        connectionId: null,
        userId,
        fromState: 'OPEN',
        toState: 'CLOSED',
        reason,
      });
      logger.info('ConnectionManager', 'connection_cleanup', { userId, sessionId, reason });
    } else {
      logger.info('ConnectionManager', 'socket_removed_user_still_connected', { userId, sessionId, remainingForUser: activeConnectionsForUser });
    }
  }

  /**
   * Returns primary live socket for user (backward compat). Use getSockets(userId) to broadcast to all tabs.
   */
  getSocket(userId) {
    const sessions = sessionStore.getSessionsByUserId(userId);
    for (const { sessionId: sid, socket: ws } of sessions) {
      if (!ws) continue;
      if (isSocketTrulyClosed(ws)) {
        logger.info('ConnectionManager', 'lazy_cleanup_via_getSocket', { userId, sessionId: sid });
        sessionStore.markOffline(sid, ws);
        connectionStore.deleteSocketUser(ws);
      }
    }
    const primary = sessionStore.getPrimaryForUser(userId);
    if (primary && !isSocketDead(primary)) {
      return primary;
    }
    const sockets = this.getSockets(userId);
    // getSocket() is read-only; presence OFFLINE is handled only by ws close handlers to avoid recursive broadcast loops.
    return sockets.length > 0 ? sockets[0] : null;
  }

  remove(userId) {
    const sessions = sessionStore.getSessionsByUserId(userId);
    const seenSessionIds = new Set();
    for (const { sessionId: sid, socket: ws } of sessions) {
      if (ws) {
        try {
          if (ws.readyState === OPEN) ws.close(1000, 'Removed');
        } catch (err) {
          logger.warn('ConnectionManager', 'remove_close_error', { userId, sessionId: sid, error: err.message });
        }
        this.cleanup(userId, sid, ws, CleanupReason.FORCED);
      }
      seenSessionIds.add(sid);
    }
    for (const sid of seenSessionIds) {
      const session = sessionStore.getSessionBySessionId(sid);
      if (session && (!session.sockets || session.sockets.size === 0)) sessionStore.deleteSession(sid);
    }
  }

  /**
   * Kick one session: close all WS for that sessionId (revoke that device/tab).
   */
  removeSession(sessionId) {
    const session = sessionStore.getSessionBySessionId(sessionId);
    if (!session) return false;
    const userId = session.userId;
    const sockets = session.sockets ? Array.from(session.sockets) : [];
    for (const ws of sockets) {
      try {
        if (ws.readyState === OPEN) ws.close(1000, 'Session revoked');
      } catch (err) {
        logger.warn('ConnectionManager', 'removeSession_close_error', { sessionId, error: err.message });
      }
      this.cleanup(userId, sessionId, ws, CleanupReason.FORCED);
    }
    sessionStore.deleteSession(sessionId);
    return true;
  }

  removeConnection(ws) {
    const userId = connectionStore.getSocketUser(ws) || null;
    const sessionId = connectionStore.getSocketSession(ws) || null;
    if (userId && sessionId) {
      this.cleanup(userId, sessionId, ws, CleanupReason.FORCED);
    }
    return userId;
  }

  getUserId(ws) {
    return connectionStore.getSocketUser(ws) || null;
  }

  getConnections(userId) {
    const sessions = sessionStore.getSessionsByUserId(userId);
    const out = [];
    for (const { sessionId: sid, socket: ws } of sessions) {
      if (ws && !isSocketDead(ws)) out.push(ws);
    }
    return out;
  }

  /**
   * Returns all live sockets for a user (all tabs/devices). Use for broadcast so every tab receives the message.
   * Only returns OPEN sockets (not CLOSING) so delivery is safe.
   */
  getSockets(userId) {
    const sessions = sessionStore.getSessionsByUserId(userId);
    const out = [];
    for (const { sessionId: sid, socket: ws } of sessions) {
      if (ws && ws.readyState === OPEN) out.push(ws);
    }
    return out;
  }

  /**
   * Count of connections that are OPEN or CLOSING (for presence: user is "online" until last socket is CLOSED).
   * Use for isUserConnected/diagnostics so we don't show offline while a socket is still in CLOSING state.
   */
  getActiveConnectionCount(userId) {
    const sessions = sessionStore.getSessionsByUserId(userId);
    let count = 0;
    for (const { socket: ws } of sessions) {
      if (ws && ws.readyState !== CLOSED) count += 1;
    }
    return count;
  }

  /**
   * Return redacted connection keys for debugging (admin). One per socket (OPEN or CLOSING).
   */
  getConnectionKeys(userId) {
    const sessions = sessionStore.getSessionsByUserId(userId);
    const out = [];
    for (const { sessionId: sid, socket: ws } of sessions) {
      if (ws && ws.readyState !== CLOSED) {
        const key = ws._connectionKey || getConnectionKey(ws, sid);
        out.push(key ? `${sid}:****` : `${sid}:****`);
      }
    }
    return out;
  }

  /**
   * Returns live sockets for one (userId, sessionId). Use when targeting a specific session.
   */
  getSocketsForSession(userId, sessionId) {
    const session = sessionStore.getSessionBySessionId(sessionId);
    if (!session || session.userId !== userId || !session.sockets) return [];
    const out = [];
    for (const ws of session.sockets) {
      if (ws && !isSocketDead(ws)) out.push(ws);
    }
    return out;
  }

  getSessionId(ws) {
    return connectionStore.getSocketSession(ws) || null;
  }

  isUserConnected(userId) {
    return this.getActiveConnectionCount(userId) > 0;
  }

  getConnectedUsers() {
    return sessionStore.getUserIds().filter((id) => this.getSocket(id) !== null);
  }

  /**
   * Total active WebSocket connections (tabs/devices), not unique users.
   * Counts every live socket across all sessions.
   */
  getConnectionCount() {
    const sessions = sessionStore.getAllSessions();
    let count = 0;
    for (const s of sessions) {
      const sockets = s && s.sockets;
      if (!sockets) continue;
      for (const ws of sockets) {
        if (ws.readyState !== CLOSING && ws.readyState !== CLOSED) count += 1;
      }
    }
    return count;
  }

  /**
   * Number of unique authenticated userIds that have at least one active WebSocket.
   * Use for admin "online users" metric (reconnects/stale sockets do not double-count).
   */
  getOnlineUserCount() {
    return this.getConnectedUsers().length;
  }

  clear() {
    const sessions = sessionStore.getAllSessions();
    for (const s of sessions) {
      const sockets = s && s.sockets;
      if (!sockets) continue;
      for (const ws of sockets) {
        try { ws.close(1001, 'Server shutting down'); } catch { /* ignore */ }
      }
    }
    sessionStore.clear();
  }
}

const connectionManager = new ConnectionManager();
module.exports = connectionManager;
