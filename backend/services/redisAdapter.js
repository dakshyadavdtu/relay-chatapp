'use strict';

/**
 * Redis Adapter - Real Implementation
 * 
 * Provides Redis pub/sub functionality for cross-instance messaging.
 * Uses separate publisher and subscriber connections for optimal performance.
 * 
 * Usage:
 * - initialize(): Connect to Redis (supports REDIS_URL or REDIS_HOST/PORT/PASSWORD)
 * - publish(): Publish messages to channels
 * - subscribe(): Register handlers for channel messages
 * - unsubscribe(): Remove handlers from channels
 * - close(): Gracefully close all connections
 */

const { createClient } = require('redis');
const logger = require('../utils/logger');
const crypto = require('crypto');

// Internal state
let pubClient = null;
let subClient = null;
let connectedReadyPub = false;
let connectedReadySub = false;
let subscribedChannels = new Map(); // Map<channel, { handlers: Set<Function>, subscribed: boolean, listener?: Function }>
let instanceId = null;

// Logging throttle: only log reconnect events max once per 5 seconds
let lastReconnectLogTime = 0;
const RECONNECT_LOG_THROTTLE_MS = 5000;

/**
 * Generate or retrieve instance ID
 * Uses HOSTNAME, POD_NAME, or generates a random ID
 * @returns {string}
 */
function getInstanceId() {
  if (instanceId) {
    return instanceId;
  }
  
  // Prefer environment-provided instance identifiers
  instanceId = process.env.INSTANCE_ID || 
               process.env.HOSTNAME || 
               process.env.POD_NAME || 
               `instance-${crypto.randomBytes(4).toString('hex')}`;
  
  return instanceId;
}

/**
 * Build Redis client configuration from environment variables
 * Supports REDIS_URL (preferred) or REDIS_HOST/PORT/PASSWORD
 * @returns {Object} Redis client configuration
 */
function buildRedisConfig() {
  // Prefer REDIS_URL if provided
  if (process.env.REDIS_URL) {
    return {
      url: process.env.REDIS_URL,
    };
  }
  
  // Fallback to individual components
  const config = {
    socket: {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
    },
  };
  
  // Add password if provided
  if (process.env.REDIS_PASSWORD) {
    config.password = process.env.REDIS_PASSWORD;
  }
  
  // TLS is automatically handled if REDIS_URL uses rediss://
  return config;
}

/**
 * Setup client event listeners with throttled reconnect logging
 * @param {Object} client - Redis client
 * @param {string} type - 'pub' or 'sub'
 */
function setupClientListeners(client, type) {
  client.on('error', (err) => {
    logger.error('Redis', `${type}_client_error`, {
      type,
      error: err.message,
      code: err.code,
    });
  });
  
  client.on('ready', () => {
    if (type === 'pub') {
      connectedReadyPub = true;
    } else {
      connectedReadySub = true;
    }
    logger.info('Redis', `${type}_client_ready`, { type });
  });
  
  client.on('reconnecting', () => {
    const now = Date.now();
    if (now - lastReconnectLogTime > RECONNECT_LOG_THROTTLE_MS) {
      lastReconnectLogTime = now;
      logger.warn('Redis', `${type}_client_reconnecting`, { type });
    }
  });
  
  client.on('end', () => {
    if (type === 'pub') {
      connectedReadyPub = false;
    } else {
      connectedReadySub = false;
    }
    logger.info('Redis', `${type}_client_end`, { type });
  });
}

/**
 * Initialize Redis connections
 * Creates separate publisher and subscriber clients
 * @param {Object} [config] - Optional config
 * @param {Function} [config.createClientOverride] - For tests: (redisConfig) => client. If provided, used instead of require('redis').createClient; both pub and sub are created by calling it twice.
 * @returns {Promise<void>}
 */
async function initialize(config = {}) {
  // If already initialized, skip
  if (pubClient && subClient) {
    logger.warn('Redis', 'already_initialized', {});
    return;
  }
  
  const createClientFn = typeof config.createClientOverride === 'function'
    ? config.createClientOverride
    : createClient;

  try {
    const redisConfig = buildRedisConfig();
    
    // Create publisher client
    pubClient = createClientFn(redisConfig);
    if (!config.createClientOverride) {
      setupClientListeners(pubClient, 'pub');
    }
    
    // Create subscriber client
    subClient = createClientFn(redisConfig);
    if (!config.createClientOverride) {
      setupClientListeners(subClient, 'sub');
    }
    
    // Connect both clients (required before subscribe in v4)
    await Promise.all([
      pubClient.connect(),
      subClient.connect(),
    ]);

    if (config.createClientOverride) {
      connectedReadyPub = true;
      connectedReadySub = true;
    }

    logger.info('Redis', 'initialized', {
      instanceId: getInstanceId(),
      pubReady: connectedReadyPub,
      subReady: connectedReadySub,
    });
  } catch (err) {
    logger.error('Redis', 'initialize_failed', {
      error: err.message,
      code: err.code,
    });
    // Don't throw - let caller decide behavior
    // Clean up partial state
    if (pubClient) {
      try {
        await pubClient.quit().catch(() => {});
      } catch {}
      pubClient = null;
    }
    if (subClient) {
      try {
        await subClient.quit().catch(() => {});
      } catch {}
      subClient = null;
    }
    connectedReadyPub = false;
    connectedReadySub = false;
  }
}

/** Max allowed Redis message size (bytes). Drop oversized to prevent CPU/memory spikes. */
const MAX_REDIS_MESSAGE_BYTES = 64 * 1024;

/**
 * Dispatch a raw message to handlers for a channel (node-redis v4 callback style).
 * Safe: size check then parse; parse failure logs channel + length only; each handler wrapped in try/catch.
 * @param {string} channel - Channel name
 * @param {string} raw - Raw message string from Redis
 */
function safeDispatch(channel, raw) {
  const channelData = subscribedChannels.get(channel);
  if (!channelData || channelData.handlers.size === 0) {
    return;
  }
  const rawLength = typeof raw === 'string' ? raw.length : (Buffer.isBuffer(raw) ? raw.length : 0);
  if (rawLength > MAX_REDIS_MESSAGE_BYTES) {
    logger.warn('Redis', 'message_too_large', { channel, rawLength, max: MAX_REDIS_MESSAGE_BYTES });
    return;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    logger.warn('Redis', 'parse_error', {
      channel,
      rawLength,
    });
    return;
  }
  for (const handler of channelData.handlers) {
    try {
      handler(parsed);
    } catch (handlerErr) {
      logger.error('Redis', 'handler_error', {
        channel,
        error: handlerErr.message,
        stack: handlerErr.stack,
      });
    }
  }
}

/**
 * Publish a message to a channel
 * @param {string} channel - Channel name
 * @param {Object} message - Message object to publish
 * @returns {Promise<boolean>} true if published, false if not ready
 */
async function publish(channel, message) {
  if (!pubClient || !connectedReadyPub) {
    logger.warn('Redis', 'publish_not_ready', {
      channel,
      ready: connectedReadyPub,
    });
    return false;
  }
  
  try {
    const messageStr = JSON.stringify(message);
    await pubClient.publish(channel, messageStr);
    return true;
  } catch (err) {
    logger.error('Redis', 'publish_error', {
      channel,
      error: err.message,
    });
    return false;
  }
}

/**
 * Subscribe to a channel
 * Registers a handler and subscribes if this is the first handler for the channel
 * @param {string} channel - Channel name
 * @param {Function} handler - Message handler function
 * @returns {Promise<void>}
 */
async function subscribe(channel, handler) {
  if (!subClient || !connectedReadySub) {
    logger.warn('Redis', 'subscribe_not_ready', {
      channel,
      ready: connectedReadySub,
    });
    return;
  }
  
  if (typeof handler !== 'function') {
    throw new Error('subscribe: handler must be a function');
  }
  
  let channelData = subscribedChannels.get(channel);
  
  if (!channelData) {
    channelData = {
      handlers: new Set(),
      subscribed: false,
    };
    subscribedChannels.set(channel, channelData);
  }

  if (channelData.subscribed) return;

  // Add handler
  channelData.handlers.add(handler);
  
  // Subscribe if first handler (node-redis v4: pass listener as second arg)
  if (!channelData.subscribed) {
    const listener = (rawMessage, ch) => {
      safeDispatch(ch || channel, rawMessage);
    };
    channelData.listener = listener;
    try {
      await subClient.subscribe(channel, listener);
      channelData.subscribed = true;
      logger.info('Redis', 'channel_subscribed', { channel });
    } catch (err) {
      channelData.listener = undefined;
      logger.error('Redis', 'subscribe_error', {
        channel,
        error: err.message,
      });
      // Remove handler on failure
      channelData.handlers.delete(handler);
      if (channelData.handlers.size === 0) {
        subscribedChannels.delete(channel);
      }
    }
  }
}

/**
 * Unsubscribe from a channel
 * Removes all handlers and unsubscribes if no handlers remain
 * @param {string} channel - Channel name
 * @returns {Promise<void>}
 */
async function unsubscribe(channel) {
  const channelData = subscribedChannels.get(channel);
  if (!channelData) {
    return;
  }
  
  // Clear all handlers
  channelData.handlers.clear();
  
  // Unsubscribe if was subscribed
  if (channelData.subscribed && subClient && connectedReadySub) {
    try {
      await subClient.unsubscribe(channel);
      logger.info('Redis', 'channel_unsubscribed', { channel });
    } catch (err) {
      logger.error('Redis', 'unsubscribe_error', {
        channel,
        error: err.message,
      });
    }
  }

  subscribedChannels.delete(channel);
}

/**
 * Close Redis connections
 * Gracefully unsubscribes from all channels and closes both clients
 * @returns {Promise<void>}
 */
async function close() {
  // Unsubscribe from all channels
  const channels = Array.from(subscribedChannels.keys());
  for (const channel of channels) {
    await unsubscribe(channel).catch(() => {});
  }
  
  // Close both clients
  const closePromises = [];
  
  if (pubClient) {
    closePromises.push(
      pubClient.quit().catch(() => {
        // Fallback to disconnect if quit fails
        return pubClient.disconnect().catch(() => {});
      })
    );
  }
  
  if (subClient) {
    closePromises.push(
      subClient.quit().catch(() => {
        // Fallback to disconnect if quit fails
        return subClient.disconnect().catch(() => {});
      })
    );
  }
  
  await Promise.all(closePromises);
  
  // Clear state
  pubClient = null;
  subClient = null;
  connectedReadyPub = false;
  connectedReadySub = false;
  subscribedChannels.clear();
  
  logger.info('Redis', 'closed', {});
}

/**
 * Check if Redis is connected
 * @returns {boolean} true if both clients are ready
 */
function isConnected() {
  return connectedReadyPub && connectedReadySub;
}

/**
 * Reset internal state (for tests only). Does not call close().
 */
function resetForTest() {
  pubClient = null;
  subClient = null;
  connectedReadyPub = false;
  connectedReadySub = false;
  subscribedChannels.clear();
}

module.exports = {
  publish,
  subscribe,
  unsubscribe,
  initialize,
  close,
  isConnected,
  getInstanceId,
  resetForTest,
};
