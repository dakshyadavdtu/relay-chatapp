'use strict';

/**
 * Redis Bus - Lifecycle and channel wiring.
 * Depends only on redisAdapter and injected callbacks.
 * No dependency on websocket or wsCore (avoids circular deps).
 */

const logger = require('../utils/logger');

let _adapter = require('./redisAdapter');
function getAdapter() {
  return _adapter;
}

const CHAT_MESSAGE_CHANNEL = 'chat.message';
const ADMIN_KICK_CHANNEL = 'admin.kick';

/** Max wait for Redis to connect before treating as unavailable (avoids hang when Redis is down). */
const INIT_TIMEOUT_MS = 5000;

let busDisabled = false;
let started = false;

/**
 * Start Redis bus: connect and subscribe to chat.message and admin.kick.
 * If Redis unavailable: production => throw (fail boot); else => log warn, bus disabled.
 * @param {Object} [opts] - Options
 * @param {string} [opts.instanceId] - Optional instance id override
 * @param {Function} [opts.onChatMessage] - Callback for chat.message events
 * @param {Function} [opts.onAdminKick] - Callback for admin.kick events
 */
async function startRedisBus(opts = {}) {
  if (started) {
    logger.warn('RedisBus', 'already_started', {});
    return;
  }

  const onChatMessage = typeof opts.onChatMessage === 'function' ? opts.onChatMessage : () => {};
  const onAdminKick = typeof opts.onAdminKick === 'function' ? opts.onAdminKick : () => {};

  const initPromise = getAdapter().initialize();
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Redis connection timeout')), INIT_TIMEOUT_MS)
  );
  try {
    await Promise.race([initPromise, timeoutPromise]);
  } catch (err) {
    if (err.message === 'Redis connection timeout') {
      logger.warn('RedisBus', 'init_timeout', { timeoutMs: INIT_TIMEOUT_MS });
      try {
        await Promise.race([
          getAdapter().close(),
          new Promise((resolve) => setTimeout(resolve, 1500)),
        ]);
      } catch (_) {}
    }
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Redis bus required in production but connection failed or timed out');
    }
    logger.warn('RedisBus', 'bus_disabled', {
      reason: 'Redis unavailable or timeout',
      NODE_ENV: process.env.NODE_ENV,
    });
    busDisabled = true;
    started = true;
    return;
  }

  if (!getAdapter().isConnected()) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Redis bus required in production but connection failed');
    }
    logger.warn('RedisBus', 'bus_disabled', {
      reason: 'Redis unavailable',
      NODE_ENV: process.env.NODE_ENV,
    });
    busDisabled = true;
    started = true;
    return;
  }

  busDisabled = false;

  await getAdapter().subscribe(CHAT_MESSAGE_CHANNEL, (parsedEvent) => {
    try {
      onChatMessage(parsedEvent);
    } catch (err) {
      logger.error('RedisBus', 'onChatMessage_error', { error: err.message });
    }
  });
  await getAdapter().subscribe(ADMIN_KICK_CHANNEL, (parsedEvent) => {
    try {
      onAdminKick(parsedEvent);
    } catch (err) {
      logger.error('RedisBus', 'onAdminKick_error', { error: err.message });
    }
  });

  started = true;
  logger.info('RedisBus', 'started', {
    instanceId: getAdapter().getInstanceId(),
    channels: [CHAT_MESSAGE_CHANNEL, ADMIN_KICK_CHANNEL],
  });
}

/**
 * Stop Redis bus. Best-effort; must not throw during shutdown.
 */
async function stopRedisBus() {
  if (!started) return;
  try {
    await getAdapter().close();
    logger.info('RedisBus', 'stopped', {});
  } catch (err) {
    logger.warn('RedisBus', 'stop_error', { error: err.message });
  }
  started = false;
  busDisabled = false;
}

/** Required keys for chat.message event. */
const CHAT_MESSAGE_REQUIRED_KEYS = ['type', 'originInstanceId', 'messageId', 'recipientId', 'senderId', 'ts', 'receivePayload'];

function validateChatMessageEvent(event) {
  if (!event || typeof event !== 'object') return false;
  for (const key of CHAT_MESSAGE_REQUIRED_KEYS) {
    if (!(key in event)) return false;
  }
  if (event.type !== 'chat.message') return false;
  if (typeof event.originInstanceId !== 'string' || typeof event.messageId !== 'string') return false;
  if (typeof event.recipientId !== 'string' || typeof event.senderId !== 'string') return false;
  if (typeof event.ts !== 'number') return false;
  if (!event.receivePayload || typeof event.receivePayload !== 'object') return false;
  return true;
}

/**
 * Publish chat.message event to Redis for cross-instance fanout.
 * @param {Object} event - { type, originInstanceId, messageId, recipientId, senderId, ts, receivePayload }
 * @returns {Promise<boolean>} true if published, false if bus disabled, not connected, invalid, or publish failed
 */
async function publishChatMessage(event) {
  if (busDisabled || !getAdapter().isConnected()) return false;
  if (!validateChatMessageEvent(event)) {
    logger.warn('RedisBus', 'publish_chat_message_invalid', {
      messageId: event?.messageId,
      recipientId: event?.recipientId,
      originInstanceId: event?.originInstanceId,
    });
    return false;
  }
  const published = await getAdapter().publish(CHAT_MESSAGE_CHANNEL, event);
  if (published) {
    logger.info('RedisBus', 'chat_message_published', {
      messageId: event.messageId,
      recipientId: event.recipientId,
      originInstanceId: event.originInstanceId,
    });
  }
  return published;
}

const ADMIN_KICK_ACTIONS = new Set(['BAN', 'REVOKE_ALL', 'REVOKE_ONE']);

function validateAdminKickEvent(event) {
  if (!event || typeof event !== 'object') return false;
  if (event.type !== 'admin.kick') return false;
  if (typeof event.originInstanceId !== 'string' || typeof event.targetUserId !== 'string') return false;
  if (!ADMIN_KICK_ACTIONS.has(event.action)) return false;
  if (typeof event.ts !== 'number') return false;
  if (event.action === 'REVOKE_ONE' && (event.targetSessionId == null || typeof event.targetSessionId !== 'string')) return false;
  return true;
}

/**
 * Publish admin.kick event to Redis for cross-instance kick propagation.
 * @param {Object} event - { type, originInstanceId, action, targetUserId, targetSessionId?, ts }
 * @returns {Promise<boolean>} true if published
 */
async function publishAdminKick(event) {
  if (busDisabled || !getAdapter().isConnected()) return false;
  if (!validateAdminKickEvent(event)) {
    logger.warn('RedisBus', 'publish_admin_kick_invalid', {
      action: event?.action,
      targetUserId: event?.targetUserId,
      originInstanceId: event?.originInstanceId,
    });
    return false;
  }
  const published = await getAdapter().publish(ADMIN_KICK_CHANNEL, event);
  if (published) {
    logger.info('RedisBus', 'admin_kick_published', {
      action: event.action,
      targetUserId: event.targetUserId,
      originInstanceId: event.originInstanceId,
    });
  }
  return published;
}

/**
 * @returns {string} Instance ID from adapter
 */
function getInstanceId() {
  return getAdapter().getInstanceId();
}

const __testables = {
  setAdapter(adapter) {
    _adapter = adapter;
  },
  resetAdapter() {
    _adapter = require('./redisAdapter');
  },
};

module.exports = {
  startRedisBus,
  stopRedisBus,
  publishChatMessage,
  publishAdminKick,
  getInstanceId,
  __testables,
};
