'use strict';

/**
 * Tier-1: Dispatcher delegates to router.handleIncoming.
 * Router is the single safety gate; dispatcher does NOT call socketSafety for validation.
 */

const router = require('../router');
const socketSafety = require('../safety/socketSafety');
const logger = require('../../utils/logger');
const monitoring = require('../../utils/monitoring');
const { recordLatency } = require('../../observability/aggregators/latency');
const { generateCorrelationId } = require('../../utils/correlation');
const recovery = require('../recovery');
const connectionStore = require('../state/connectionStore');

// MOVED IN PHASE 2 — NO LOGIC CHANGE: parseMessage from protocol/validate.js
const { parseMessage } = require('./validate');

/**
 * Send response to client with backpressure handling
 * @param {WebSocket} ws - Client WebSocket
 * @param {Object} response - Response object
 */
function sendResponse(ws, response) {
  if (!response) return;

  if (ws.readyState !== 1) { // WebSocket.OPEN
    return;
  }

  // ALL messages go through queue system - no direct ws.send()
  // Queue processing handles backpressure automatically
  monitoring.increment('messages', 'sent');
  socketSafety.sendMessage(ws, response);
}

/**
 * Handle incoming message. Tier-1: Router is single gate; dispatcher only forwards.
 * @param {WebSocket} ws - Client WebSocket
 * @param {string|Buffer} data - Raw message data
 * @param {Object} context - Context object with correlationId
 */
async function handleMessage(ws, data, context = {}) {
  const startMs = Date.now();
  // WS-1 diagnostic: prove close code + HELLO/context race (logs only)
  let type;
  try {
    const raw = Buffer.isBuffer(data) ? data.toString('utf8') : data;
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : null;
    type = parsed && parsed.type;
  } catch (_) { type = null; }
  
  const correlationId = context.correlationId || generateCorrelationId();
  const connectionManager = require('../connection/connectionManager');
  const userId = connectionManager.getUserId(ws) || null;
  const connectionId = ws._socket ? `${ws._socket.remoteAddress}:${ws._socket.remotePort}` : null;
  
  if (type === 'HELLO') {
    logger.info('ws', 'hello_received', {
      event: 'hello_received',
      hasContext: !!ws.context,
      hasCaps: !!ws.context?.capabilities,
      userId: ws.userId,
      sessionId: ws.sessionId,
      socketSession: connectionStore.getSocketSession(ws),
    });
  }
  // Phase 5: Zombie socket detection — exempt HELLO so handshake can complete (WS-3 backstop)
  if (type !== 'HELLO' && recovery.detectZombieSocket(ws)) {
    recovery.cleanupZombieSocket(ws);
    return;
  }

  monitoring.increment('messages', 'received');
  
  logger.info('ws', 'message_received', {
    correlationId,
    userId,
    connectionId,
  });

  const result = await router.handleIncoming(ws, data, sendResponse, { correlationId });

  if (result.policy === 'DROP') {
    try { recordLatency(Date.now() - startMs); } catch (_) { /* no-op */ }
    return;
  }

  if (result.policy === 'FAIL' && result.response) {
    monitoring.increment('messages', 'errors');
    try {
      const adminActivityBuffer = require('../../observability/adminActivityBuffer');
      adminActivityBuffer.recordEvent({
        type: 'failure',
        title: 'Message delivery failure',
        detail: userId ? `userId: ${userId}` : 'unknown',
        severity: 'warning',
      });
    } catch (_) { /* no-op */ }
    sendResponse(ws, result.response);
    try { recordLatency(Date.now() - startMs); } catch (_) { /* no-op */ }
    return;
  }

  if (result.policy === 'ALLOW' && result.response) {
    sendResponse(ws, result.response);
    // Policy A: no success logging — activity feed shows only failures, lifecycle, moderation, flags.
  }

  try {
    recordLatency(Date.now() - startMs);
  } catch (_) { /* no-op */ }
}

module.exports = {
  handleMessage,
  parseMessage,
  sendResponse,
};
