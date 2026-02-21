'use strict';

const { WebSocketServer } = require('ws');
const { getCookie } = require('../../utils/cookies');
const tokenService = require('../../auth/tokenService');
const authSessionStore = require('../../auth/sessionStore');
const connectionManager = require('./connectionManager');
const protocolDispatcher = require('../protocol/dispatcher');
const heartbeat = require('./heartbeat');
const presenceEngine = require('../handlers/presence');
const messageEngine = require('../handlers/messageEngine');
const socketSafety = require('../safety/socketSafety');
const config = require('../../config/constants');
const logger = require('../../utils/logger');
const monitoring = require('../../utils/monitoring');
const { capabilitiesFor } = require('../../auth/capabilities');
const recovery = require('../recovery');
const connectionStore = require('../state/connectionStore');
const eventBus = require('../../diagnostics/eventBus');
const userStore = require('../../storage/user.store');
const { getClientIpFromWsRequest } = require('../../utils/ip');
const adminActivityBuffer = require('../../observability/adminActivityBuffer');

const JWT_COOKIE_NAME = config.JWT_COOKIE_NAME;

/** Decode close reason safely (Node 'ws' may pass Buffer); cap at 200 chars for logging. Never throws. */
function decodeCloseReason(reason) {
  if (reason == null) return '';
  try {
    if (Buffer.isBuffer(reason)) return reason.toString('utf8').slice(0, 200) || '';
    if (typeof reason === 'string') return reason.slice(0, 200);
    return String(reason).slice(0, 200);
  } catch {
    return '[decode_error]';
  }
}

/** Dedupe WS auth rejection events by ip+reason to avoid DB explosion. Key -> lastEmittedAt. */
const wsAuthRejectDedupe = new Map();
const WS_AUTH_REJECT_DEDUPE_MS = 60000;

function shouldEmitWsAuthReject(clientIp, reason) {
  const key = `${String(clientIp || 'unknown')}:${String(reason || 'unknown')}`;
  const last = wsAuthRejectDedupe.get(key);
  if (last != null && Date.now() - last < WS_AUTH_REJECT_DEDUPE_MS) return false;
  wsAuthRejectDedupe.set(key, Date.now());
  if (wsAuthRejectDedupe.size > 1000) {
    const cutoff = Date.now() - WS_AUTH_REJECT_DEDUPE_MS * 2;
    for (const [k, t] of wsAuthRejectDedupe.entries()) {
      if (t < cutoff) wsAuthRejectDedupe.delete(k);
    }
  }
  return true;
}

function recordWsAuthRejected(clientIp, reason, userId) {
  if (!shouldEmitWsAuthReject(clientIp, reason)) return;
  try {
    const detailParts = [`reason=${reason}`, `ip=${clientIp || 'unknown'}`];
    if (userId != null && String(userId).trim()) detailParts.push(`userId=${userId}`);
    adminActivityBuffer.recordEvent({
      type: 'failure',
      title: 'WS auth rejected',
      detail: detailParts.join(' '),
      severity: 'warning',
      userId: userId != null ? String(userId) : undefined,
    });
  } catch (_) { /* no-op */ }
}

/**
 * Phase 2G: Validate access JWT, resolve session (must exist and not revoked), attach userId/sessionId/role to socket.
 * Returns { userId, sessionId, role } or null on failure.
 */
function resolveSessionFromToken(socket, token) {
  if (!token) {
    eventBus.emitReconnectAuthFailed({ reason: 'no_token', socketId: undefined, timestamp: Date.now() });
    return null;
  }
  const payload = tokenService.verifyAccess(token);
  if (!payload) {
    eventBus.emitReconnectAuthFailed({ reason: 'invalid_or_expired_token', socketId: undefined, timestamp: Date.now() });
    return null;
  }
  const userId = payload.userId;
  const sessionId = payload.sid;
  if (!userId) {
    eventBus.emitReconnectAuthFailed({ reason: 'invalid_token_payload', socketId: undefined, timestamp: Date.now() });
    return null;
  }
  if (!sessionId) {
    eventBus.emitReconnectAuthFailed({ reason: 'no_sid', socketId: undefined, timestamp: Date.now() });
    return null;
  }
  return { userId, sessionId, role: payload.role || 'USER' };
}

/**
 * WebSocket close codes
 * @enum {number}
 */
const CloseCodes = {
  NORMAL: 1000,
  GOING_AWAY: 1001,
  PROTOCOL_ERROR: 1002,
  UNSUPPORTED: 1003,
  INVALID_PAYLOAD: 1007,
  POLICY_VIOLATION: 1008,
  MESSAGE_TOO_BIG: 1009,
  INTERNAL_ERROR: 1011,
  // Custom codes (4000-4999)
  UNAUTHORIZED: 4001,
  TOKEN_EXPIRED: 4002,
  INVALID_TOKEN: 4003,
  RATE_LIMIT: 4008,
};

/**
 * Server shutdown state
 * @type {boolean}
 */
let isShuttingDown = false;

/**
 * Get client IP from WebSocket upgrade request (normalized: ::1 -> 127.0.0.1, X-Forwarded-For first).
 * @param {IncomingMessage} request - HTTP upgrade request
 * @returns {string} Normalized IP or 'unknown'
 */
function getClientIp(request) {
  return getClientIpFromWsRequest(request) || 'unknown';
}

/**
 * Create and configure WebSocket server
 * @param {Object} options - Configuration options
 * @returns {WebSocketServer} Configured WebSocket server
 */
function createWebSocketServer(options = {}) {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: options.maxPayload || config.PAYLOAD.maxSize,
    ...options,
  });

  // Start heartbeat monitoring
  heartbeat.startHeartbeat(wss);

  // Handle new connections
  wss.on('connection', (ws, request, userId, userRole) => {
    if (isShuttingDown) {
      logger.warn('WebSocketServer', 'rejecting_connection_during_shutdown', { userId });
      ws.close(1001, 'Server shutting down');
      monitoring.increment('connections', 'rejected');
      return;
    }
    
    // Ensure cleanup happens even if setupConnection throws
    // Store IP early for reliable cleanup
    ws.clientIp = getClientIp(request);
    
    // Setup connection (may throw, but cleanup will handle it)
    setupConnection(ws, request, userId, userRole).catch((err) => {
      // If setup fails, ensure cleanup happens
      logger.error('WebSocketServer', 'setup_connection_error', { 
        userId, 
        error: err.message,
        clientIp: ws.clientIp,
      });
      
      // Remove from connection manager if partially established
      const removedUserId = connectionManager.removeConnection(ws);
      
      // Close the connection
      try {
        ws.close(1011, 'Connection setup failed');
      } catch (closeErr) {
        // Ignore close errors
      }
    });
  });

  wss.on('error', (error) => {
    logger.error('WebSocketServer', 'server_error', { error: error.message });
  });

  wss.on('close', () => {
    logger.info('WebSocketServer', 'server_closed', {});
    heartbeat.stopHeartbeat();
  });

  logger.info('WebSocketServer', 'created', { 
    maxPayload: options.maxPayload || config.PAYLOAD.maxSize,
    protocolVersion: config.PROTOCOL_VERSION,
  });

  return wss;
}

/**
 * Setup a new WebSocket connection
 * Treats reconnect as state reconciliation, not a fresh connection
 * @param {WebSocket} ws - WebSocket connection
 * @param {IncomingMessage} request - HTTP request
 * @param {string} userId - Authenticated user ID
 * @param {string} [userRole] - User role from JWT payload (may be undefined)
 */
async function setupConnection(ws, request, userId, userRole) {
  // A) Use real sessionId from upgrade; require it before any message handling
  const sessionId = ws.sessionId;
  if (!sessionId) {
    logger.error('WebSocketServer', 'setup_no_session', { userId });
    try {
      ws.close(1008, 'Session required');
    } catch {
      ws.terminate();
    }
    return;
  }

  // clientIp is already set in connection handler for reliable cleanup
  // Store userAgent for admin sessions API
  ws.userAgent = (request && request.headers && request.headers['user-agent']) ? String(request.headers['user-agent']) : null;
  ws.userId = userId;
  ws.isAlive = true;
  ws.connectedAt = Date.now();

  // B) Register first so session exists in sessionStore before any message (e.g. HELLO) can be processed
  connectionManager.register(userId, ws, sessionId);

  // C) Rehydrate context BEFORE attaching message handler so HELLO cannot be processed before ws.context exists
  const rehydrationSuccess = recovery.rehydrateOnReconnect(ws, userId, userRole);
  if (!rehydrationSuccess) {
    try {
      ws.close(4005, 'Context rehydration failed');
    } catch {
      ws.terminate();
    }
    return;
  }

  // D) Only after session + context, attach message handler
  ws.on('message', (data, isBinary) => {
    const { generateCorrelationId } = require('../../utils/correlation');
    const correlationId = generateCorrelationId();
    const connectionId = ws._socket ? `${ws._socket.remoteAddress}:${ws._socket.remotePort}` : null;
    if (isBinary) {
      logger.warn('WebSocketServer', 'binary_message_rejected', { correlationId, userId, connectionId });
      safeSend(ws, {
        type: 'ERROR',
        error: 'Binary messages not supported',
        code: 'UNSUPPORTED_FORMAT',
        version: config.PROTOCOL_VERSION,
      });
      return;
    }
    protocolDispatcher.handleMessage(ws, data, { correlationId });
  });

  // Emit SYSTEM_CAPABILITIES exactly once per connection (server-originated, one-way push)
  safeSend(ws, {
    type: 'SYSTEM_CAPABILITIES',
    capabilities: ws.context.capabilities
  });

  // Detect if this is a reconnect (session exists from previous connection; socket may be null after disconnect)
  const sessionStore = require('../state/sessionStore');
  const existingSession = sessionStore.getSession(userId);
  const isReconnect = existingSession !== null;

  // Initialize socket safety mechanisms
  socketSafety.initSocket(ws);

  // Initialize heartbeat for this connection
  heartbeat.initConnection(ws);

  // Tier-1.4: presence updated by lifecycle.onConnect (via connectionManager.register)

  const connectionType = isReconnect ? 'reconnect' : 'new';
  const totalConnections = 1; // Single session per user
  
  monitoring.increment('connections', 'total');
  monitoring.set('connections', 'active', connectionManager.getConnectionCount());
  
  logger.info('WebSocketServer', 'connection_established', {
    userId,
    connectionType,
    totalConnections,
    isReconnect,
  });
  if (isReconnect) logger.info('WS', 'user_reconnected', { userId });

  // Send connection confirmation with reconnect flag
  safeSend(ws, {
    type: 'CONNECTION_ESTABLISHED',
    userId,
    isReconnect,
    connectionCount: totalConnections,
    version: config.PROTOCOL_VERSION,
    timestamp: Date.now(),
  });

  // Presence hydration: send snapshot of currently-online users (exclude self) so UI does not default everyone to offline after refresh
  const onlineUserIds = presenceEngine.getOnlineUsers().filter((uid) => uid !== userId);
  const presenceMap = presenceEngine.getPresenceBulk(onlineUserIds);
  const users = {};
  for (const [uid, p] of Object.entries(presenceMap)) {
    users[uid] = { status: p.status, lastSeen: p.lastSeen ?? null };
  }
  safeSend(ws, {
    type: 'PRESENCE_SNAPSHOT',
    users,
    timestamp: Date.now(),
    version: config.PROTOCOL_VERSION,
  });

  // For reconnect, automatically send state sync information
  // This allows the client to reconcile state without explicit request
  if (isReconnect) {
    // Send state sync response asynchronously (don't block connection)
    // Client can also explicitly request sync via STATE_SYNC message
    setTimeout(async () => {
      try {
        const syncResponse = await messageEngine.handleStateSync(ws, {
          lastMessageId: null, // Client should provide this if needed
          lastReadMessageId: null, // Client should provide this if needed
        });
        safeSend(ws, syncResponse);
      } catch (error) {
        logger.error('WebSocketServer', 'state_sync_failed', { userId, error: error.message });
      }
    }, 100); // Small delay to ensure connection is fully established
  }

  // Handle connection close — decode reason safely (Node 'ws' may pass Buffer)
  ws.on('close', (code, reason) => {
    const closeCode = typeof code === 'number' ? code : 0;
    const reasonStr = decodeCloseReason(reason);
    logger.info('WebSocketServer', 'ws_closed', {
      event: 'ws_closed',
      code: closeCode,
      reason: reasonStr || undefined,
      userId: ws.userId,
      sessionId: ws.sessionId,
      hasContext: !!ws.context,
    });
    if (process.env.NODE_ENV !== 'production') {
      logger.debug('WebSocketServer', 'ws_close', { userId: ws.userId, code: closeCode, reason: reasonStr || undefined });
    }
    handleDisconnect(ws, code, reason);
  });

  // Handle errors
  ws.on('error', (error) => {
    if (process.env.NODE_ENV !== 'production') {
      logger.debug('WebSocketServer', 'ws_error', { userId, message: error?.message });
    }
    logger.error('WebSocketServer', 'socket_error', { userId, error: error.message });
    // Remove from connection manager if error occurs
    connectionManager.removeConnection(ws);
  });
}

/**
 * Handle WebSocket disconnection.
 * ConnectionManager already ran identity-safe cleanup in its 'close' listener;
 * do not call removeConnection here. Use ws.userId for presence/logging.
 */
function handleDisconnect(ws, code, reason) {
  const userId = ws.userId || connectionManager.getUserId(ws);

  socketSafety.cleanupSocket(ws);
  monitoring.increment('connections', 'closed');
  monitoring.set('connections', 'active', connectionManager.getConnectionCount());

  if (userId) {
    logger.info('WS', 'user_disconnected', { userId });
    // Presence set OFFLINE by lifecycle.onDisconnect (connectionManager cleanup). Do NOT remove from rooms on close (refresh = code 1001).
    logger.info('WebSocketServer', 'connection_closed', {
      userId,
      code,
      reason: reason ? reason.toString() : undefined,
      totalConnections: connectionManager.getConnectionCount(),
      isLastConnection: true, // Single session: every disconnect is "last" for that user
    });
  }
}

/**
 * Handle HTTP upgrade request
 * @param {WebSocketServer} wss - WebSocket server
 * @param {IncomingMessage} request - HTTP request
 * @param {Socket} socket - Network socket
 * @param {Buffer} head - First packet of upgraded stream
 */
function handleUpgrade(wss, request, socket, head) {
  const isDev = process.env.NODE_ENV !== 'production';
  let pathname = '';
  try {
    pathname = new URL(request.url || '', `http://${request.headers.host || 'localhost'}`).pathname;
  } catch (_) { pathname = '(parse failed)'; }
  const cookiePresent = !!(request.headers.cookie && request.headers.cookie.length > 0);
  if (isDev) {
    logger.debug('WebSocketServer', 'ws_upgrade', {
      requestUrl: request.url,
      pathname,
      pathnameMatchesWs: pathname === '/ws',
      cookiePresent,
    });
  }

  // Reject new connections during shutdown
  if (isShuttingDown) {
    logger.warn('WebSocketServer', 'upgrade_rejected_shutdown', {});
    rejectUpgrade(socket, 503, 'Service Unavailable: Server shutting down');
    monitoring.increment('connections', 'rejected');
    return;
  }

  const clientIp = getClientIp(request);

  // Check max connections limit
  if (config.SERVER.maxConnections > 0) {
    const currentConnections = connectionManager.getConnectionCount();
    if (currentConnections >= config.SERVER.maxConnections) {
      logger.warn('WebSocketServer', 'upgrade_rejected_max_connections', {
        current: currentConnections,
        max: config.SERVER.maxConnections,
      });
      rejectUpgrade(socket, 503, 'Service Unavailable: Maximum connections reached');
      monitoring.increment('connections', 'rejected');
      return;
    }
  }

  // Production: never accept accessToken via query (even if proxy/misconfig passes it)
  if (process.env.NODE_ENV === 'production') {
    try {
      const u = new URL(request.url || '', `http://${request.headers.host || 'localhost'}`);
      if (u.searchParams.has('accessToken')) {
        recordWsAuthRejected(clientIp, 'token_in_query_production', undefined);
        logger.warn('WebSocketServer', 'upgrade_rejected_token_in_query', { reason: 'Token in query not allowed in production' });
        rejectUpgrade(socket, 403, 'Forbidden: Token in query not allowed in production');
        monitoring.increment('connections', 'rejected');
        return;
      }
    } catch (_) { /* ignore */ }
  }

  // Extract token: cookie first; in DEV_TOKEN_MODE allow ?accessToken= (dev only)
  const cookieHeader = request.headers.cookie || '';
  let token = getCookie(cookieHeader, JWT_COOKIE_NAME);
  if (!token && process.env.DEV_TOKEN_MODE === 'true') {
    try {
      const u = new URL(request.url || '', `http://${request.headers.host || 'localhost'}`);
      const q = u.searchParams.get('accessToken');
      if (q && typeof q === 'string' && q.trim()) token = q.trim();
    } catch (_) { /* ignore */ }
  }
  if (isDev) logger.debug('WebSocketServer', 'ws_upgrade_token', { tokenPresent: !!token });

  if (!token) {
    recordWsAuthRejected(clientIp, 'no_token', undefined);
    eventBus.emitReconnectAuthFailed({ reason: 'no_token', socketId: undefined, timestamp: Date.now() });
    logger.warn('WebSocketServer', 'upgrade_rejected_no_token', { reason: 'No token provided', cookiePresent: !!cookieHeader });
    rejectUpgrade(socket, 401, 'Unauthorized: No token provided');
    monitoring.increment('connections', 'rejected');
    return;
  }

  const payload = tokenService.verifyAccess(token);
  if (!payload) {
    recordWsAuthRejected(clientIp, 'invalid_or_expired_token', undefined);
    eventBus.emitReconnectAuthFailed({ reason: 'invalid_or_expired_token', socketId: undefined, timestamp: Date.now() });
    logger.warn('WebSocketServer', 'upgrade_rejected_invalid_token', { reason: 'Invalid or expired token', cookiePresent: !!cookieHeader });
    rejectUpgrade(socket, 401, 'Unauthorized: Invalid or expired token');
    monitoring.increment('connections', 'rejected');
    return;
  }

  const userId = payload.userId;
  const sessionId = payload.sid;
  const userRole = payload.role || 'USER';

  if (!userId) {
    recordWsAuthRejected(clientIp, 'invalid_token_payload', undefined);
    eventBus.emitReconnectAuthFailed({ reason: 'invalid_token_payload', socketId: undefined, timestamp: Date.now() });
    logger.warn('WebSocketServer', 'upgrade_rejected_no_user_id', { reason: 'Invalid token payload', cookiePresent: !!cookieHeader });
    rejectUpgrade(socket, 401, 'Unauthorized: Invalid token payload');
    monitoring.increment('connections', 'rejected');
    return;
  }

  if (!sessionId) {
    recordWsAuthRejected(clientIp, 'no_sid', userId);
    eventBus.emitReconnectAuthFailed({ reason: 'no_sid', socketId: undefined, timestamp: Date.now() });
    logger.warn('WebSocketServer', 'upgrade_rejected_no_sid', { reason: 'Session ID required', cookiePresent: !!cookieHeader });
    rejectUpgrade(socket, 401, 'Unauthorized: Session required');
    monitoring.increment('connections', 'rejected');
    return;
  }

  if (isDev) logger.debug('WebSocketServer', 'ws_upgrade_resolved', { userId, sessionId, userRole });

  authSessionStore.getSession(sessionId).then(async (session) => {
    if (!session || session.revokedAt) {
      recordWsAuthRejected(clientIp, 'session_revoked', userId);
      eventBus.emitReconnectAuthFailed({ reason: 'session_revoked', socketId: sessionId, timestamp: Date.now() });
      logger.warn('WebSocketServer', 'upgrade_rejected_session', { sessionId, reason: 'WS rejected: revoked or missing session' });
      rejectUpgrade(socket, 401, 'Unauthorized: Session revoked');
      monitoring.increment('connections', 'rejected');
      return;
    }
    if (session.userId !== userId) {
      recordWsAuthRejected(clientIp, 'session_userId_mismatch', userId);
      logger.warn('WebSocketServer', 'upgrade_rejected_session', { sessionId, reason: 'WS rejected: session userId mismatch' });
      rejectUpgrade(socket, 401, 'Unauthorized: Invalid session');
      monitoring.increment('connections', 'rejected');
      return;
    }
    try {
      const banned = userStore.isBanned && (await userStore.isBanned(userId));
      if (banned) {
        recordWsAuthRejected(clientIp, 'banned', userId);
        logger.warn('WebSocketServer', 'upgrade_rejected_banned', { userId });
        rejectUpgrade(socket, 403, 'Forbidden: Account suspended');
        monitoring.increment('connections', 'rejected');
        return;
      }
    } catch (_) {
      /* ignore */
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      ws.userId = userId;
      ws.sessionId = sessionId;
      connectionStore.setSocketUser(ws, userId);
      connectionStore.setSocketSession(ws, sessionId);
      connectionManager.register(userId, ws, sessionId);
      authSessionStore.touchSession(sessionId).catch(() => {});
      wss.emit('connection', ws, request, userId, session.role || userRole);
    });
  }).catch((err) => {
    recordWsAuthRejected(clientIp, 'session_lookup_error', userId);
    logger.error('WebSocketServer', 'upgrade_session_lookup_error', { sessionId, error: err.message });
    rejectUpgrade(socket, 503, 'Service Unavailable');
    monitoring.increment('connections', 'rejected');
  });
}

/**
 * Reject WebSocket upgrade with HTTP error
 * @param {Socket} socket - Network socket
 * @param {number} statusCode - HTTP status code
 * @param {string} message - Error message
 */
function rejectUpgrade(socket, statusCode, message) {
  const response = [
    `HTTP/1.1 ${statusCode} ${message}`,
    'Content-Type: text/plain',
    'Connection: close',
    '',
    message,
  ].join('\r\n');

  socket.write(response);
  socket.destroy();
}

/**
 * Safely send message to WebSocket with backpressure handling
 * @param {WebSocket} ws - WebSocket connection
 * @param {Object} message - Message to send
 * @returns {boolean} True if sent successfully
 */
function safeSend(ws, message) {
  if (ws.readyState !== 1) { // WebSocket.OPEN
    return false;
  }

  // ALL messages go through queue system - no direct ws.send()
  // Queue processing handles backpressure automatically
  // Messages are queued even when backpressure is detected, so they can be sent later
  const result = socketSafety.sendMessage(ws, message);
  
  // Check if socket should be closed due to persistent overflow
  if (result.shouldClose) {
    socketSafety.closeAbusiveConnection(ws, 'Slow consumer: queue overflow', 1008);
  }
  
  return result.queued;
}

/**
 * Wait for pending sends to drain on all sockets
 * @param {number} timeoutMs - Maximum time to wait
 * @returns {Promise<{drained: boolean, remaining: number}>}
 */
async function drainPendingSends(timeoutMs = 3000) {
  const startTime = Date.now();
  const checkInterval = 100;
  let totalPending = 0;

  while (Date.now() - startTime < timeoutMs) {
    totalPending = 0;
    
    // Check all connected sockets for pending sends
    for (const userId of connectionManager.getConnectedUsers()) {
      const connections = connectionManager.getConnections(userId);
      for (const ws of connections) {
        const stats = socketSafety.getSocketStats(ws);
        if (stats && stats.backpressure) {
          totalPending += stats.backpressure.pendingSends;
        }
      }
    }

    if (totalPending === 0) {
      logger.debug('WebSocketServer', 'pending_sends_drained', { elapsed: Date.now() - startTime });
      return { drained: true, remaining: 0 };
    }

    // Wait before next check
    await new Promise(resolve => setTimeout(resolve, checkInterval));
  }

  logger.warn('WebSocketServer', 'drain_timeout', { remaining: totalPending, timeout: timeoutMs });
  return { drained: false, remaining: totalPending };
}

/**
 * Close a single connection gracefully
 * @param {WebSocket} ws - WebSocket connection
 * @param {string} userId - User ID
 * @param {number} code - Close code
 * @param {string} reason - Close reason
 */
function closeConnectionGracefully(ws, userId, code = 1001, reason = 'Server shutting down') {
  try {
    if (ws.readyState === 1) { // WebSocket.OPEN
      ws.close(code, reason);
    }
    socketSafety.cleanupSocket(ws);
  } catch (err) {
    logger.error('WebSocketServer', 'graceful_close_error', { userId, error: err.message });
  }
}

/**
 * Gracefully shutdown WebSocket server
 * Stops accepting new connections, drains pending messages, then closes existing ones cleanly
 * @param {WebSocketServer} wss - WebSocket server
 * @returns {Promise<void>}
 */
async function shutdown(wss) {
  if (isShuttingDown) {
    logger.warn('WebSocketServer', 'shutdown_already_in_progress', {});
    return;
  }

  const shutdownStartTime = Date.now();
  const activeConnections = connectionManager.getConnectionCount();
  
  logger.info('WebSocketServer', 'shutdown_initiated', {
    activeConnections,
    timestamp: shutdownStartTime,
  });

  isShuttingDown = true;

  // Stop accepting new connections
  // (handled in handleUpgrade and connection handler)

  // Stop heartbeat to prevent unnecessary pings during shutdown
  heartbeat.stopHeartbeat();

  // If we have active connections, proceed with graceful close
  if (activeConnections > 0) {
    logger.info('WebSocketServer', 'notifying_clients', { count: activeConnections });
    
    // Phase 1: Notify all clients about impending shutdown
    const shutdownMsg = {
      type: 'SERVER_SHUTDOWN',
      message: 'Server is shutting down',
      gracePeriodMs: 2000,
      version: config.PROTOCOL_VERSION,
      timestamp: Date.now(),
    };
    for (const userId of connectionManager.getConnectedUsers()) {
      const sockets = connectionManager.getSockets(userId);
      for (const ws of sockets) {
        socketSafety.sendMessage(ws, shutdownMsg);
      }
    }

    // Phase 2: Wait for pending sends to drain
    // This ensures in-flight messages are delivered before closing
    logger.info('WebSocketServer', 'draining_pending_sends', {});
    const drainResult = await drainPendingSends(3000);
    
    if (!drainResult.drained) {
      logger.warn('WebSocketServer', 'some_messages_may_be_lost', {
        pendingCount: drainResult.remaining,
      });
    }

    // Phase 3: Give clients additional time to acknowledge shutdown
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Phase 4: Close all connections gracefully
    logger.info('WebSocketServer', 'closing_all_connections', {
      count: connectionManager.getConnectionCount(),
    });
    
    // Close connections one by one to ensure cleanup
    for (const userId of connectionManager.getConnectedUsers()) {
      const connections = connectionManager.getConnections(userId);
      for (const ws of connections) {
        closeConnectionGracefully(ws, userId, 1001, 'Server shutting down');
      }
    }

    // Clear connection manager
    connectionManager.clear();
  }

  // Close server with timeout
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      logger.warn('WebSocketServer', 'shutdown_timeout', {
        timeout: config.SERVER.shutdownTimeout,
        elapsed: Date.now() - shutdownStartTime,
      });
      resolve();
    }, config.SERVER.shutdownTimeout);

    wss.close(() => {
      clearTimeout(timeout);
      const totalElapsed = Date.now() - shutdownStartTime;
      logger.info('WebSocketServer', 'shutdown_complete', {
        elapsed: totalElapsed,
        metrics: monitoring.getMetrics(),
      });
      resolve();
    });
  });
}

module.exports = {
  createWebSocketServer,
  handleUpgrade,
  shutdown,
  safeSend,
  CloseCodes,
  JWT_COOKIE_NAME,
  getShutdownState: () => isShuttingDown,
};
