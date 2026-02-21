'use strict';

/**
 * Tier-0.4: THIN handler. No DB access, no replay logic. Validate → call replayService.replayMessages → emit returned messages.
 * Handler MUST NOT: read DB, mark delivery, filter messages, deduplicate. Replay service owns all of that.
 */

const connectionManager = require('../connection/connectionManager');
const sessionService = require('../services/session.service');
const presenceService = require('../services/presence.service');
const roomManager = require('../state/roomManager');
const logger = require('../../utils/logger');
const ErrorCodes = require('../../utils/errorCodes');
const replayService = require('../../services/replay.service');
const offlineService = require('../services/offline.service');
const { sendToUserSocket } = require('../services/message.service');
const { ensureSessionReady } = require('../utils/ensureSessionReady');

/**
 * Handle MESSAGE_REPLAY: validate, call replayService.replayMessages(userId, lastMessageId), emit returned messages.
 */
async function handleMessageReplay(ws, payload, context = {}) {
  const correlationId = context.correlationId || null;
  const userId = connectionManager.getUserId(ws);
  if (!userId) {
    return { type: 'MESSAGE_ERROR', error: 'Not authenticated', code: ErrorCodes.AUTH_REQUIRED };
  }
  const { lastMessageId } = payload || {};
  const limit = payload ? payload.limit : undefined;
  
  logger.info('replay', 'replay_start', {
    correlationId,
    userId,
    lastMessageId,
  });

  try {
    await ensureSessionReady(userId);
  } catch (err) {
    logger.error('Reconnect', 'session_not_ready', { correlationId, userId, error: err.message });
    return { type: 'MESSAGE_ERROR', error: 'Session not ready', code: ErrorCodes.REPLAY_ERROR, details: err.message };
  }

  let result;
  try {
    result = await replayService.replayMessages(userId, lastMessageId, limit, { correlationId });
  } catch (error) {
    logger.error('Reconnect', 'replay_failed', { correlationId, userId, error: error.message });
    return { type: 'MESSAGE_ERROR', error: 'Failed to replay messages', code: ErrorCodes.REPLAY_ERROR, details: error.message };
  }
  
  logger.info('replay', 'replay_end', {
    correlationId,
    userId,
    messageCount: result.messageCount ?? 0,
  });
  if (result.type === 'MESSAGE_ERROR') return result;
  if (result.type === 'MESSAGE_REPLAY_COMPLETE' && result.messages && result.messages.length > 0) {
    for (const msg of result.messages) {
      sendToUserSocket(userId, msg, { correlationId, messageId: msg.messageId });
    }
  }
  return {
    type: 'MESSAGE_REPLAY_COMPLETE',
    messageCount: result.messageCount ?? 0,
    lastMessageId: result.lastMessageId ?? lastMessageId ?? null,
    requestedAfter: result.requestedAfter ?? lastMessageId ?? null,
  };
}

/**
 * Handle STATE_SYNC request from client.
 * Thin handler: validate, delegate to offlineService.
 */
async function handleStateSync(ws, payload, context = {}) {
  const correlationId = context.correlationId || null;
  const userId = connectionManager.getUserId(ws);
  if (!userId) {
    return { type: 'MESSAGE_ERROR', error: 'Not authenticated', code: ErrorCodes.AUTH_REQUIRED };
  }
  const { lastMessageId, lastReadMessageId } = payload;
  try {
    const presence = presenceService.getPresence(userId);
    const presenceState = presence
      ? { status: presence.status, lastSeen: presence.lastSeen, metadata: presence.metadata }
      : { status: presenceService.PresenceStatus.OFFLINE, lastSeen: null, metadata: {} };
    return await offlineService.buildStateSyncResponse(userId, presenceState, { lastMessageId, lastReadMessageId });
  } catch (error) {
    logger.error('Reconnect', 'state_sync_failed', { correlationId, userId, error: error.message });
    return { type: 'MESSAGE_ERROR', error: 'Failed to synchronize state', code: ErrorCodes.SYNC_ERROR };
  }
}

/**
 * Handle RESUME (reconnect resync): validate, call replayService.replayMessages, emit returned messages.
 * Handler MUST NOT read DB, mark delivery, filter, or deduplicate.
 */
async function handleResume(ws, payload, sendResponse, context = {}) {
  const correlationId = context.correlationId || null;
  const userId = connectionManager.getUserId(ws);
  if (!userId) {
    try { ws.close(1000, 'Not authenticated'); } catch { /* ignore */ }
    return null;
  }
  const session = sessionService.getSession(userId);
  if (!session) {
    try { ws.close(1000, 'Invalid session'); } catch { /* ignore */ }
    logger.warn('ProtocolRouter', 'resync_failed', { correlationId, userId, reason: 'no_session' });
    return null;
  }
  const lastSeenMessageId = payload.lastSeenMessageId ?? null;
  sessionService.updateLastSeen(userId, lastSeenMessageId);
  logger.info('WS', 'resync_started', { correlationId, userId });
  sendResponse(ws, { type: 'RESYNC_START' });

  try {
    await ensureSessionReady(userId);
  } catch (err) {
    logger.error('ProtocolRouter', 'resync_session_not_ready', { correlationId, userId, error: err.message });
    try { ws.close(1011, 'Session not ready'); } catch { /* ignore */ }
    return null;
  }

  const REPLAY_TIMEOUT_MS = 8000;
  let result;
  try {
    result = await Promise.race([
      replayService.replayMessages(userId, lastSeenMessageId, payload.limit, { correlationId }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Replay timeout')), REPLAY_TIMEOUT_MS)),
    ]);
  } catch (err) {
    logger.warn('ProtocolRouter', 'resync_replay_error', { correlationId, userId, error: err.message });
    result = { type: 'MESSAGE_REPLAY_COMPLETE', messageCount: 0, messages: [] };
  }
  if (result.type === 'MESSAGE_REPLAY_COMPLETE' && result.messages && result.messages.length > 0) {
    for (const msg of result.messages) {
      sendResponse(ws, msg);
    }
  }
  const messageCount = result.type === 'MESSAGE_REPLAY_COMPLETE' ? (result.messageCount ?? 0) : 0;
  sendResponse(ws, { type: 'RESYNC_COMPLETE', messageCount });
  logger.info('WS', 'ordered_delivery_completed', { correlationId, userId, messageCount });

  // Phase 3D: Send rooms snapshot from roomManager (persistent membership). Do NOT use connection/session state.
  try {
    const rooms = roomManager.listRoomsForUser(userId);
    sendResponse(ws, {
      type: 'ROOMS_SNAPSHOT',
      rooms,
      timestamp: Date.now(),
    });
    logger.info('WS', 'rooms_snapshot_sent', { userId, roomCount: rooms.length });
  } catch (err) {
    logger.warn('WS', 'rooms_snapshot_failed', { userId, error: err.message });
  }

  return null;
}

module.exports = {
  handleMessageReplay,
  handleStateSync,
  handleResume,
};
