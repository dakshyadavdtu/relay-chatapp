'use strict';

/**
 * Wait until session exists and socket is attached (session restored, presence path ready).
 * Used before replay so replay runs only after session is registered.
 */

const sessionStore = require('../state/sessionStore');
const logger = require('../../utils/logger');

const DEFAULT_TIMEOUT_MS = 3000;
const POLL_INTERVAL_MS = 50;

/**
 * Resolve when session exists and has at least one socket (any tab). Does not depend on a single "active" socket.
 * @param {string} userId
 * @param {Object} [options]
 * @param {number} [options.timeoutMs]
 * @param {string} [options.sessionId] - If set, require this session to have sockets (stricter).
 * @returns {Promise<void>}
 */
async function ensureSessionReady(userId, options = {}) {
  const timeoutMs = options.timeoutMs != null ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
  const sessionId = options.sessionId || null;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const session = sessionId
      ? sessionStore.getSessionBySessionId(sessionId)
      : sessionStore.getSession(userId);
    if (session && session.sockets && session.sockets.size > 0) return;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  const sessionsForUser = sessionStore.getSessionsByUserId(userId);
  const activeSocketSessionId = sessionsForUser.length > 0 ? sessionsForUser[0].sessionId : null;
  const lastSession = sessionId ? sessionStore.getSessionBySessionId(sessionId) : sessionStore.getSession(userId);
  const condition = !lastSession ? 'no_session' : (!lastSession.sockets || lastSession.sockets.size === 0 ? 'no_sockets' : 'unknown');
  const err = Object.assign(new Error('Session not ready within timeout'), {
    userId,
    activeSocketSessionId,
    waitedMs: timeoutMs,
    conditionMissing: condition,
  });
  throw err;
}

module.exports = { ensureSessionReady };
