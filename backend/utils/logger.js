'use strict';

/**
 * Structured Logging Module
 * 
 * Provides structured logging for connection and message lifecycle events.
 * Supports both plain text and JSON output formats.
 * 
 * No external dependencies - uses only Node.js built-ins
 */

const config = require('../config/constants');

/**
 * Log levels
 * @enum {number}
 */
const LogLevel = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

/**
 * Log level names
 * @type {Object<number, string>}
 */
const LogLevelNames = {
  [LogLevel.DEBUG]: 'DEBUG',
  [LogLevel.INFO]: 'INFO',
  [LogLevel.WARN]: 'WARN',
  [LogLevel.ERROR]: 'ERROR',
};

/**
 * Current log level
 * @type {number}
 */
const currentLogLevel = LogLevel[config.LOGGING.level.toUpperCase()] || LogLevel.INFO;

/**
 * Format log entry
 * @param {string} level - Log level name
 * @param {string} component - Component name
 * @param {string} event - Event name
 * @param {Object} [data] - Additional data
 * @returns {string} Formatted log entry
 */
function formatLog(level, component, event, data = {}) {
  const timestamp = new Date().toISOString();
  const entry = {
    timestamp,
    level,
    component,
    event,
    ...data,
  };

  if (config.LOGGING.json) {
    return JSON.stringify(entry);
  }

  // Plain text format
  const dataStr = Object.keys(data).length > 0 
    ? ' ' + JSON.stringify(data)
    : '';
  return `[${timestamp}] [${level}] [${component}] ${event}${dataStr}`;
}

/**
 * Log a message
 * @param {number} level - Log level
 * @param {string} component - Component name
 * @param {string} event - Event name
 * @param {Object} [data] - Additional data
 */
function log(level, component, event, data = {}) {
  if (level < currentLogLevel) {
    return;
  }

  const levelName = LogLevelNames[level];
  const message = formatLog(levelName, component, event, data);

  if (level === LogLevel.ERROR) {
    console.error(message);
  } else if (level === LogLevel.WARN) {
    console.warn(message);
  } else {
    console.log(message);
  }
}

/**
 * Log debug message
 * @param {string} component - Component name
 * @param {string} event - Event name
 * @param {Object} [data] - Additional data
 */
function debug(component, event, data = {}) {
  log(LogLevel.DEBUG, component, event, data);
}

/**
 * Log info message
 * @param {string} component - Component name
 * @param {string} event - Event name
 * @param {Object} [data] - Additional data
 */
function info(component, event, data = {}) {
  log(LogLevel.INFO, component, event, data);
}

/**
 * Log warning message
 * @param {string} component - Component name
 * @param {string} event - Event name
 * @param {Object} [data] - Additional data
 */
function warn(component, event, data = {}) {
  log(LogLevel.WARN, component, event, data);
}

/**
 * Log error message
 * @param {string} component - Component name
 * @param {string} event - Event name
 * @param {Object} [data] - Additional data
 */
function error(component, event, data = {}) {
  log(LogLevel.ERROR, component, event, data);
}

/** Tier-1: Frozen event enum. Use these exact strings. */
const TRANSITION_EVENT = Object.freeze({
  CONNECTION_OPEN: 'CONNECTION_OPEN',
  CONNECTION_CLOSE: 'CONNECTION_CLOSE',
  MESSAGE_RECEIVED: 'MESSAGE_RECEIVED',
  SAFETY_CHECKED: 'SAFETY_CHECKED',
  MESSAGE_CREATED: 'MESSAGE_CREATED',
  MESSAGE_SENT: 'MESSAGE_SENT',
  MESSAGE_DELIVERED: 'MESSAGE_DELIVERED',
  MESSAGE_FAILED: 'MESSAGE_FAILED',
  MESSAGE_DROPPED: 'MESSAGE_DROPPED',
  PRESENCE_ONLINE: 'PRESENCE_ONLINE',
  PRESENCE_OFFLINE: 'PRESENCE_OFFLINE',
});

const MESSAGE_RELATED_EVENTS = new Set([
  TRANSITION_EVENT.MESSAGE_CREATED,
  TRANSITION_EVENT.MESSAGE_SENT,
  TRANSITION_EVENT.MESSAGE_DELIVERED,
]);

function validateTransitionPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('transition: payload required and must be object');
  }
  if (!payload.event || typeof payload.event !== 'string') {
    throw new Error('transition: event required (string)');
  }
  if (!('connectionId' in payload)) {
    throw new Error('transition: connectionId required (use null if unavailable)');
  }
  if (!('userId' in payload)) {
    throw new Error('transition: userId required (use null if unavailable)');
  }
  if (MESSAGE_RELATED_EVENTS.has(payload.event)) {
    if (payload.messageId == null || typeof payload.messageId !== 'string' || !payload.messageId.trim()) {
      throw new Error(`transition: messageId required for event ${payload.event}`);
    }
  }
}

/**
 * Tier-1: Log state transition with mandatory identifiers.
 * @param {Object} params - { messageId?, userId?, connectionId?, fromState, toState, reason }
 */
function logStateTransition(params) {
  const { messageId, userId, connectionId, fromState, toState, reason } = params;
  info('StateTransition', 'state_change', {
    messageId: messageId || null,
    userId: userId || null,
    connectionId: connectionId || null,
    fromState: fromState || null,
    toState: toState || null,
    reason: reason || null,
  });
}

/**
 * Tier-1: Structured transition logging. Validates payload; throws if invalid.
 * Required: event, connectionId (key), userId (key). Message events: messageId required.
 * @param {Object} payload - { event, messageId?, connectionId, userId, fromState?, toState?, timestamp?, ... }
 */
function transition(payload) {
  validateTransitionPayload(payload);

  const timestamp = payload.timestamp ?? new Date().toISOString();
  const entry = {
    event: payload.event,
    messageId: payload.messageId ?? null,
    connectionId: payload.connectionId ?? null,
    userId: payload.userId ?? null,
    fromState: payload.fromState ?? null,
    toState: payload.toState ?? null,
    timestamp,
    ...payload,
  };
  info('Transition', payload.event, entry);
}

/** Object with info/warn/error/debug for code that expects logger.info(...) */
const logger = { info, warn, error, debug };

module.exports = {
  debug,
  info,
  warn,
  error,
  logStateTransition,
  transition,
  TRANSITION_EVENT,
  LogLevel,
  logger,
};
