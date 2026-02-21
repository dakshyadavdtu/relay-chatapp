'use strict';

/**
 * Connection metrics aggregator.
 * Reads from connectionManager and sessionStore (read-only).
 * NEVER mutates state.
 * NEVER throws - always returns safe defaults.
 */

/**
 * Get connections summary
 * @param {Object} state - State object (may be undefined/null)
 * @param {boolean} isAdmin - Whether caller has admin capability
 * @returns {Object} Connection metrics (always safe, never throws)
 */
const OPEN = 1;
const CLOSING = 2;
const CLOSED = 3;

function isSocketLive(ws) {
  try {
    return ws != null && typeof ws === 'object' && ws.readyState !== CLOSING && ws.readyState !== CLOSED;
  } catch {
    return false;
  }
}

function getConnectionsSummary(state, isAdmin) {
  try {
    const sessionStore = require('../../websocket/state/sessionStore');
    const { ROLES } = require('../../auth/roles');

    let sessions = [];
    try {
      const raw = sessionStore.getAllSessions();
      sessions = Array.isArray(raw) ? raw : [];
    } catch {
      return { total: 0 };
    }

    let totalSockets = 0;
    const adminUserIdsSet = new Set();
    const userUserIdsSet = new Set();

    for (const s of sessions) {
      if (!s || typeof s !== 'object') continue;
      const sockets = s.sockets;
      const socketSet = sockets instanceof Set ? sockets : (Array.isArray(sockets) ? new Set(sockets) : (s.socket != null ? new Set([s.socket]) : new Set()));
      let sessionHasLiveSocket = false;
      let roleForSession = ROLES.USER;
      for (const ws of socketSet) {
        if (!isSocketLive(ws)) continue;
        totalSockets += 1;
        sessionHasLiveSocket = true;
        try {
          const r = (ws && ws.context && typeof ws.context === 'object' && ws.context.role) ? ws.context.role : ROLES.USER;
          roleForSession = r;
        } catch {
          roleForSession = ROLES.USER;
        }
      }
      if (sessionHasLiveSocket && s.userId) {
        if (roleForSession === ROLES.ADMIN) {
          adminUserIdsSet.add(s.userId);
        } else {
          userUserIdsSet.add(s.userId);
        }
      }
    }

    const result = {
      total: totalSockets,
      countByRole: {
        admin: adminUserIdsSet.size,
        user: userUserIdsSet.size,
      },
    };

    if (isAdmin && adminUserIdsSet.size > 0) {
      result.adminUserIds = Array.from(adminUserIdsSet);
    }

    return result;
    } catch {
      try {
        const sessionStore = require('../../websocket/state/sessionStore');
        const raw = sessionStore.getAllSessions();
        const sessions = Array.isArray(raw) ? raw : [];
        let total = 0;
        for (const s of sessions) {
          if (!s || typeof s !== 'object') continue;
          const sockets = s.sockets;
          const socketSet = sockets instanceof Set ? sockets : (Array.isArray(sockets) ? new Set(sockets) : (s.socket != null ? new Set([s.socket]) : new Set()));
          for (const ws of socketSet) {
            if (isSocketLive(ws)) total += 1;
          }
        }
        return {
          total,
          countByRole: { admin: 0, user: total },
          adminUserIds: [],
        };
      } catch {
        return { total: 0, countByRole: { admin: 0, user: 0 }, adminUserIds: [] };
      }
    }
}

module.exports = {
  getConnectionsSummary,
};
