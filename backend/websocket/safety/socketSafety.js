'use strict';

/**
 * Tier-1: Deterministic message result enum.
 * rate limit -> FAIL, payload overflow -> DROP, queue overflow -> FAIL
 */
const MESSAGE_RESULT = {
  OK: 'OK',
  FAILED: 'FAILED',
  DROPPED: 'DROPPED',
};

/** Policy for safety gate: DROP = ignore (no response), FAIL = return error, ALLOW = proceed */
const SAFETY_POLICY = { DROP: 'DROP', FAIL: 'FAIL', ALLOW: 'ALLOW' };

/**
 * Socket Safety Module
 * 
 * Provides per-socket safety mechanisms:
 * - Rate limiting (message count per time window)
 * - Payload size validation
 * - Lightweight backpressure handling
 * - Abusive connection detection and handling
 * 
 * No external dependencies - uses only Node.js built-ins
 */

const config = require('../../config/constants');
const ErrorCodes = require('../../utils/errorCodes');
const logger = require('../../utils/logger');
const connectionManager = require('../connection/connectionManager');
const metrics = require('../../observability/metrics');
const rateLimitStore = require('../state/rateLimitStore');
const socketStateStore = require('../state/socketStateStore');
const suspiciousDetector = require('../../suspicious/suspicious.detector');
// MOVED IN PHASE 5 — NO LOGIC CHANGE: backpressure and flow control centralized
const backpressure = require('./backpressure');
const flowControl = require('./flowControl');

/** Incoming send-rate limit: MESSAGE_SEND / ROOM_MESSAGE only; no disconnect on exceed. */
// Relaxed to reduce inadvertent throttling during normal typing/chat
const MAX_SEND_RATE = 60;
const SEND_RATE_WINDOW_MS = 5000;

/** Message types that are rate-limited more strictly (create/delete/promote/remove). */
const SENSITIVE_ROOM_ACTION_TYPES = new Set([
  'ROOM_CREATE',
  'ROOM_DELETE',
  'ROOM_SET_ROLE',
  'ROOM_REMOVE_MEMBER',
  'ROOM_ADD_MEMBERS',
]);

/**
 * PHASE 3: Message types that do NOT count toward generic WS rate limit.
 * Frequent protocol/sync/ack traffic so innocent users don't hit limit.
 * Send limiter still applies to MESSAGE_SEND/ROOM_MESSAGE; sensitive limiter to room admin ops.
 */
const NOISE_TYPES = new Set([
  'PING',
  'CLIENT_ACK',
  'MESSAGE_DELIVERED_CONFIRM',
  'MESSAGE_READ_CONFIRM',
  'MESSAGE_READ',
  'PRESENCE_PING',
  'RESUME',
  'STATE_SYNC',
  'MESSAGE_REPLAY',
]);



/**
 * Message schema definitions for validation
 * Each schema defines required fields and their expected types
 */
const MESSAGE_SCHEMAS = {
  MESSAGE_SEND: {
    required: ['recipientId', 'content'],
    types: {
      recipientId: 'string',
      content: 'string',
      clientMessageId: 'string',
    },
    enums: {},
  },
  MESSAGE_READ: {
    required: ['messageId'],
    types: {
      messageId: 'string',
    },
    enums: {},
  },
  MESSAGE_READ_CONFIRM: {
    required: ['messageId'],
    types: {
      messageId: 'string',
    },
    enums: {},
  },
  MESSAGE_DELIVERED_CONFIRM: {
    required: ['messageId'],
    types: {
      messageId: 'string',
    },
    enums: {},
  },
  MESSAGE_EDIT: {
    required: ['messageId', 'content'],
    types: {
      messageId: 'string',
      content: 'string',
    },
    enums: {},
  },
  MESSAGE_DELETE: {
    required: ['messageId'],
    types: {
      messageId: 'string',
    },
    enums: {},
  },
  MESSAGE_REPLAY: {
    required: [],
    types: {
      lastMessageId: 'string',
      limit: 'number',
    },
    enums: {},
  },
  STATE_SYNC: {
    required: [],
    types: {
      lastMessageId: 'string',
      lastReadMessageId: 'string',
    },
    enums: {},
  },
  PRESENCE_PING: {
    required: [],
    types: {
      status: 'string',
    },
    enums: {
      status: ['online', 'away', 'busy', 'offline'],
    },
  },
  CLIENT_ACK: {
    required: ['messageId'],
    types: {
      messageId: 'string',
      ackType: 'string',
    },
    enums: {
      ackType: ['delivered', 'read'],
    },
  },
  PING: {
    required: [],
    types: {},
    enums: {},
  },
  // Room message schemas
  ROOM_CREATE: {
    required: [],
    types: {
      roomId: 'string',
      name: 'string',
      memberIds: 'object',
      metadata: 'object',
    },
    enums: {},
  },
  ROOM_JOIN: {
    required: ['roomId'],
    types: {
      roomId: 'string',
    },
    enums: {},
  },
  ROOM_LEAVE: {
    required: ['roomId'],
    types: {
      roomId: 'string',
    },
    enums: {},
  },
  ROOM_MESSAGE: {
    required: ['roomId', 'content'],
    types: {
      roomId: 'string',
      content: 'string',
      clientMessageId: 'string',
      messageType: 'string',
    },
    enums: {},
  },
  ROOM_INFO: {
    required: ['roomId'],
    types: {
      roomId: 'string',
    },
    enums: {},
  },
  ROOM_LIST: {
    required: [],
    types: {
      includeAll: 'boolean',
    },
    enums: {},
  },
  ROOM_MEMBERS: {
    required: ['roomId'],
    types: {
      roomId: 'string',
    },
    enums: {},
  },
  TYPING_START: {
    required: [],
    types: { roomId: 'string', targetUserId: 'string' },
    enums: {},
  },
  TYPING_STOP: {
    required: [],
    types: { roomId: 'string', targetUserId: 'string' },
    enums: {},
  },
};

/**
 * Initialize safety state for a socket (MOVED IN PHASE 5 — backpressure init delegated)
 * @param {WebSocket} ws - WebSocket connection
 */
function initSocket(ws) {
  // TIER-2 SAFETY: Initialize rate limiting state with rolling window
  socketStateStore.setSocketState(ws, {
    messages: [],           // Timestamp array for rolling window
    violations: 0,          // Violation counter for escalation
    throttledUntil: 0,      // Throttle expiration timestamp
    warned: false,          // Warning sent flag
    lastWarningTime: 0,     // Last warning timestamp
    sendTimestamps: [],     // MESSAGE_SEND/ROOM_MESSAGE only; fixed window for 20/5s limit
  });

  backpressure.initBackpressureState(ws);

  socketStateStore.setDbFailureState(ws, {
    failures: 0,
    lastFailureTime: 0,
  });
}

/**
 * ========================================================================
 * TIER-2 SAFETY: Clean up all safety state for a socket (MOVED IN PHASE 5 — backpressure cleanup delegated)
 * ========================================================================
 * This MUST be called on socket disconnect to prevent memory leaks.
 * Clears rate limiting state, backpressure state, and DB failure tracking.
 *
 * @param {WebSocket} ws - WebSocket connection
 */
function cleanupSocket(ws) {
  // TIER-2: Clear rate limiting state (rolling window, violations, throttling)
  socketStateStore.deleteSocketState(ws);

  backpressure.cleanupBackpressure(ws);

  // TIER-2: Clear DB failure tracking
  socketStateStore.deleteDbFailureState(ws);
}

/**
 * Record DB failure for a socket
 * @param {WebSocket} ws - WebSocket connection
 * @returns {{shouldDegrade: boolean, failureCount: number}}
 */
function recordDbFailure(ws) {
  const state = socketStateStore.getDbFailureState(ws);
  if (!state) {
    initSocket(ws);
    return recordDbFailure(ws);
  }

  const now = Date.now();
  
  // Reset failure count after 1 minute of no failures
  if (now - state.lastFailureTime > 60000) {
    state.failures = 0;
  }
  
  state.failures++;
  state.lastFailureTime = now;
  socketStateStore.setDbFailureState(ws, state);

  // Degrade socket if too many failures (more than 10 in a minute)
  const shouldDegrade = state.failures > 10;

  return { shouldDegrade, failureCount: state.failures };
}

/**
 * Reset DB failure count for a socket (on successful operation)
 * @param {WebSocket} ws - WebSocket connection
 */
function resetDbFailureCount(ws) {
  const state = socketStateStore.getDbFailureState(ws);
  if (state) {
    // Reset failures after successful operations
    if (Date.now() - state.lastFailureTime > 5000) {
      state.failures = Math.max(0, state.failures - 1);
      socketStateStore.setDbFailureState(ws, state);
    }
  }
}

/**
 * Check if socket is currently throttled
 * @param {WebSocket} ws - WebSocket connection
 * @returns {boolean} True if throttled
 */
function isThrottled(ws) {
  const state = socketStateStore.getSocketState(ws);
  if (!state) return false;
  
  return Date.now() < state.throttledUntil;
}

/**
 * Validate message schema
 * @param {Object} message - Parsed message object
 * @returns {{valid: boolean, error?: string, code?: string}}
 */
function validateMessageSchema(message) {
  if (!message || typeof message !== 'object') {
    return {
      valid: false,
      error: 'Message must be a JSON object',
      code: ErrorCodes.INVALID_SCHEMA,
    };
  }

  const { type, ...payload } = message;

  // Type is required
  if (!type || typeof type !== 'string') {
    return {
      valid: false,
      error: 'Message type is required and must be a string',
      code: ErrorCodes.MISSING_TYPE,
    };
  }

  // Get schema for this message type
  const schema = MESSAGE_SCHEMAS[type];
  
  // Unknown types will be handled by protocol router
  if (!schema) {
    return { valid: true };
  }

  // Validate required fields
  for (const field of schema.required) {
    if (payload[field] === undefined || payload[field] === null) {
      return {
        valid: false,
        error: `Missing required field: ${field}`,
        code: ErrorCodes.MISSING_FIELD,
        field,
      };
    }
  }

  // Validate field types
  for (const [field, expectedType] of Object.entries(schema.types)) {
    if (payload[field] !== undefined && payload[field] !== null) {
      const actualType = typeof payload[field];
      if (actualType !== expectedType) {
        return {
          valid: false,
          error: `Invalid type for field '${field}': expected ${expectedType}, got ${actualType}`,
          code: ErrorCodes.INVALID_FIELD_TYPE,
          field,
          expectedType,
          actualType,
        };
      }
    }
  }

  // Validate enum values if schema defines them
  if (schema.enums) {
    for (const [field, allowedValues] of Object.entries(schema.enums)) {
      if (payload[field] !== undefined && payload[field] !== null) {
        if (!allowedValues.includes(payload[field])) {
          return {
            valid: false,
            error: `Invalid value for field '${field}': must be one of ${allowedValues.join(', ')}`,
            code: ErrorCodes.INVALID_FIELD_TYPE,
            field,
            allowedValues,
            receivedValue: payload[field],
          };
        }
      }
    }
  }

  return { valid: true };
}

/**
 * Validate payload size
 * @param {string|Buffer} data - Message data
 * @returns {{valid: boolean, size?: number, error?: string}}
 */
function validatePayloadSize(data) {
  const size = Buffer.isBuffer(data) ? data.length : Buffer.byteLength(data, 'utf8');
  
  if (size > config.PAYLOAD.maxSize) {
      return {
        valid: false,
        size,
        error: `Payload size ${size} exceeds maximum ${config.PAYLOAD.maxSize} bytes`,
      };
  }
  
  return { valid: true, size };
}

/**
 * ========================================================================
 * TIER-2 SAFETY: Check rate limit using rolling time window
 * ========================================================================
 * Escalation path:
 *   1. First violation → warning response (message still allowed)
 *   2. Repeated violations → throttle (messages blocked temporarily)
 *   3. Sustained abuse → close socket
 * 
 * Uses rolling time window: tracks message timestamps, removes old ones
 * outside the window. This provides accurate per-time-period enforcement.
 * 
 * @param {WebSocket} ws - WebSocket connection
 * @returns {{allowed: boolean, remaining?: number, resetAt?: number, violation?: boolean, warning?: boolean, shouldClose?: boolean}}
 */
function checkRateLimit(ws) {
  const state = socketStateStore.getSocketState(ws);
  if (!state) {
    initSocket(ws);
    return checkRateLimit(ws);
  }

  const now = Date.now();
  const windowStart = now - config.RATE_LIMIT.windowMs;

  // ========================================================================
  // ROLLING TIME WINDOW: Remove messages outside the time window
  // ========================================================================
  // This maintains a sliding window of message timestamps.
  // Old messages are automatically removed, ensuring accurate per-period limits.
  const oldLength = state.messages.length;
  state.messages = state.messages.filter(timestamp => timestamp > windowStart);
  
  // Reset violations if window has expired (no recent messages)
  // This ensures violations don't accumulate indefinitely
  if (state.messages.length === 0 && oldLength > 0) {
    // Window expired - reset violations and throttling
    state.violations = 0;
    state.throttledUntil = 0;
    state.warned = false;
    state.lastWarningTime = 0;
  }
  socketStateStore.setSocketState(ws, state);

  // ========================================================================
  // ESCALATION LEVEL 2: Check if currently throttled
  // ========================================================================
  // If socket is throttled, increment violation count and block message
  if (isThrottled(ws)) {
    state.violations++;
    return {
      allowed: false,
      violation: true,
      resetAt: state.throttledUntil,
    };
  }

  // ========================================================================
  // ESCALATION LEVEL 1: Warning threshold check
  // ========================================================================
  // Send warning when approaching limit (before actual violation)
  // Message is still allowed, but client should slow down
  const warningThreshold = Math.floor(config.RATE_LIMIT.maxMessages * config.RATE_LIMIT.warningThreshold);
  
  // Only send warning once per window, or if enough time has passed
  const timeSinceLastWarning = now - state.lastWarningTime;
  const warningCooldown = config.RATE_LIMIT.windowMs / 4; // Max one warning per quarter-window
  
  if (state.messages.length >= warningThreshold && 
      (!state.warned || timeSinceLastWarning > warningCooldown)) {
    state.warned = true;
    state.lastWarningTime = now;
    return {
      allowed: true,
      remaining: config.RATE_LIMIT.maxMessages - state.messages.length,
      resetAt: now + config.RATE_LIMIT.windowMs,
      warning: true,
    };
  }

  // Reset warning flag if below threshold
  if (state.warned && state.messages.length < warningThreshold * 0.5) {
    state.warned = false;
  }

  // ========================================================================
  // RATE LIMIT ENFORCEMENT: Check if limit exceeded
  // ========================================================================
  if (state.messages.length >= config.RATE_LIMIT.maxMessages) {
    state.violations++;
    
    // ESCALATION LEVEL 2: Throttle after repeated violations
    if (state.violations >= config.RATE_LIMIT.violationsBeforeThrottle) {
      // Throttle for the remainder of the window
      const oldestMessage = state.messages[0];
      const throttleDuration = config.RATE_LIMIT.windowMs - (now - oldestMessage);
      state.throttledUntil = now + Math.max(throttleDuration, 1000); // At least 1 second
    }
    
    socketStateStore.setSocketState(ws, state);
    
    // PHASE 4: Close only after sustained abuse (violationsBeforeClose); below that we throttle with ERROR only
    const closeThreshold = config.RATE_LIMIT.violationsBeforeClose ?? config.RATE_LIMIT.maxViolations;
    if (state.violations >= closeThreshold) {
      const userId = connectionManager.getUserId(ws) || null;
      logger.warn('SocketSafety', 'rate_limit_blocked', {
        limiter: 'GENERIC',
        userId,
        currentCount: state.messages.length,
        limit: config.RATE_LIMIT.maxMessages,
        windowMs: config.RATE_LIMIT.windowMs,
        violations: state.violations,
        shouldClose: true,
      });
      return {
        allowed: false,
        violation: true,
        shouldClose: true,
        resetAt: state.throttledUntil,
      };
    }

    // Limit exceeded but not yet throttled/closed
    return {
      allowed: false,
      violation: true,
      remaining: 0,
      resetAt: state.throttledUntil,
    };
  }

  // ========================================================================
  // MESSAGE ALLOWED: Record timestamp and allow
  // ========================================================================
  // Add current timestamp to rolling window
  state.messages.push(now);
  socketStateStore.setSocketState(ws, state);

  return {
    allowed: true,
    remaining: config.RATE_LIMIT.maxMessages - state.messages.length,
    resetAt: now + config.RATE_LIMIT.windowMs,
  };
}

/**
 * Send-only rate limit: MESSAGE_SEND / ROOM_MESSAGE. Fixed window, no disconnect on exceed.
 * @param {WebSocket} ws - WebSocket connection
 * @returns {{allowed: boolean}}
 */
function checkSendRateLimit(ws) {
  const state = socketStateStore.getSocketState(ws);
  if (!state) {
    initSocket(ws);
    return checkSendRateLimit(ws);
  }
  const now = Date.now();
  const windowStart = now - SEND_RATE_WINDOW_MS;
  state.sendTimestamps = (state.sendTimestamps || []).filter(t => t > windowStart);
  if (state.sendTimestamps.length >= MAX_SEND_RATE) {
    return { allowed: false };
  }
  state.sendTimestamps.push(now);
  socketStateStore.setSocketState(ws, state);
  return { allowed: true };
}

/**
 * Validate incoming message before processing
 * Performs size, parse, schema, then rate limit (send-only for MESSAGE_SEND/ROOM_MESSAGE).
 * @param {WebSocket} ws - WebSocket connection
 * @param {string|Buffer} data - Message data
 * @param {Object} context - Context object with correlationId
 * @returns {{valid: boolean, error?: string, code?: string, shouldClose?: boolean, parsedMessage?: Object}}
 */
function validateIncomingMessage(ws, data, context = {}) {
  const correlationId = context.correlationId || null;
  // Validate payload size
  const sizeCheck = validatePayloadSize(data);
  if (!sizeCheck.valid) {
    const state = socketStateStore.getSocketState(ws);
    if (state) {
      state.violations++;
      socketStateStore.setSocketState(ws, state);
      if (state.violations >= config.RATE_LIMIT.maxViolations) {
        return {
          valid: false,
          error: sizeCheck.error,
          code: ErrorCodes.PAYLOAD_TOO_LARGE,
          shouldClose: true,
        };
      }
    }
    return {
      valid: false,
      error: sizeCheck.error,
      code: ErrorCodes.PAYLOAD_TOO_LARGE,
    };
  }

  // Parse early so we can apply send-only rate limit by type
  let message;
  try {
    const str = Buffer.isBuffer(data) ? data.toString('utf8') : data;
    message = JSON.parse(str);
  } catch (parseError) {
    const state = socketStateStore.getSocketState(ws);
    if (state) {
      state.violations++;
      socketStateStore.setSocketState(ws, state);
      if (state.violations >= config.RATE_LIMIT.maxViolations) {
        return {
          valid: false,
          error: `Invalid JSON: ${parseError.message}`,
          code: ErrorCodes.INVALID_JSON,
          shouldClose: true,
        };
      }
    }
    return {
      valid: false,
      error: `Invalid JSON: ${parseError.message}`,
      code: ErrorCodes.INVALID_JSON,
    };
  }

  // Schema validation moved to router (zod) — returns MESSAGE_ERROR with INVALID_PAYLOAD
  const type = message && message.type;

  // Send-only rate limit: MESSAGE_SEND / ROOM_MESSAGE; no disconnect on exceed
  if (type === 'MESSAGE_SEND' || type === 'ROOM_MESSAGE') {
    const sendLimit = checkSendRateLimit(ws);
    if (!sendLimit.allowed) {
      try { metrics.increment('rate_limit_hits_total'); } catch (_) { /* no-op */ }
      const userId = connectionManager.getUserId(ws) || null;
      const sendState = socketStateStore.getSocketState(ws);
      const currentCount = sendState?.sendTimestamps?.length ?? 0;
      logger.warn('SocketSafety', 'rate_limit_blocked', {
        limiter: 'SEND',
        userId,
        currentCount,
        limit: MAX_SEND_RATE,
        windowMs: SEND_RATE_WINDOW_MS,
        shouldClose: false,
      });
      if (userId) {
        try {
          suspiciousDetector.recordFlag(userId, 'WS_RATE_LIMIT', {
            lastDetail: `send_limit window=${SEND_RATE_WINDOW_MS}ms limit=${MAX_SEND_RATE}`,
            lastAction: 'throttle',
          });
        } catch (_) { /* no-op */ }
      }
      logger.warn('SocketSafety', 'rate_limit_exceeded', { correlationId, userId: userId || 'unknown', reason: 'rate_limited' });
      return {
        valid: false,
        error: 'Rate limit exceeded',
        code: ErrorCodes.RATE_LIMIT_EXCEEDED,
        shouldClose: false,
      };
    }
    return { valid: true, parsedMessage: message };
  }

  // WS-5: Exclude TYPING from generic rate counter; router still applies typingRateLimit
  if (type === 'TYPING_START' || type === 'TYPING_STOP') {
    return { valid: true, parsedMessage: message };
  }

  // PHASE 3: Noise types (acks, presence, resume/sync) — skip generic limiter only; payload/schema still validated in router
  if (type && NOISE_TYPES.has(type)) {
    return { valid: true, parsedMessage: message };
  }

  // Other message types: generic rate limit with escalation
  if (isThrottled(ws)) {
    try { metrics.increment('rate_limit_hits_total'); } catch (_) { /* no-op */ }
    const state = socketStateStore.getSocketState(ws);
    const userId = connectionManager.getUserId(ws) || null;
    if (userId && state) {
      try {
        suspiciousDetector.recordFlag(userId, 'WS_RATE_LIMIT', {
          violations: state.violations,
          windowMs: config.RATE_LIMIT.windowMs,
          limit: config.RATE_LIMIT.maxMessages,
          lastDetail: 'throttled',
          lastAction: 'throttle',
        });
      } catch (_) { /* no-op */ }
    }
    return {
      valid: false,
      error: 'Rate limit exceeded. Connection throttled.',
      code: ErrorCodes.RATE_LIMIT_EXCEEDED,
      resetAt: state?.throttledUntil,
    };
  }

  const rateLimitCheck = checkRateLimit(ws);
  if (!rateLimitCheck.allowed) {
    try { metrics.increment('rate_limit_hits_total'); } catch (_) { /* no-op */ }
    const state = socketStateStore.getSocketState(ws);
    const userId = connectionManager.getUserId(ws) || null;
    if (userId) {
      try {
        if (rateLimitCheck.shouldClose) {
          suspiciousDetector.recordFlag(userId, 'WS_RATE_LIMIT_CLOSE', {
            violations: state?.violations,
            windowMs: config.RATE_LIMIT.windowMs,
            limit: config.RATE_LIMIT.maxMessages,
            closeCode: 1008,
            lastAction: 'close',
          });
        } else {
          suspiciousDetector.recordFlag(userId, 'WS_RATE_LIMIT', {
            violations: state?.violations,
            windowMs: config.RATE_LIMIT.windowMs,
            limit: config.RATE_LIMIT.maxMessages,
            lastAction: 'throttle',
          });
        }
      } catch (_) { /* no-op */ }
    }
    return {
      valid: false,
      error: 'Rate limit exceeded',
      code: ErrorCodes.RATE_LIMIT_EXCEEDED,
      shouldClose: rateLimitCheck.shouldClose,
      resetAt: rateLimitCheck.resetAt,
      remaining: rateLimitCheck.remaining,
    };
  }

  return {
    valid: true,
    parsedMessage: message,
    warning: rateLimitCheck.warning || false,
    remaining: rateLimitCheck.remaining,
    resetAt: rateLimitCheck.resetAt,
  };
}

/**
 * Tier-1: Structured safety gate result. Router MUST use this before any handler.
 * Maps: payload overflow -> DROP, rate limit -> FAIL, queue overflow -> FAIL (outbound).
 * @param {WebSocket} ws
 * @param {string|Buffer} data
 * @param {Object} context - Context object with correlationId
 * @returns {{ ok: boolean, policy: 'DROP'|'FAIL'|'ALLOW', reason: string, meta?: Object, parsedMessage?: Object, warning?: boolean, remaining?: number, resetAt?: number }}
 */
function checkMessage(ws, data, context = {}) {
  const validation = validateIncomingMessage(ws, data, context);

  if (validation.valid) {
    return {
      ok: true,
      policy: SAFETY_POLICY.ALLOW,
      reason: 'allowed',
      meta: {},
      parsedMessage: validation.parsedMessage,
      warning: validation.warning,
      remaining: validation.remaining,
      resetAt: validation.resetAt,
    };
  }

  const code = validation.code || 'UNKNOWN';
  const shouldClose = !!validation.shouldClose;

  if (code === ErrorCodes.PAYLOAD_TOO_LARGE && shouldClose) {
    return { ok: false, policy: SAFETY_POLICY.DROP, reason: 'payload_overflow', meta: { code, shouldClose } };
  }
  if (code === ErrorCodes.INVALID_JSON && shouldClose) {
    return { ok: false, policy: SAFETY_POLICY.DROP, reason: 'invalid_json', meta: { code, shouldClose } };
  }

  return {
    ok: false,
    policy: SAFETY_POLICY.FAIL,
    reason: validation.error || 'safety_check_failed',
    meta: { code, shouldClose, resetAt: validation.resetAt, remaining: validation.remaining },
  };
}

/**
 * Get socket statistics (for monitoring/debugging) — MOVED IN PHASE 5: reads backpressure state via store
 * @param {WebSocket} ws - WebSocket connection
 * @returns {Object|null} Socket statistics or null
 */
function getSocketStats(ws) {
  const rateLimitState = socketStateStore.getSocketState(ws);
  const bpState = socketStateStore.getBackpressureState(ws);

  if (!rateLimitState && !bpState) {
    return null;
  }

  const now = Date.now();
  const windowStart = now - config.RATE_LIMIT.windowMs;
  const recentMessages = rateLimitState?.messages.filter(t => t > windowStart) || [];

  return {
    rateLimit: {
      messagesInWindow: recentMessages.length,
      maxMessages: config.RATE_LIMIT.maxMessages,
      violations: rateLimitState?.violations || 0,
      throttledUntil: rateLimitState?.throttledUntil || 0,
      isThrottled: isThrottled(ws),
    },
    backpressure: {
      pendingSends: bpState?.pendingSends || 0,
      threshold: config.BACKPRESSURE.threshold,
    },
  };
}

/**
 * Tier-1.1: Per-user generic rate limiter
 * Checks if a user is allowed to send a message of the given type.
 * Uses rolling time window similar to per-socket rate limiting.
 * 
 * @param {string} userId - User ID
 * @param {string} messageType - Message type (for future per-type limits)
 * @returns {{allowed: boolean, remaining?: number, resetAt?: number}}
 */
function allowUserMessage(userId, messageType) {
  if (!userId) {
    return { allowed: false };
  }

  const now = Date.now();
  const windowStart = now - config.RATE_LIMIT.windowMs;

  // Get or initialize user state
  let userState = rateLimitStore.getUserState(userId);
  if (!userState) {
    userState = {
      messages: [],
      sensitiveRoomActions: [],
      violations: 0,
      throttledUntil: 0,
    };
    rateLimitStore.setUserState(userId, userState);
  }
  if (!Array.isArray(userState.sensitiveRoomActions)) {
    userState.sensitiveRoomActions = [];
  }

  // Clean up old messages outside the window
  const oldLength = userState.messages.length;
  userState.messages = userState.messages.filter(timestamp => timestamp > windowStart);
  userState.sensitiveRoomActions = userState.sensitiveRoomActions.filter(t => t > windowStart);

  // Reset violations if window expired
  if (userState.messages.length === 0 && oldLength > 0) {
    userState.violations = 0;
    userState.throttledUntil = 0;
  }

  // Check if currently throttled
  if (now < userState.throttledUntil) {
    userState.violations++;
    return {
      allowed: false,
      resetAt: userState.throttledUntil,
    };
  }

  // Check if limit exceeded
  if (userState.messages.length >= config.RATE_LIMIT.maxMessages) {
    userState.violations++;
    
    // Throttle after repeated violations
    if (userState.violations >= config.RATE_LIMIT.violationsBeforeThrottle) {
      const oldestMessage = userState.messages[0];
      const throttleDuration = config.RATE_LIMIT.windowMs - (now - oldestMessage);
      userState.throttledUntil = now + Math.max(throttleDuration, 1000);
    }
    
    return {
      allowed: false,
      remaining: 0,
      resetAt: userState.throttledUntil,
    };
  }

  // Stricter limit for sensitive room actions (create/delete/promote/remove)
  const maxSensitive = config.RATE_LIMIT.maxSensitiveRoomActionsPerWindow ?? 20;
  if (SENSITIVE_ROOM_ACTION_TYPES.has(messageType)) {
    if (userState.sensitiveRoomActions.length >= maxSensitive) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: (userState.sensitiveRoomActions[0] || now) + config.RATE_LIMIT.windowMs,
      };
    }
    userState.sensitiveRoomActions.push(now);
  }

  // Message allowed: record timestamp
  userState.messages.push(now);
  rateLimitStore.setUserState(userId, userState);

  return {
    allowed: true,
    remaining: config.RATE_LIMIT.maxMessages - userState.messages.length,
    resetAt: now + config.RATE_LIMIT.windowMs,
  };
}

/**
 * Tier-1.1: Clean up user rate limit state (call on user logout/disconnect)
 * @param {string} userId - User ID
 */
function cleanupUserRateLimit(userId) {
  if (userId) {
    rateLimitStore.deleteUserState(userId);
  }
}

// MOVED IN PHASE 5 — NO LOGIC CHANGE: re-export backpressure and flowControl for existing callers
module.exports = {
  initSocket,
  cleanupSocket,
  checkMessage,
  validateIncomingMessage,
  MESSAGE_RESULT,
  SAFETY_POLICY,
  validateMessageSchema,
  validatePayloadSize,
  checkBackpressure: backpressure.checkBackpressure,
  sendMessage: backpressure.sendMessage, // Unified send function - ALL messages must use this
  queueMessage: backpressure.queueMessage,
  processQueue: backpressure.processQueue,
  getQueueSize: backpressure.getQueueSize,
  incrementPendingSend: backpressure.incrementPendingSend,
  decrementPendingSend: backpressure.decrementPendingSend,
  recordDbFailure,
  resetDbFailureCount,
  closeAbusiveConnection: flowControl.closeAbusiveConnection,
  getSocketStats,
  MESSAGE_SCHEMAS,
  // Tier-1.1: Per-user rate limiting API
  rateLimit: {
    allow: allowUserMessage,
  },
  cleanupUserRateLimit,
  // Tier-1.2: Central backpressure enforcement (from backpressure.js)
  canSend: backpressure.canSend,
  sendOrFail: backpressure.sendOrFail,
};
