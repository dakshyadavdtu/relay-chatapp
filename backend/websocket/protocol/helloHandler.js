'use strict';

const connectionManager = require('../connection/connectionManager');
const sessionStore = require('../state/sessionStore');
const logger = require('../../utils/logger');

/** Application-level protocol versions (integer). No semver, no silent fallback. */
const SUPPORTED_VERSIONS = [1];

/**
 * Ensure HELLO has been sent before processing non-HELLO messages.
 * If HELLO required but not sent: sends ERROR, optionally closes, and returns false.
 * @param {WebSocket} ws - Client WebSocket
 * @param {string} type - Message type
 * @param {Function} sendResponse - sendResponse(ws, response)
 * @returns {boolean} true if OK to proceed to dispatch; false if already handled (send + return)
 */
function handlePreSwitch(ws, type, sendResponse) {
  if (type === 'HELLO') return true;

  const userId = connectionManager.getUserId(ws);
  const sessionId = connectionManager.getSessionId(ws);
  const session = sessionId
    ? sessionStore.getSessionBySessionId(sessionId)
    : (userId ? sessionStore.getSession(userId) : null);
  if (session && session.protocolVersion === null) {
    sendResponse(ws, { type: 'ERROR', code: 'HELLO_REQUIRED', message: 'HELLO must be the first message' });
    try { ws.close(1008, 'HELLO required'); } catch { /* ignore */ }
    return false;
  }
  return true;
}

/**
 * Handle HELLO message (protocol version negotiation).
 * @param {WebSocket} ws - Client WebSocket
 * @param {Object} payload - Message payload
 * @param {Function} sendResponse - sendResponse(ws, response)
 * @param {Object} context - Context object with correlationId
 * @returns {Object|null} Single response to send, or null if already sent and/or closed
 */
function handleHello(ws, payload, sendResponse, context = {}) {
  const correlationId = context.correlationId || null;
  const userId = connectionManager.getUserId(ws);
  const sessionId = connectionManager.getSessionId(ws);
  const session = sessionId
    ? sessionStore.getSessionBySessionId(sessionId)
    : (userId ? sessionStore.getSession(userId) : null);

  const isDev = process.env.NODE_ENV !== 'production';
  if (isDev) {
    logger.debug('WS', 'ws_hello', {
      userIdPresent: !!userId,
      userId: userId || undefined,
      sessionExists: !!session,
      requestedVersion: payload?.version,
    });
  }

  // Invariant: session must exist at HELLO time. Session is created in wsServer upgrade callback or setupConnection
  // via connectionManager.register(userId, ws) before the message handler runs (B1.3).
  if (!userId || !session) {
    const reason = !userId ? 'no userId on socket' : 'session missing for userId';
    if (isDev) logger.debug('WS', 'ws_hello_decision', { decision: 'ERROR_close_1008', reason, userIdPresent: !!userId, sessionExists: !!session });
    sendResponse(ws, { type: 'ERROR', code: 'HELLO_REQUIRED', message: 'Session required' });
    try { ws.close(1008, 'Not authenticated'); } catch { /* ignore */ }
    return null;
  }
  if (session.protocolVersion !== null) {
    if (isDev) logger.debug('WS', 'ws_hello_decision', { decision: 'ERROR', code: 'HELLO_ALREADY_SENT' });
    return { type: 'ERROR', code: 'HELLO_ALREADY_SENT', message: 'HELLO may only be sent once' };
  }
  const version = payload.version;
  if (typeof version !== 'number' || !Number.isInteger(version)) {
    if (isDev) logger.debug('WS', 'ws_hello_decision', { decision: 'ERROR_close_1008', reason: 'Invalid version' });
    sendResponse(ws, {
      type: 'ERROR',
      code: 'UNSUPPORTED_PROTOCOL_VERSION',
      message: 'Client protocol version must be a number',
    });
    try { ws.close(1008, 'Invalid version'); } catch { /* ignore */ }
    return null;
  }
  if (!SUPPORTED_VERSIONS.includes(version)) {
    logger.warn('WS', 'unsupported_protocol_version', { correlationId, userId, version });
    if (isDev) logger.debug('WS', 'ws_hello_decision', { decision: 'ERROR_close_1008', reason: 'Unsupported protocol version' });
    sendResponse(ws, {
      type: 'ERROR',
      code: 'UNSUPPORTED_PROTOCOL_VERSION',
      message: 'Client protocol version not supported',
    });
    try { ws.close(1008, 'Unsupported protocol version'); } catch { /* ignore */ }
    return null;
  }
  logger.info('WS', 'protocol_version_requested', { correlationId, userId, version });
  if (sessionId) {
    sessionStore.setProtocolVersionBySessionId(sessionId, version);
  } else {
    sessionStore.setProtocolVersion(userId, version);
  }
  logger.info('WS', 'protocol_negotiated', { correlationId, userId, version });
  if (isDev) logger.debug('WS', 'ws_hello_decision', { decision: 'HELLO_ACK' });
  return { type: 'HELLO_ACK', version };
}

module.exports = {
  handlePreSwitch,
  handleHello,
};
