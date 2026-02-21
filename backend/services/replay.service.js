'use strict';

/**
 * replay.service.js — Tier-0.4: SINGLE, CANONICAL, DETERMINISTIC, IDEMPOTENT REPLAY SERVICE
 *
 * Replay is NOT "sending messages again". Replay is re-delivering already-persisted messages
 * that were missed due to disconnect, exactly once. Safe after server crash, memory wipe,
 * repeated reconnects, or duplicate reconnect requests.
 *
 * This file is the ONLY place where replay logic exists. persistMessage MUST NEVER appear here.
 *
 * DB: Query enforces messageId > lastMessageId (exclusive), ordered by messageId ASC.
 * WRITE only: updateMessageState + markMessageDelivered (after passing idempotency guards).
 * Replay NEVER inserts messages, NEVER mutates message content.
 *
 * Idempotency order (REQUIRED for crash safety): 1) DB delivery check FIRST, 2) Memory check SECOND.
 * Memory state is NOT trusted alone. Delivery marking ONLY after passing both guards.
 *
 * Output: returns array of messages safe to emit. Does NOT emit to sockets. Handlers decide how to emit.
 * 
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * DB ADAPTER OWNERSHIP (ALLOWED)
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 
 * This file is ALLOWED to import config/db.js because:
 * - It performs replay-specific DB operations (getUndeliveredMessages, updateMessageState, markMessageDelivered)
 * - It is part of the services/ layer (canonical replay path)
 * - Replay logic requires direct DB access for idempotency checks
 * 
 * See: docs/MIGRATION_CHECKLIST.md for DB ownership rules.
 */

const dbAdapter = require('../config/db');
const ErrorCodes = require('../utils/errorCodes');
const { logStateTransition, logger } = require('../utils/logger');
const metrics = require('../observability/metrics');
const userDiagnostics = require('../diagnostics/userDiagnosticsAggregator');
// MOVED IN PHASE 4 — OWNERSHIP ONLY: use canonical messageStore
const messageStore = require('../websocket/state/messageStore');
const { MessageState } = require('../models/message.state');
const deliveryService = require('./delivery.service');
const roomManager = require('../websocket/state/roomManager');
const roomDeliveryStore = require('../websocket/state/roomDeliveryStore');
// Lazy require to avoid circular dependency: message.store → replay.service → message.store
function getMessageStoreService() {
  if (!getMessageStoreService._cache) {
    getMessageStoreService._cache = require('./message.store');
  }
  return getMessageStoreService._cache;
}
// Lazy require to avoid cycle: message.store → replay.service → ws message.service → message.store
function getWsMessageService() {
  if (!getWsMessageService._cache) {
    getWsMessageService._cache = require('../websocket/services/message.service');
  }
  return getWsMessageService._cache;
}

const DEFAULT_REPLAY_LIMIT = 100;

/**
 * Replay undelivered messages for user after lastMessageId (EXCLUSIVE).
 * ONLY exported replay API: replayMessages(userId, lastMessageId).
 *
 * Semantics:
 * - userId: reconnecting user (recipient)
 * - lastMessageId: last message the CLIENT CONFIRMED receiving (exclusive)
 * - Only replay messages where messageId > lastMessageId (enforced by DB query)
 *
 * Idempotency (exact order): 1) DB delivery check → skip if already delivered. 2) Memory delivery check → skip.
 * Only if BOTH checks pass: mark DELIVERED in DB, update in-memory, add to output list.
 *
 * @param {string} userId - Reconnecting user
 * @param {string|null|undefined} lastMessageId - Last message client confirmed receiving (exclusive)
 * @param {number} [limit] - Max messages (optional; internal cap)
 * @param {Object} [context] - Context object with correlationId
 * @returns {Promise<{ type: string, messages?: Array<Object>, messageCount?: number, lastMessageId?: string, requestedAfter?: string|null, error?: string, code?: string }>}
 */
async function replayMessages(userId, lastMessageId, limit, context = {}) {
  try { metrics.increment('replay_count_total'); } catch (_) { /* no-op */ }
  try { if (userId) userDiagnostics.onActivity(userId); } catch (_) { /* no-op */ }
  const correlationId = context.correlationId || null;
  const effectiveLimit = limit || DEFAULT_REPLAY_LIMIT;

  if (!userId) {
    return {
      type: 'MESSAGE_ERROR',
      error: 'Not authenticated',
      code: ErrorCodes.AUTH_REQUIRED,
    };
  }

  if (lastMessageId) {
    let lastMsg;
    try {
      lastMsg = await dbAdapter.getMessage(lastMessageId);
    } catch (dbError) {
      return {
        type: 'MESSAGE_ERROR',
        error: 'Failed to validate lastMessageId',
        code: ErrorCodes.PERSISTENCE_ERROR,
        lastMessageId,
        details: dbError.message,
      };
    }
    if (!lastMsg) {
      return {
        type: 'MESSAGE_ERROR',
        error: 'Invalid lastMessageId: message not found in database',
        code: ErrorCodes.INVALID_LAST_MESSAGE_ID,
        lastMessageId,
      };
    }
  }

  // 1. Query DB: addressed to userId, messageId > lastMessageId, ORDERED BY messageId ASC (enforced by DB)
  let undeliveredMessages;
  try {
    undeliveredMessages = await dbAdapter.getUndeliveredMessages(
      userId,
      lastMessageId || null,
      effectiveLimit
    );
  } catch (dbError) {
    return {
      type: 'MESSAGE_ERROR',
      error: 'Failed to fetch undelivered messages',
      code: ErrorCodes.PERSISTENCE_ERROR,
      details: dbError.message,
    };
  }

  if (!undeliveredMessages || undeliveredMessages.length === 0) {
    logStateTransition({ userId, fromState: null, toState: 'REPLAY_END', reason: 'no_undelivered', lastMessageId });
    logger.info('replay', 'replay_end', {
      correlationId,
      userId,
      messageCount: 0,
      lastMessageId,
    });
    return {
      type: 'MESSAGE_REPLAY_COMPLETE',
      messages: [],
      messageCount: 0,
      lastMessageId: lastMessageId || null,
      requestedAfter: lastMessageId || null,
    };
  }

  logStateTransition({ userId, fromState: null, toState: 'REPLAY_START', reason: 'replay_messages', lastMessageId, count: undeliveredMessages.length });
  logger.info('replay', 'replay_start', {
    correlationId,
    userId,
    lastMessageId,
    messageCount: undeliveredMessages.length,
  });

  // Align with DB (read-only; no persist). DB query already filtered and ordered.
  const validMessages = [];
  for (const msg of undeliveredMessages) {
    let dbMessage;
    try {
      dbMessage = await dbAdapter.getMessage(msg.messageId);
    } catch {
      continue;
    }
    if (!dbMessage) continue;
    if (dbMessage.state !== msg.state) msg.state = dbMessage.state;
    validMessages.push(msg);
  }

  const messagesToEmit = [];
  let lastReplayedId = null;

  for (const msg of validMessages) {
    // ─── Replay compatibility: send only PERSISTED or SENT; ignore DELIVERED or READ ───
    if (!deliveryService.isPendingReplay(msg.messageId, userId)) {
      continue;
    }

    // ─── Idempotency check 1 (FIRST): DB delivery state ───
    // If already marked DELIVERED for (messageId, userId) in DB → SKIP immediately (crash-safe)
    let alreadyDeliveredInDb = false;
    try {
      alreadyDeliveredInDb = await dbAdapter.isMessageDelivered(msg.messageId, userId);
    } catch {
      alreadyDeliveredInDb = false;
    }
    if (alreadyDeliveredInDb) continue;

    // ─── Idempotency check 2 (SECOND): Memory delivery state ───
    // If already delivered in messageStore → SKIP (memory is NOT trusted alone; DB was checked first)
    const msgData = messageStore.getMessage(msg.messageId);
    const isDeliveredInMemory = msgData && (msgData.state === MessageState.DELIVERED || msgData.state === MessageState.READ);
    if (isDeliveredInMemory) continue;

    // ONLY after BOTH checks pass: mark in DB, then memory, then add to output (STEP 5)

    // Sync to memory (state only; no persist) before marking
    if (!messageStore.hasMessage(msg.messageId)) {
      messageStore.syncMessage(msg.messageId, {
        state: msg.state,
        senderId: msg.senderId,
        recipientId: msg.recipientId,
        content: msg.content,
        timestamp: msg.timestamp,
        messageType: msg.messageType,
        roomId: msg.roomId,
        roomMessageId: msg.roomMessageId,
        contentType: msg.contentType,
      });
    }

    // ONLY after passing both guards: mark DELIVERED in DB, update delivery state, update in-memory, add to output
    try {
      await dbAdapter.updateMessageState(msg.messageId, MessageState.DELIVERED);
      await dbAdapter.markMessageDelivered(msg.messageId, userId);
      deliveryService.transitionState(msg.messageId, userId, deliveryService.DeliveryState.DELIVERED);
    } catch (replayErr) {
      deliveryService.recordDeliveryFailure(msg.messageId, userId, 'REPLAY_FAILED');
      logger.warn('replay', 'replay_mark_delivered_error', { messageId: msg.messageId, userId, error: replayErr.message });
      continue;
    }
    const stored = messageStore.getMessage(msg.messageId);
    if (stored) {
      messageStore.syncMessage(msg.messageId, { ...stored, state: MessageState.DELIVERED });
    }

    const replayType = msg.messageType === 'room' ? 'ROOM_MESSAGE' : 'MESSAGE_RECEIVE';
    const payload = {
      type: replayType,
      messageId: msg.messageId,
      senderId: msg.senderId,
      content: msg.content,
      timestamp: msg.timestamp,
      state: MessageState.DELIVERED,
      isReplay: true,
      roomId: msg.roomId,
      roomMessageId: msg.roomMessageId,
    };
    if (replayType === 'MESSAGE_RECEIVE') payload.recipientId = msg.recipientId;
    messagesToEmit.push(payload);
    lastReplayedId = msg.messageId;

    // DM only: notify sender so ticks become double without refresh. Idempotent: we only reach
    // this block when we actually transitioned (alreadyDeliveredInDb and isDeliveredInMemory were false).
    if (replayType === 'MESSAGE_RECEIVE' && msg.senderId) {
      const senderUpdate = {
        type: 'MESSAGE_STATE_UPDATE',
        messageId: msg.messageId,
        state: MessageState.DELIVERED,
      };
      getWsMessageService().sendToAllUserSockets(msg.senderId, senderUpdate, { correlationId, messageId: msg.messageId });
    }

    // Room: record that this member received the message; if all others received, notify sender
    if (replayType === 'ROOM_MESSAGE' && msg.roomId && msg.roomMessageId && msg.senderId) {
      let members = [];
      try {
        members = roomManager.getRoomMembers(msg.roomId) || [];
      } catch (_) {}
      const totalRecipients = members.filter((m) => m !== msg.senderId).length;
      // Hydrate from DB when cache was lost (e.g. server restart)
      const entry = roomDeliveryStore.getEntry(msg.roomMessageId);
      if (!entry || entry.totalCount === 0) {
        try {
          const deliveredIds = await getMessageStoreService().getDeliveredRecipientIdsForRoomMessage(msg.roomMessageId);
          roomDeliveryStore.hydrate(msg.roomMessageId, msg.roomId, msg.senderId, deliveredIds, totalRecipients);
        } catch (hydrateErr) {
          logger.warn('replay', 'room_delivery_hydrate_failed', { roomMessageId: msg.roomMessageId, error: hydrateErr.message });
        }
      }
      const { complete, deliveredCount, totalCount } = roomDeliveryStore.recordDelivery(
        msg.roomMessageId,
        msg.roomId,
        msg.senderId,
        userId,
        totalRecipients
      );
      if (complete) {
        getWsMessageService().sendToAllUserSockets(msg.senderId, {
          type: 'ROOM_DELIVERY_UPDATE',
          roomId: msg.roomId,
          roomMessageId: msg.roomMessageId,
          deliveredCount,
          totalCount,
        }, { correlationId, messageId: msg.roomMessageId });
      }
    }
  }

  logStateTransition({ userId, fromState: 'REPLAY_START', toState: 'REPLAY_END', reason: 'replay_complete', messageCount: messagesToEmit.length, lastMessageId: lastReplayedId });
  logger.info('replay', 'replay_end', {
    correlationId,
    userId,
    messageCount: messagesToEmit.length,
    lastMessageId: lastReplayedId,
  });

  return {
    type: 'MESSAGE_REPLAY_COMPLETE',
    messages: messagesToEmit,
    messageCount: messagesToEmit.length,
    lastMessageId: lastReplayedId || lastMessageId,
    requestedAfter: lastMessageId || null,
  };
}

/**
 * Get undelivered count (read-only). Replay logic — ONLY place for undelivered queries.
 */
async function getUndeliveredCount(userId, lastMessageId) {
  if (!userId) return { count: 0, hasMore: false };
  try {
    const messages = await dbAdapter.getUndeliveredMessages(userId, lastMessageId || null, 1);
    return { count: messages.length, hasMore: messages.length > 0 };
  } catch {
    return { count: 0, hasMore: false };
  }
}

/**
 * Get undelivered messages (read-only). ONLY place for undelivered fetch.
 */
async function getUndeliveredMessages(userId, afterMessageId = null, limit = 100) {
  if (!userId) return [];
  try {
    return await dbAdapter.getUndeliveredMessages(userId, afterMessageId || null, limit || 100);
  } catch {
    return [];
  }
}

module.exports = {
  replayMessages,
  getUndeliveredCount,
  getUndeliveredMessages,
};
