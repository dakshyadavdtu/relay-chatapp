'use strict';

/**
 * Validation helpers for admin/report endpoints.
 * Bounded limits to prevent abuse.
 */

const MAX_USER_ID_LEN = 128;
const MAX_REPORT_ID_LEN = 64;
const MAX_CONVERSATION_ID_LEN = 256;
const MAX_CURSOR_LEN = 128;
const REPORT_ID_PREFIX = 'rpt_';
const REPORT_ID_REGEX = /^rpt_[a-f0-9]{12}$/i;
const CONTROL_CHARS = /[\x00-\x1f\x7f]/;

/**
 * Validate and sanitize user ID from params. Returns trimmed string or null if invalid.
 * @param {*} value
 * @returns {{ ok: boolean, value?: string, error?: string, code?: string }}
 */
function validateUserId(value) {
  if (value === undefined || value === null) {
    return { ok: false, error: 'User ID is required', code: 'INVALID_PAYLOAD' };
  }
  const s = String(value).trim();
  if (!s) {
    return { ok: false, error: 'User ID cannot be empty', code: 'INVALID_PAYLOAD' };
  }
  if (s.length > MAX_USER_ID_LEN) {
    return { ok: false, error: 'User ID too long', code: 'INVALID_PAYLOAD' };
  }
  if (CONTROL_CHARS.test(s)) {
    return { ok: false, error: 'User ID contains invalid characters', code: 'INVALID_PAYLOAD' };
  }
  return { ok: true, value: s };
}

/**
 * Validate report ID format (rpt_ + 12 hex chars).
 * @param {*} value
 * @returns {{ ok: boolean, value?: string, error?: string, code?: string }}
 */
function validateReportId(value) {
  if (value === undefined || value === null) {
    return { ok: false, error: 'Report ID is required', code: 'INVALID_PAYLOAD' };
  }
  const s = String(value).trim();
  if (!s) {
    return { ok: false, error: 'Report ID cannot be empty', code: 'INVALID_PAYLOAD' };
  }
  if (s.length > MAX_REPORT_ID_LEN) {
    return { ok: false, error: 'Report ID too long', code: 'INVALID_PAYLOAD' };
  }
  if (!REPORT_ID_REGEX.test(s)) {
    return { ok: false, error: 'Invalid report ID format', code: 'INVALID_PAYLOAD' };
  }
  return { ok: true, value: s };
}

/**
 * Validate optional string field with max length (e.g. reason, details).
 * @param {*} value
 * @param {number} maxLen
 * @returns {{ ok: boolean, value?: string, error?: string, code?: string }}
 */
function validateOptionalString(value, maxLen) {
  if (value === undefined || value === null) return { ok: true, value: undefined };
  const s = String(value).trim();
  if (!s) return { ok: true, value: undefined };
  if (s.length > maxLen) {
    return { ok: false, error: `Must be at most ${maxLen} characters`, code: 'PAYLOAD_TOO_LARGE' };
  }
  return { ok: true, value: s };
}

/**
 * Validate optional ID field (targetUserId, messageId) - bounded length.
 * @param {*} value
 * @param {number} [maxLen=64]
 * @returns {{ ok: boolean, value?: string, error?: string, code?: string }}
 */
function validateOptionalId(value, maxLen = 64) {
  if (value === undefined || value === null) return { ok: true, value: undefined };
  const s = String(value).trim();
  if (!s) return { ok: true, value: undefined };
  if (s.length > maxLen) {
    return { ok: false, error: 'ID too long', code: 'PAYLOAD_TOO_LARGE' };
  }
  if (CONTROL_CHARS.test(s)) {
    return { ok: false, error: 'ID contains invalid characters', code: 'INVALID_PAYLOAD' };
  }
  return { ok: true, value: s };
}

/**
 * Validate required conversationId (chatId) for admin message inspection.
 * Format: direct:<id1>:<id2> (3 segments, id1/id2 non-empty) or room:<id> (2 segments, id non-empty).
 * @param {*} value
 * @returns {{ ok: boolean, value?: string, error?: string, code?: string }}
 */
function validateConversationId(value) {
  if (value === undefined || value === null) {
    return { ok: false, error: 'conversationId is required', code: 'INVALID_QUERY' };
  }
  const s = String(value).trim();
  if (!s) {
    return { ok: false, error: 'conversationId cannot be empty', code: 'INVALID_QUERY' };
  }
  if (s.length > MAX_CONVERSATION_ID_LEN) {
    return { ok: false, error: 'conversationId too long', code: 'INVALID_QUERY' };
  }
  if (CONTROL_CHARS.test(s)) {
    return { ok: false, error: 'conversationId contains invalid characters', code: 'INVALID_QUERY' };
  }
  const parts = s.split(':');
  if (s.startsWith('direct:')) {
    if (parts.length !== 3 || !parts[1] || !parts[2]) {
      return { ok: false, error: 'Invalid conversationId format (expected direct:<id1>:<id2>)', code: 'INVALID_QUERY' };
    }
  } else if (s.startsWith('room:')) {
    if (parts.length !== 2 || !parts[1]) {
      return { ok: false, error: 'Invalid conversationId format (expected room:<id>)', code: 'INVALID_QUERY' };
    }
  } else {
    return { ok: false, error: 'Invalid conversationId format (must start with direct: or room:)', code: 'INVALID_QUERY' };
  }
  return { ok: true, value: s };
}

/**
 * Validate required integer in range (e.g. limit for pagination).
 * @param {*} value - Raw value (will be parsed with parseInt(value, 10))
 * @param {string} name - Field name for error messages (e.g. 'limit')
 * @param {number} min - Inclusive minimum
 * @param {number} max - Inclusive maximum
 * @returns {{ ok: boolean, value?: number, error?: string, code?: string }}
 */
function validateRequiredIntInRange(value, name, min, max) {
  if (value === undefined || value === null) {
    return { ok: false, error: `${name} is required`, code: 'INVALID_QUERY' };
  }
  const n = parseInt(String(value).trim(), 10);
  if (Number.isNaN(n)) {
    return { ok: false, error: `${name} must be a number`, code: 'INVALID_QUERY' };
  }
  if (n < min || n > max) {
    return { ok: false, error: `${name} must be between ${min} and ${max}`, code: 'INVALID_QUERY' };
  }
  return { ok: true, value: n };
}

/**
 * Validate optional cursor (e.g. before for pagination). Absent => value null.
 * @param {*} value
 * @param {string} [name='before'] - Field name for error messages
 * @returns {{ ok: boolean, value?: string|null, error?: string, code?: string }}
 */
function validateOptionalCursor(value, name = 'before') {
  if (value === undefined || value === null) {
    return { ok: true, value: null };
  }
  const s = String(value).trim();
  if (!s) {
    return { ok: true, value: null };
  }
  if (s.length > MAX_CURSOR_LEN) {
    return { ok: false, error: `${name} too long`, code: 'INVALID_QUERY' };
  }
  if (CONTROL_CHARS.test(s)) {
    return { ok: false, error: `${name} contains invalid characters`, code: 'INVALID_QUERY' };
  }
  return { ok: true, value: s };
}

/**
 * Validate optional senderId filter. Absent => value null.
 * @param {*} value
 * @returns {{ ok: boolean, value?: string|null, error?: string, code?: string }}
 */
function validateOptionalSenderId(value) {
  if (value === undefined || value === null) {
    return { ok: true, value: null };
  }
  const s = String(value).trim();
  if (!s) {
    return { ok: true, value: null };
  }
  if (s.length > MAX_USER_ID_LEN) {
    return { ok: false, error: 'senderId too long', code: 'INVALID_QUERY' };
  }
  if (CONTROL_CHARS.test(s)) {
    return { ok: false, error: 'senderId contains invalid characters', code: 'INVALID_QUERY' };
  }
  return { ok: true, value: s };
}

/** Report category (priority is derived from category only; client must not send priority). */
const REPORT_CATEGORIES = Object.freeze(['Spam', 'Harassment', 'Hate speech', 'Sexual content', 'Illegal']);

/**
 * Validate report category. Required on create; client must not send priority.
 * @param {*} value
 * @returns {{ ok: boolean, value?: string, error?: string, code?: string }}
 */
function validateCategory(value) {
  if (value === undefined || value === null) {
    return { ok: false, error: 'category is required', code: 'INVALID_PAYLOAD' };
  }
  const s = String(value).trim();
  if (!REPORT_CATEGORIES.includes(s)) {
    return { ok: false, error: `category must be one of: ${REPORT_CATEGORIES.join(', ')}`, code: 'INVALID_PAYLOAD' };
  }
  return { ok: true, value: s };
}

module.exports = {
  validateUserId,
  validateReportId,
  validateOptionalString,
  validateOptionalId,
  validateConversationId,
  validateRequiredIntInRange,
  validateOptionalCursor,
  validateOptionalSenderId,
  validateCategory,
  MAX_USER_ID_LEN,
  MAX_REPORT_ID_LEN,
  MAX_CONVERSATION_ID_LEN,
  MAX_CURSOR_LEN,
  REPORT_CATEGORIES,
};
