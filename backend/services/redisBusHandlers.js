'use strict';

/**
 * Redis bus subscriber handlers for chat.message and admin.kick.
 * Depends on connectionManager and wsMessageService; used only by server.js to avoid circular deps.
 * Log only messageId, recipientId, originInstanceId — never content.
 */

const config = require('../config/constants');
const connectionManager = require('../websocket/connection/connectionManager');
const wsMessageService = require('../websocket/services/message.service');
const logger = require('../utils/logger');

const ADMIN_KICK_ACTIONS = new Set(['BAN', 'REVOKE_ALL', 'REVOKE_ONE']);
const OPEN = 1; // WebSocket.OPEN

/** Dedupe TTL seconds (env REDIS_DEDUPE_TTL_SECONDS, default 120). */
const DEDUPE_TTL_SECONDS = Math.max(1, parseInt(process.env.REDIS_DEDUPE_TTL_SECONDS || '120', 10));
const DEDUPE_TTL_MS = DEDUPE_TTL_SECONDS * 1000;

/** Max dedupe entries (env REDIS_DEDUPE_MAX_ENTRIES, default 5000). */
const DEDUPE_MAX_SIZE = Math.max(100, parseInt(process.env.REDIS_DEDUPE_MAX_ENTRIES || '5000', 10));

function isNonEmptyString(x) {
  return typeof x === 'string' && x.length > 0;
}

function isObject(x) {
  return x != null && typeof x === 'object' && !Array.isArray(x);
}

/**
 * Prune a dedupe map: remove expired entries, then evict oldest-by-expiry until size <= maxSize.
 * Key = messageId; value = expiresAt (ms).
 * @param {Map<string, number>} map - Map to prune (messageId -> expiresAt)
 * @param {number} ttlMs - TTL used for new entries (for reference only; expiry is stored per key)
 * @param {number} maxSize - Max entries after prune
 */
function pruneDedupeMap(map, ttlMs, maxSize) {
  const now = Date.now();
  for (const [key, expiresAt] of map.entries()) {
    if (expiresAt <= now) map.delete(key);
  }
  while (map.size > maxSize) {
    let oldestKey = null;
    let oldestExp = Infinity;
    for (const [key, exp] of map.entries()) {
      if (exp < oldestExp) {
        oldestExp = exp;
        oldestKey = key;
      }
    }
    if (oldestKey != null) map.delete(oldestKey);
    else break;
  }
}

/** Module-level dedupe map: messageId -> expiresAt (ms). Best-effort in-memory only. */
const dedupeMap = new Map();

function isDuplicate(messageId) {
  const now = Date.now();
  const expiresAt = dedupeMap.get(messageId);
  if (expiresAt != null && expiresAt > now) return true;
  return false;
}

function addToDedupe(messageId) {
  pruneDedupeMap(dedupeMap, DEDUPE_TTL_MS, DEDUPE_MAX_SIZE);
  dedupeMap.set(messageId, Date.now() + DEDUPE_TTL_MS);
}

/**
 * Create a simple in-memory dedupe implementation for tests or runtime.
 * Uses same TTL and MAX as module-level; each instance has its own map.
 * @returns {{ isDuplicate: (msgId: string) => boolean, add: (msgId: string) => void, clear: () => void }}
 */
function createDedupe() {
  const map = new Map();
  return {
    isDuplicate(messageId) {
      const now = Date.now();
      const expiresAt = map.get(messageId);
      if (expiresAt != null && expiresAt > now) return true;
      return false;
    },
    add(messageId) {
      pruneDedupeMap(map, DEDUPE_TTL_MS, DEDUPE_MAX_SIZE);
      map.set(messageId, Date.now() + DEDUPE_TTL_MS);
    },
    clear() {
      map.clear();
    },
  };
}

/**
 * Strict validation for chat.message event.
 * Requires originInstanceId, messageId, recipientId (non-empty strings) and receivePayload
 * with type === 'MESSAGE_RECEIVE' and messageId/senderId/recipientId/content/timestamp/state (content string; timestamp number; state string).
 */
function validateChatMessageEvent(ev) {
  if (!isObject(ev)) return false;
  if (!isNonEmptyString(ev.originInstanceId) || !isNonEmptyString(ev.messageId) || !isNonEmptyString(ev.recipientId)) return false;
  const p = ev.receivePayload;
  if (!isObject(p)) return false;
  if (p.type !== 'MESSAGE_RECEIVE') return false;
  if (typeof p.messageId !== 'string' || typeof p.senderId !== 'string' || typeof p.recipientId !== 'string') return false;
  if (typeof p.content !== 'string') return false;
  if (typeof p.timestamp !== 'number') return false;
  if (typeof p.state !== 'string') return false;
  return true;
}

/**
 * Create onChatMessage handler for Redis bus (testable via DI).
 * @param {Object} deps - Dependencies
 * @param {string} deps.instanceId - This instance's ID (to ignore self-origin)
 * @param {Object} [deps.connectionManager] - connectionManager (default: real)
 * @param {Object} [deps.wsMessageService] - wsMessageService (default: real)
 * @param {Object} [deps.logger] - logger (default: real)
 * @param {Object} [deps.dedupe] - dedupe impl { isDuplicate(msgId), add(msgId) } (default: module-level)
 * @returns {Function} Handler(parsedEvent)
 */
function createOnChatMessage(deps) {
  const instanceId = deps.instanceId;
  const cm = deps.connectionManager || connectionManager;
  const wsMsg = deps.wsMessageService || wsMessageService;
  const log = deps.logger || logger;
  const dedupe = deps.dedupe || { isDuplicate, add: addToDedupe };

  return async function onChatMessage(parsedEvent) {
    try {
      if (!validateChatMessageEvent(parsedEvent)) {
        log.warn('RedisBusHandler', 'chat_message_invalid', {
          messageId: parsedEvent?.messageId ?? null,
          recipientId: parsedEvent?.recipientId ?? null,
          originInstanceId: parsedEvent?.originInstanceId ?? null,
        });
        return;
      }
      if (parsedEvent.roomId != null || parsedEvent.groupId != null || parsedEvent.roomChatId != null) {
        log.warn('RedisBusHandler', 'chat_message_room_shaped_ignored', {
          messageId: parsedEvent?.messageId ?? null,
          originInstanceId: parsedEvent?.originInstanceId ?? null,
        });
        return;
      }
      const { originInstanceId, messageId, recipientId, receivePayload } = parsedEvent;

      if (originInstanceId === instanceId) {
        log.info('RedisBusHandler', 'chat_message_self_origin_ignored', {
          messageId,
          recipientId,
          originInstanceId,
        });
        return;
      }

      if (dedupe.isDuplicate(messageId)) {
        log.info('RedisBusHandler', 'chat_message_dedupe_ignored', {
          messageId,
          recipientId,
          originInstanceId,
        });
        return;
      }
      dedupe.add(messageId);

      const sockets = cm.getSockets(recipientId);
      if (sockets.length === 0) return;

      const delivered = await wsMsg.attemptDelivery(messageId, receivePayload, {
        correlationId: 'redis:' + messageId,
      });
      if (delivered) {
        const senderId = receivePayload.senderId;
        if (senderId) {
          wsMsg.sendToUserSocket(senderId, {
            type: 'DELIVERY_STATUS',
            messageId,
            recipientId,
            status: 'DELIVERED',
            ts: Date.now(),
          }, { correlationId: 'redis:' + messageId, messageId });
        }
      }
      log.info('RedisBusHandler', 'chat_message_delivered', {
        messageId,
        recipientId,
        originInstanceId,
      });
    } catch (err) {
      log.error('RedisBusHandler', 'chat_message_delivery_error', {
        messageId: parsedEvent?.messageId ?? null,
        recipientId: parsedEvent?.recipientId ?? null,
        originInstanceId: parsedEvent?.originInstanceId ?? null,
        error: err.message,
      });
    }
  };
}

/**
 * Strict validation for admin.kick event.
 * Requires originInstanceId, targetUserId (strings), action in BAN/REVOKE_ALL/REVOKE_ONE, ts number.
 * If action === REVOKE_ONE, targetSessionId must be non-empty string.
 */
function validateAdminKickEvent(ev) {
  if (!isObject(ev)) return false;
  if (!isNonEmptyString(ev.originInstanceId) || !isNonEmptyString(ev.targetUserId)) return false;
  if (!ADMIN_KICK_ACTIONS.has(ev.action)) return false;
  if (typeof ev.ts !== 'number') return false;
  if (ev.action === 'REVOKE_ONE' && !isNonEmptyString(ev.targetSessionId)) return false;
  return true;
}

/**
 * Create onAdminKick handler for Redis bus (testable via DI).
 * @param {Object} deps - Dependencies
 * @param {string} deps.instanceId - This instance's ID (to ignore self-origin)
 * @param {Object} [deps.connectionManager] - connectionManager (default: real)
 * @param {Object} [deps.config] - config with PROTOCOL_VERSION (default: real)
 * @param {Object} [deps.logger] - logger (default: real)
 * @returns {Function} Handler(parsedEvent)
 */
function createOnAdminKick(deps) {
  const instanceId = deps.instanceId;
  const cm = deps.connectionManager || connectionManager;
  const cfg = deps.config || config;
  const log = deps.logger || logger;

  return function onAdminKick(parsedEvent) {
    try {
      if (!validateAdminKickEvent(parsedEvent)) {
        log.warn('RedisBusHandler', 'admin_kick_invalid', {
          action: parsedEvent?.action,
          targetUserId: parsedEvent?.targetUserId,
          originInstanceId: parsedEvent?.originInstanceId,
        });
        return;
      }
      const { originInstanceId, action, targetUserId, targetSessionId } = parsedEvent;

      if (originInstanceId === instanceId) {
        log.info('RedisBusHandler', 'admin_kick_self_origin_ignored', {
          action,
          targetUserId,
          originInstanceId,
        });
        return;
      }

      switch (action) {
        case 'BAN': {
          // Parity with admin.controller.js banUser: same suspendPayload, close 4003, then remove
          const sockets = cm.getSockets(targetUserId);
          const suspendPayload = {
            type: 'ERROR',
            code: 'ACCOUNT_SUSPENDED',
            message: 'Account suspended',
            version: cfg.PROTOCOL_VERSION,
          };
          for (const ws of sockets) {
            try {
              if (ws.readyState === OPEN) {
                ws.send(JSON.stringify(suspendPayload));
              }
            } catch (_) { /* ignore send errors */ }
            try {
              if (ws.readyState === OPEN) ws.close(4003, 'ACCOUNT_SUSPENDED');
            } catch (_) { /* ignore close errors */ }
          }
          try {
            cm.remove(targetUserId);
          } catch (_) { /* ignore if no session */ }
          log.info('RedisBusHandler', 'admin_kick_ban_applied', { targetUserId, originInstanceId });
          break;
        }
        case 'REVOKE_ALL':
          try {
            cm.remove(targetUserId);
          } catch (_) { /* ignore */ }
          log.info('RedisBusHandler', 'admin_kick_revoke_all_applied', { targetUserId, originInstanceId });
          break;
        case 'REVOKE_ONE':
          if (targetSessionId) {
            try {
              cm.removeSession(targetSessionId);
            } catch (_) { /* ignore */ }
            log.info('RedisBusHandler', 'admin_kick_revoke_one_applied', { targetUserId, targetSessionId, originInstanceId });
          }
          break;
        default:
          log.warn('RedisBusHandler', 'admin_kick_unknown_action', { action, targetUserId, originInstanceId });
      }
    } catch (err) {
      log.error('RedisBusHandler', 'admin_kick_error', {
        action: parsedEvent?.action,
        targetUserId: parsedEvent?.targetUserId,
        originInstanceId: parsedEvent?.originInstanceId,
        error: err.message,
      });
    }
  };
}

module.exports = {
  createOnChatMessage,
  createOnAdminKick,
  createDedupe,
};
