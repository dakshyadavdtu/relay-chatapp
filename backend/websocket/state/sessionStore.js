'use strict';

/**
 * Tier-1: sole owner of WebSocket session state.
 * Phase 3: Multiple sockets per session with primary + createdAt; MAX per session, evict oldest with 4002.
 * Session shape: { userId, sockets: Set<WebSocket>, primary: WebSocket|null, socketCreatedAt: Map<ws, number>, ... }
 */

const config = require('../../config/constants');

/** @type {Map<string, { userId: string, sockets: Set<WebSocket>, primary: WebSocket|null, socketCreatedAt: Map<WebSocket, number>, online: boolean, protocolVersion: number|null, lastSeenMessageId: string|null, lastSentMessageId: string|null, connectedAt: number }>} */
const _bySessionId = new Map();
/** @type {Map<string, Set<string>>} userId -> Set(sessionIds) */
const _byUserId = new Map();

const MAX_SOCKETS_PER_SESSION = Math.max(1, (config.MAX_SOCKETS_PER_SESSION || 3));

function _ensureUserIndex(userId) {
  if (!_byUserId.has(userId)) _byUserId.set(userId, new Set());
}

function _firstSessionForUser(userId) {
  const ids = _byUserId.get(userId);
  if (!ids) return null;
  for (const sid of ids) {
    const s = _bySessionId.get(sid);
    if (s && s.sockets && s.sockets.size > 0) return s;
  }
  return null;
}

/**
 * Get first session for userId that has at least one socket.
 */
function getSession(userId) {
  return _firstSessionForUser(userId);
}

/**
 * Get primary socket for user (first session's primary). Caller must check readyState.
 */
function getPrimaryForUser(userId) {
  const session = _firstSessionForUser(userId);
  return session && session.primary ? session.primary : null;
}

function getSessionBySessionId(sessionId) {
  return _bySessionId.get(sessionId) || null;
}

/**
 * Returns flattened list of { sessionId, userId, socket } so each socket is one entry (for getSocket/getSockets iteration).
 */
function getSessionsByUserId(userId) {
  const ids = _byUserId.get(userId);
  if (!ids) return [];
  const out = [];
  for (const sid of ids) {
    const s = _bySessionId.get(sid);
    if (!s || !s.sockets) continue;
    for (const ws of s.sockets) {
      out.push({ sessionId: sid, userId: s.userId, socket: ws });
    }
  }
  return out;
}

function createSession(userId, sessionId, socket) {
  const sockets = new Set();
  const socketCreatedAt = new Map();
  if (socket) {
    sockets.add(socket);
    socketCreatedAt.set(socket, Date.now());
  }
  _bySessionId.set(sessionId, {
    userId,
    sockets,
    primary: socket || null,
    socketCreatedAt,
    online: true,
    protocolVersion: null,
    lastSeenMessageId: null,
    lastSentMessageId: null,
    connectedAt: Date.now(),
  });
  _ensureUserIndex(userId);
  _byUserId.get(userId).add(sessionId);
}

/**
 * Add another socket to an existing session. Sets primary if missing. If over MAX_SOCKETS_PER_SESSION, evicts oldest.
 * @returns {{ evicted: WebSocket|null }} Evicted socket (caller must close with 4002 "Too many tabs") or null.
 */
function attachSocket(sessionId, socket) {
  const session = _bySessionId.get(sessionId);
  if (!session) return { evicted: null };
  const createdAt = Date.now();
  session.socketCreatedAt = session.socketCreatedAt || new Map();
  session.socketCreatedAt.set(socket, createdAt);
  session.sockets.add(socket);
  if (!session.primary) session.primary = socket;
  session.online = true;
  session.protocolVersion = null;

  let evicted = null;
  if (session.sockets.size > MAX_SOCKETS_PER_SESSION) {
    let oldestWs = null;
    let oldestAt = Infinity;
    for (const ws of session.sockets) {
      const at = session.socketCreatedAt.get(ws);
      if (at != null && at < oldestAt) {
        oldestAt = at;
        oldestWs = ws;
      }
    }
    if (oldestWs) {
      session.sockets.delete(oldestWs);
      session.socketCreatedAt.delete(oldestWs);
      if (session.primary === oldestWs) {
        let newestWs = null;
        let newestAt = 0;
        for (const ws of session.sockets) {
          const at = session.socketCreatedAt.get(ws) || 0;
          if (at >= newestAt) {
            newestAt = at;
            newestWs = ws;
          }
        }
        session.primary = newestWs;
      }
      evicted = oldestWs;
    }
  }
  return { evicted };
}

function updateLastSent(userId, messageId) {
  const session = _firstSessionForUser(userId);
  if (session) session.lastSentMessageId = messageId;
}

function getLastSent(userId) {
  const session = _firstSessionForUser(userId);
  return session ? session.lastSentMessageId : null;
}

function setProtocolVersion(userId, version) {
  const session = _firstSessionForUser(userId);
  if (session) session.protocolVersion = version;
}

function setProtocolVersionBySessionId(sessionId, version) {
  const session = _bySessionId.get(sessionId);
  if (session) session.protocolVersion = version;
}

function getProtocolVersion(userId) {
  const session = _firstSessionForUser(userId);
  return session ? session.protocolVersion : null;
}

/**
 * Remove one socket from session. If it was primary, set primary to newest remaining. Identity-safe.
 * @returns {boolean} true if this socket was removed
 */
function markOffline(sessionId, closedSocket) {
  const session = _bySessionId.get(sessionId);
  if (!session || !session.sockets) return false;
  if (!session.sockets.has(closedSocket)) return false;
  session.sockets.delete(closedSocket);
  if (session.socketCreatedAt) session.socketCreatedAt.delete(closedSocket);
  if (session.primary === closedSocket) {
    let newestWs = null;
    let newestAt = 0;
    for (const ws of session.sockets) {
      const at = (session.socketCreatedAt && session.socketCreatedAt.get(ws)) || 0;
      if (at >= newestAt) {
        newestAt = at;
        newestWs = ws;
      }
    }
    session.primary = newestWs;
  }
  if (session.sockets.size === 0) session.online = false;
  return true;
}

function markOfflineByUserId(userId, closedSocket) {
  const ids = _byUserId.get(userId);
  if (!ids) return false;
  for (const sid of ids) {
    const session = _bySessionId.get(sid);
    if (session && session.sockets && session.sockets.has(closedSocket)) {
      session.sockets.delete(closedSocket);
      if (session.socketCreatedAt) session.socketCreatedAt.delete(closedSocket);
      if (session.primary === closedSocket) {
        let newestWs = null;
        let newestAt = 0;
        for (const ws of session.sockets) {
          const at = (session.socketCreatedAt && session.socketCreatedAt.get(ws)) || 0;
          if (at >= newestAt) {
            newestAt = at;
            newestWs = ws;
          }
        }
        session.primary = newestWs;
      }
      if (session.sockets.size === 0) session.online = false;
      return true;
    }
  }
  return false;
}

function updateLastSeen(userId, messageId) {
  const session = _firstSessionForUser(userId);
  if (session) session.lastSeenMessageId = messageId;
}

function getUserIds() {
  return Array.from(_byUserId.keys());
}

/**
 * Enumerate all sessions (for connection counting). Each session has .sockets Set.
 */
function getAllSessions() {
  try {
    if (!_bySessionId || typeof _bySessionId.entries !== 'function') return [];
    const out = [];
    for (const [sessionId, s] of _bySessionId.entries()) {
      if (!s || typeof s !== 'object') continue;
      out.push({
        sessionId,
        userId: s.userId ?? '',
        sockets: s.sockets ?? new Set(),
        primary: s.primary ?? null,
        socketCreatedAt: s.socketCreatedAt ?? new Map(),
        online: !!s.online,
        protocolVersion: s.protocolVersion ?? null,
        lastSeenMessageId: s.lastSeenMessageId ?? null,
        lastSentMessageId: s.lastSentMessageId ?? null,
        connectedAt: typeof s.connectedAt === 'number' ? s.connectedAt : 0,
      });
    }
    return out;
  } catch (_) {
    return [];
  }
}

/**
 * Remove session by sessionId. Returns the session (with .sockets) for caller to close. Removes from both maps.
 */
function deleteSession(sessionId) {
  const session = _bySessionId.get(sessionId);
  if (!session) return null;
  _bySessionId.delete(sessionId);
  const ids = _byUserId.get(session.userId);
  if (ids) {
    ids.delete(sessionId);
    if (ids.size === 0) _byUserId.delete(session.userId);
  }
  return session;
}

function clear() {
  _bySessionId.clear();
  _byUserId.clear();
}

module.exports = {
  getSession,
  getSessionBySessionId,
  getSessionsByUserId,
  getPrimaryForUser,
  getAllSessions,
  createSession,
  attachSocket,
  markOffline,
  markOfflineByUserId,
  updateLastSeen,
  setProtocolVersion,
  setProtocolVersionBySessionId,
  getProtocolVersion,
  updateLastSent,
  getLastSent,
  getUserIds,
  deleteSession,
  clear,
};
