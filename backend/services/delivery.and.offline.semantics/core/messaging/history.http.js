/**
 * history.http.js
 *
 * HTTP-based searchable message history retrieval logic.
 * This module provides read-only access to message history via HTTP endpoints.
 *
 * SEPARATION FROM WEBSOCKET DELIVERY:
 * ====================================
 * This endpoint is SEPARATE from WebSocket delivery for these reasons:
 *
 * 1. Different use cases:
 *    - WebSocket: Real-time delivery of NEW messages (push)
 *    - HTTP History: Browsing PAST messages (pull)
 *
 * 2. Avoids duplication:
 *    - WebSocket delivers messages as they arrive (sequence-based)
 *    - HTTP history queries stored messages (cursor-based pagination)
 *    - No overlap: WebSocket handles delivery state transitions,
 *      HTTP history only reads current state
 *
 * 3. Ordering guarantees:
 *    - WebSocket: Ordered by sequenceNumber (ascending) for delivery
 *    - HTTP History: Ordered by sequenceNumber (descending) for pagination,
 *      then reversed for client rendering (ascending)
 *    - Both use sequenceNumber as source of truth, ensuring consistency
 *
 * 4. Reconnection compatibility:
 *    - WebSocket resync uses computeMissingMessages() (sequence gaps)
 *    - HTTP history can fetch messages AFTER lastSeenSeq for catch-up
 *    - No duplication: WebSocket resync handles real-time gaps,
 *      HTTP history handles historical browsing
 *
 * This endpoint does NOT:
 * - Mutate delivery state (sent/delivered/read)
 * - Trigger delivery state transitions
 * - Mark messages as read automatically
 * - Duplicate WebSocket resend logic
 *
 * It ONLY:
 * - Reads message history from storage
 * - Filters by chatId, sequenceNumber, timestamp
 * - Performs text search
 * - Respects TTL expiration
 * - Returns delivery state (read-only)
 */

const delivery = require('./delivery.logic.js');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CHAT_TYPE_DIRECT = 'direct';
const CHAT_TYPE_ROOM = 'room';

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Error thrown when history query parameters are invalid.
 * HTTP handlers MUST return 400 Bad Request when this error is thrown.
 */
class InvalidHistoryQueryError extends Error {
  constructor(reason, message = 'Invalid history query') {
    super(message + ': ' + reason);
    this.name = 'InvalidHistoryQueryError';
    this.reason = reason;
    this.httpStatus = 400; // HTTP handlers MUST return 400 Bad Request
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isSafeNonNegativeInteger(value) {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    Number.isSafeInteger(value)
  );
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isPositiveInteger(value) {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value > 0 &&
    Number.isSafeInteger(value)
  );
}

/**
 * Validates chatType parameter.
 *
 * @param {unknown} chatType
 * @returns {boolean}
 */
function isValidChatType(chatType) {
  return chatType === CHAT_TYPE_DIRECT || chatType === CHAT_TYPE_ROOM;
}

/**
 * Checks if a message has expired based on TTL metadata.
 * Uses delivery logic's expiration check.
 *
 * @param {{ expiresAt?: number, [key: string]: unknown }} message
 * @param {number} [now] - optional current timestamp (defaults to now)
 * @returns {boolean}
 */
function isMessageExpired(message, now) {
  return delivery.isMessageExpired(message, now);
}

/**
 * Performs case-insensitive text search on message content/payload.
 *
 * @param {{ content?: string, payload?: unknown, [key: string]: unknown }} message
 * @param {string} searchText
 * @returns {boolean}
 */
function matchesTextSearch(message, searchText) {
  if (!isNonEmptyString(searchText)) return true;
  const searchLower = searchText.toLowerCase().trim();
  if (searchLower.length === 0) return true;

  // Search in content field
  if (typeof message.content === 'string') {
    if (message.content.toLowerCase().includes(searchLower)) return true;
  }

  // Search in payload (if string or JSON-serializable)
  if (message.payload !== undefined) {
    let payloadText = '';
    if (typeof message.payload === 'string') {
      payloadText = message.payload;
    } else if (typeof message.payload === 'object' && message.payload !== null) {
      try {
        payloadText = JSON.stringify(message.payload);
      } catch (_) {
        payloadText = String(message.payload);
      }
    } else {
      payloadText = String(message.payload);
    }
    if (payloadText.toLowerCase().includes(searchLower)) return true;
  }

  return false;
}

/**
 * Gets sequenceNumber from a message, or returns -1 if missing/invalid.
 *
 * @param {{ sequenceNumber?: number, [key: string]: unknown }} message
 * @returns {number}
 */
function getSequenceNumber(message) {
  if (typeof message.sequenceNumber === 'number' && Number.isInteger(message.sequenceNumber) && message.sequenceNumber >= 0) {
    return message.sequenceNumber;
  }
  return -1;
}

/**
 * Gets timestamp from a message (createdAt or updatedAt), or returns -1 if missing/invalid.
 *
 * @param {{ createdAt?: number, updatedAt?: number, [key: string]: unknown }} message
 * @returns {number}
 */
function getMessageTimestamp(message) {
  if (typeof message.createdAt === 'number' && isSafeNonNegativeInteger(message.createdAt)) {
    return message.createdAt;
  }
  if (typeof message.updatedAt === 'number' && isSafeNonNegativeInteger(message.updatedAt)) {
    return message.updatedAt;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Query Building (MongoDB-style)
// ---------------------------------------------------------------------------

/**
 * Builds MongoDB query filter for history retrieval.
 * Returns query object that can be used with MongoDB find().
 *
 * SAFETY GUARDRAILS:
 * ==================
 * - sequenceNumber is the ONLY ordering key (timestamps never used for sorting)
 * - beforeSeq and afterSeq are mutually exclusive (enforced in validateHistoryParams)
 *
 * MONGODB INDEX REQUIREMENTS:
 * ===========================
 * 1. Compound index: { chatId: 1, sequenceNumber: -1 }
 *    - PRIMARY index for all queries
 *    - Enables efficient pagination by sequenceNumber (DESC for backward pagination)
 *    - Enables efficient catch-up by sequenceNumber (ASC for forward catch-up)
 *
 * 2. Compound index: { chatId: 1, sequenceNumber: 1 }
 *    - For forward catch-up queries (afterSeq, ASC ordering)
 *    - Alternative: use { chatId: 1, sequenceNumber: -1 } with reverse scan
 *
 * 3. TTL index: { expiresAt: 1 }
 *    - Automatically removes expired messages
 *    - Must be sparse (only documents with expiresAt)
 *    - NOTE: TTL expiration may cause sequenceNumber gaps (see TTL GAPS comment below)
 *
 * 4. Text index: { content: 'text', 'payload.text': 'text' }
 *    - Enables full-text search (optional, for better performance)
 *    - Alternative: use regex on indexed fields for simple case-insensitive search
 *
 * TTL GAPS WARNING:
 * =================
 * When messages expire due to TTL, sequenceNumber gaps will occur naturally.
 * Example: If messages with seq 5, 6, 7 exist and message 6 expires, there will be a gap.
 * This is EXPECTED BEHAVIOR and must NOT be "fixed" by:
 * - Renumbering sequenceNumbers
 * - Filling gaps with placeholder messages
 * - Changing query logic to skip gaps
 * Gaps are a natural consequence of TTL expiration and must be preserved for correctness.
 *
 * @param {string} chatId
 * @param {number} [beforeSeq] - cursor: sequenceNumber < beforeSeq (user scroll/history)
 * @param {number} [beforeTimestamp] - cursor: createdAt < beforeTimestamp (deprecated, display only)
 * @param {number} [afterSeq] - cursor: sequenceNumber > afterSeq (reconnect/resync catch-up)
 * @param {string} [searchText] - optional text search
 * @returns {object}
 */
function buildHistoryQuery(chatId, beforeSeq, beforeTimestamp, afterSeq, searchText) {
  const query = {
    chatId: chatId,
  };

  // TTL + PAGINATION HOLES NOTE:
  // =============================
  // Ephemeral messages are subject to TTL expiration.
  // This may cause intentional gaps in message history.
  // Such gaps are expected and by design.
  // Example: If messages with sequenceNumber 5, 6, 7 exist and message 6 expires,
  // the result set will contain [5, 7] with a gap at 6. This is correct behavior.
  // Do NOT attempt to fill gaps, renumber sequenceNumbers, or modify query logic.

  // Cursor-based pagination: beforeSeq OR afterSeq (mutually exclusive, enforced in validateHistoryParams)
  if (afterSeq !== undefined && isSafeNonNegativeInteger(afterSeq)) {
    // GUARDRAIL: Reconnect/resync path ONLY - fetch messages AFTER lastSeenSeq (forward catch-up)
    query.sequenceNumber = { $gt: afterSeq };
  } else if (beforeSeq !== undefined && isSafeNonNegativeInteger(beforeSeq)) {
    // GUARDRAIL: User scroll/history path ONLY - fetch messages BEFORE cursor (backward pagination)
    query.sequenceNumber = { $lt: beforeSeq };
  } else if (beforeTimestamp !== undefined && isSafeNonNegativeInteger(beforeTimestamp)) {
    // DEPRECATED: Timestamp-based cursor (kept for backward compatibility)
    // NOTE: Query still filters by sequenceNumber internally, timestamp is display-only
    // This is a legacy feature and should be migrated to beforeSeq
    query.createdAt = { $lt: beforeTimestamp };
  }

  // Text search: if provided, MongoDB will use text index or regex
  // This is handled in-memory after fetch for simplicity (production should use MongoDB $text)
  // For production MongoDB: query.$text = { $search: searchText };

  // TTL: MongoDB TTL index automatically filters expired messages
  // No need to add expiresAt filter here (MongoDB handles it)
  // NOTE: Expired messages create sequenceNumber gaps (see TTL GAPS WARNING above)

  return query;
}

/**
 * Builds MongoDB sort specification for history retrieval.
 *
 * SAFETY GUARDRAIL:
 * =================
 * sequenceNumber is the PRIMARY and ONLY ordering key.
 * Timestamps are NEVER used for sorting (only for display).
 * This ensures consistent ordering across all queries and prevents race conditions.
 *
 * @param {boolean} [useTimestamp] - DEPRECATED: ignored, always sorts by sequenceNumber
 * @param {boolean} [ascending] - if true, sort ASC (for catch-up); otherwise DESC (for pagination)
 * @returns {object}
 */
function buildHistorySort(useTimestamp, ascending) {
  // SAFETY: Always use sequenceNumber for sorting, never timestamps
  // Timestamps are for display only and may have clock skew issues
  if (ascending === true) {
    return { sequenceNumber: 1 }; // ASC for forward catch-up (reconnect/resync)
  }
  return { sequenceNumber: -1 }; // DESC for backward pagination (user scroll/history)
}

// ---------------------------------------------------------------------------
// Result Processing
// ---------------------------------------------------------------------------

/**
 * Filters and processes messages for history response.
 * Applies TTL expiration check and text search in-memory.
 * In production, these should be done in MongoDB query for efficiency.
 *
 * TTL GAPS NOTE:
 * ==============
 * When messages expire due to TTL, they are filtered out here.
 * This creates sequenceNumber gaps in the result set (e.g., seq 5, 7, 8 if seq 6 expired).
 * These gaps are EXPECTED and MUST be preserved - do NOT attempt to fill or renumber.
 * Gaps are a natural consequence of TTL expiration and indicate messages that no longer exist.
 *
 * @param {Array<{ [key: string]: unknown }>} messages
 * @param {string} [searchText] - optional text search
 * @param {number} [now] - optional current timestamp
 * @returns {Array<object>}
 */
function filterHistoryMessages(messages, searchText, now) {
  if (!Array.isArray(messages)) return [];

  const currentTime = now !== undefined ? now : Date.now();
  const result = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg === null || typeof msg !== 'object') continue;

    // TTL expiration check
    // NOTE: Expired messages create sequenceNumber gaps (see TTL GAPS NOTE above)
    if (isMessageExpired(msg, currentTime)) continue;

    // Text search (in-memory; production should use MongoDB $text)
    if (searchText !== undefined && !matchesTextSearch(msg, searchText)) continue;

    result.push(msg);
  }

  return result;
}

/**
 * Reverses message order for client rendering.
 * Messages are fetched DESC (newest first) for pagination,
 * but client needs ASC (oldest first) for chronological display.
 *
 * @param {Array<object>} messages
 * @returns {Array<object>}
 */
function reverseForClient(messages) {
  if (!Array.isArray(messages)) return [];
  const reversed = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    reversed.push(messages[i]);
  }
  return reversed;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validates and normalizes history query parameters.
 *
 * SAFETY GUARDRAILS (MANDATORY):
 * ==============================
 * 1. DUAL-USE GUARDRAIL: Rejects requests with BOTH beforeSeq and afterSeq
 *    - HTTP handlers MUST return 400 Bad Request when InvalidHistoryQueryError is thrown
 *    - User scroll/history path: uses ONLY beforeSeq (backward pagination)
 *    - Reconnect/resync path: uses ONLY afterSeq (forward catch-up)
 *    - Mixing both causes ambiguous query behavior, potential duplicates, and inconsistent results
 *    - Do NOT infer intent automatically - enforce strictly at HTTP boundary
 *
 * 2. ORDERING SOURCE OF TRUTH: sequenceNumber is the ONLY ordering key
 *    - Timestamps are for display only, NEVER for sorting
 *    - This ensures consistent ordering across all queries and prevents race conditions
 *    - All queries MUST be sorted by sequenceNumber (ASC for catch-up, DESC for pagination)
 *
 * @param {unknown} chatType
 * @param {unknown} chatId
 * @param {unknown} beforeSeq
 * @param {unknown} beforeTimestamp
 * @param {unknown} afterSeq
 * @param {unknown} limit
 * @param {unknown} searchText
 * @returns {{ chatType: string, chatId: string, beforeSeq: number | undefined, beforeTimestamp: number | undefined, afterSeq: number | undefined, limit: number, searchText: string | undefined }}
 * @throws {InvalidHistoryQueryError} - HTTP handlers MUST return 400 Bad Request
 */
function validateHistoryParams(chatType, chatId, beforeSeq, beforeTimestamp, afterSeq, limit, searchText) {
  if (!isValidChatType(chatType)) {
    throw new InvalidHistoryQueryError('chatType must be "direct" or "room"');
  }

  if (!isNonEmptyString(chatId)) {
    throw new InvalidHistoryQueryError('chatId must be a non-empty string');
  }

  // SAFETY GUARDRAIL: Reject if BOTH beforeSeq and afterSeq are provided
  // This prevents ambiguous queries, duplicate fetches, and inconsistent results.
  // HTTP handlers MUST return 400 Bad Request when this error is thrown.
  const hasBeforeSeq = beforeSeq !== undefined && beforeSeq !== null;
  const hasAfterSeq = afterSeq !== undefined && afterSeq !== null;
  if (hasBeforeSeq && hasAfterSeq) {
    throw new InvalidHistoryQueryError(
      'Cannot specify both beforeSeq and afterSeq in a single request. ' +
      'Use beforeSeq ONLY for user-driven scroll/history browsing (backward pagination). ' +
      'Use afterSeq ONLY for reconnect/resync catch-up (forward catch-up). ' +
      'Mixing both causes ambiguous query behavior and potential duplicates.'
    );
  }

  // Cursor: beforeSeq OR beforeTimestamp OR afterSeq (mutually exclusive)
  let normalizedBeforeSeq = undefined;
  let normalizedBeforeTimestamp = undefined;
  let normalizedAfterSeq = undefined;

  if (hasBeforeSeq) {
    // GUARDRAIL: beforeSeq is ONLY for user scroll/history browsing (backward pagination)
    // Do NOT use for reconnect/resync - use afterSeq instead
    if (!isSafeNonNegativeInteger(beforeSeq)) {
      throw new InvalidHistoryQueryError('beforeSeq must be a non-negative integer');
    }
    normalizedBeforeSeq = beforeSeq;
  } else if (hasAfterSeq) {
    // GUARDRAIL: afterSeq is ONLY for reconnect/resync catch-up (forward catch-up)
    // Do NOT use for user scroll/history - use beforeSeq instead
    if (!isSafeNonNegativeInteger(afterSeq)) {
      throw new InvalidHistoryQueryError('afterSeq must be a non-negative integer');
    }
    normalizedAfterSeq = afterSeq;
  } else if (beforeTimestamp !== undefined && beforeTimestamp !== null) {
    // DEPRECATED: Timestamp-based pagination (kept for backward compatibility)
    // NOTE: Sorting still uses sequenceNumber, timestamp is only for cursor
    if (!isSafeNonNegativeInteger(beforeTimestamp)) {
      throw new InvalidHistoryQueryError('beforeTimestamp must be a non-negative integer');
    }
    normalizedBeforeTimestamp = beforeTimestamp;
  }

  // Limit: default 30, max 100
  let normalizedLimit = DEFAULT_LIMIT;
  if (limit !== undefined && limit !== null) {
    if (!isPositiveInteger(limit)) {
      throw new InvalidHistoryQueryError('limit must be a positive integer');
    }
    normalizedLimit = Math.min(limit, MAX_LIMIT);
  }

  // Search text: optional, trim whitespace
  let normalizedSearchText = undefined;
  if (searchText !== undefined && searchText !== null) {
    if (typeof searchText !== 'string') {
      throw new InvalidHistoryQueryError('searchText must be a string');
    }
    const trimmed = searchText.trim();
    if (trimmed.length > 0) {
      normalizedSearchText = trimmed;
    }
  }

  return {
    chatType,
    chatId,
    beforeSeq: normalizedBeforeSeq,
    beforeTimestamp: normalizedBeforeTimestamp,
    afterSeq: normalizedAfterSeq,
    limit: normalizedLimit,
    searchText: normalizedSearchText,
  };
}

/**
 * Processes history query results for HTTP response.
 * This function would be called after fetching from MongoDB.
 *
 * MONGODB QUERY EXAMPLE:
 * ======================
 * const query = buildHistoryQuery(chatId, beforeSeq, beforeTimestamp, searchText);
 * const sort = buildHistorySort(beforeTimestamp !== undefined);
 * const messages = await db.messages
 *   .find(query)
 *   .sort(sort)
 *   .limit(limit + 1) // Fetch one extra to check if more pages exist
 *   .toArray();
 *
 * @param {Array<{ [key: string]: unknown }>} messages - raw messages from MongoDB
 * @param {number} requestedLimit - requested limit (before +1 for pagination check)
 * @param {string} [searchText] - optional text search (for in-memory filtering)
 * @param {number} [now] - optional current timestamp (for TTL check)
 * @returns {{ messages: Array<object>, hasMore: boolean, nextCursor: { seq: number | null, timestamp: number | null } }}
 */
function processHistoryResults(messages, requestedLimit, searchText, now) {
  if (!Array.isArray(messages)) {
    return { messages: [], hasMore: false, nextCursor: { seq: null, timestamp: null } };
  }

  // Filter: TTL expiration and text search
  const filtered = filterHistoryMessages(messages, searchText, now);

  // Check if more pages exist (we fetched limit + 1)
  const hasMore = filtered.length > requestedLimit;
  const resultMessages = hasMore ? filtered.slice(0, requestedLimit) : filtered;

  // Reverse for client (DESC -> ASC)
  const reversed = reverseForClient(resultMessages);

  // Build next cursor from oldest message (first in reversed array)
  // This is the message with the smallest sequenceNumber/timestamp
  // Next page will fetch messages BEFORE this cursor
  let nextCursor = { seq: null, timestamp: null };
  if (reversed.length > 0) {
    const oldestMsg = reversed[0]; // First element is oldest (smallest seq/timestamp)
    const seq = getSequenceNumber(oldestMsg);
    const timestamp = getMessageTimestamp(oldestMsg);
    if (seq !== -1) {
      nextCursor.seq = seq;
    }
    if (timestamp !== -1) {
      nextCursor.timestamp = timestamp;
    }
  }

  return {
    messages: reversed,
    hasMore,
    nextCursor,
  };
}

/**
 * Main history retrieval logic.
 * This function orchestrates the history query flow.
 *
 * SAFETY GUARDRAILS:
 * ==================
 * - Enforces sequenceNumber-only sorting (never timestamps)
 * - Uses appropriate sort direction based on query type (beforeSeq vs afterSeq)
 *
 * USAGE IN HTTP HANDLER:
 * ======================
 * GET /api/messages/history?chatType=direct&chatId=user123&beforeSeq=100&limit=30&searchText=hello
 *
 * const params = validateHistoryParams(
 *   req.query.chatType,
 *   req.query.chatId,
 *   req.query.beforeSeq,
 *   req.query.beforeTimestamp,
 *   req.query.afterSeq,
 *   req.query.limit,
 *   req.query.searchText
 * );
 *
 * const query = buildHistoryQuery(params.chatId, params.beforeSeq, params.beforeTimestamp, params.afterSeq, params.searchText);
 * const sort = buildHistorySort(params.beforeTimestamp !== undefined, params.afterSeq !== undefined);
 * const rawMessages = await db.messages.find(query).sort(sort).limit(params.limit + 1).toArray();
 *
 * const result = processHistoryResults(rawMessages, params.limit, params.searchText);
 * res.json(result);
 *
 * @param {object} params - validated parameters from validateHistoryParams()
 * @param {Function} fetchMessages - async function(query, sort, limit) => Promise<Array<object>>
 * @returns {Promise<{ messages: Array<object>, hasMore: boolean, nextCursor: { seq: number | null, timestamp: number | null } }>}
 */
async function retrieveHistory(params, fetchMessages) {
  if (typeof fetchMessages !== 'function') {
    throw new Error('fetchMessages must be a function');
  }

  const query = buildHistoryQuery(
    params.chatId,
    params.beforeSeq,
    params.beforeTimestamp,
    params.afterSeq,
    params.searchText
  );

  // SAFETY: Always sort by sequenceNumber, never timestamps
  // Use ASC for afterSeq (catch-up), DESC for beforeSeq (pagination)
  const sort = buildHistorySort(params.beforeTimestamp !== undefined, params.afterSeq !== undefined);

  // Fetch limit + 1 to check if more pages exist
  const rawMessages = await fetchMessages(query, sort, params.limit + 1);

  const result = processHistoryResults(rawMessages, params.limit, params.searchText);

  return result;
}

/**
 * Helper for reconnection compatibility.
 * Fetches messages AFTER lastSeenSeq for catch-up.
 * This complements WebSocket resync (which handles sequence gaps).
 *
 * SAFETY GUARDRAIL:
 * =================
 * This function MUST use afterSeq only (never beforeSeq).
 * It is specifically for reconnect/resync path, not user scroll/history.
 * Mixing beforeSeq and afterSeq causes ambiguous queries and duplicates.
 *
 * DIFFERENCE FROM WEBSOCKET RESYNC:
 * =================================
 * - WebSocket resync: computeMissingMessages() finds gaps (seq > lastKnownSeq)
 * - HTTP history: fetchMessagesAfterSeq() fetches historical messages (seq > lastSeenSeq)
 * - No duplication: WebSocket handles real-time delivery,
 *   HTTP handles historical browsing/catch-up
 *
 * @param {string} chatId
 * @param {number} lastSeenSeq
 * @param {number} limit
 * @param {Function} fetchMessages - async function(query, sort, limit) => Promise<Array<object>>
 * @returns {Promise<Array<object>>}
 */
async function fetchMessagesAfterSeq(chatId, lastSeenSeq, limit, fetchMessages) {
  if (!isNonEmptyString(chatId)) return [];
  if (!isSafeNonNegativeInteger(lastSeenSeq)) return [];
  if (!isPositiveInteger(limit)) return [];
  if (typeof fetchMessages !== 'function') return [];

  // SAFETY: Use afterSeq only (reconnect/resync path)
  // Do NOT mix with beforeSeq (user scroll/history path)
  const query = buildHistoryQuery(chatId, undefined, undefined, lastSeenSeq, undefined);
  // Query already has sequenceNumber: { $gt: lastSeenSeq } from buildHistoryQuery

  // SAFETY: Sort by sequenceNumber ASC for catch-up (never timestamps)
  const sort = buildHistorySort(false, true); // ASC for forward catch-up

  const rawMessages = await fetchMessages(query, sort, limit);
  return filterHistoryMessages(rawMessages, undefined, undefined);
}

module.exports = {
  // Constants
  CHAT_TYPE_DIRECT,
  CHAT_TYPE_ROOM,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  // Errors
  InvalidHistoryQueryError,
  // Main API
  validateHistoryParams,
  buildHistoryQuery,
  buildHistorySort,
  processHistoryResults,
  retrieveHistory,
  // Reconnection compatibility
  fetchMessagesAfterSeq,
  // Helpers (exported for testing)
  filterHistoryMessages,
  reverseForClient,
  matchesTextSearch,
  isMessageExpired,
};
/**
 * history.http.js
 *
 * HTTP-based searchable message history retrieval logic.
 * This module provides read-only access to message history via HTTP endpoints.
 *
 * SEPARATION FROM WEBSOCKET DELIVERY:
 * ====================================
 * This endpoint is SEPARATE from WebSocket delivery for these reasons:
 *
 * 1. Different use cases:
 *    - WebSocket: Real-time delivery of NEW messages (push)
 *    - HTTP History: Browsing PAST messages (pull)
 *
 * 2. Avoids duplication:
 *    - WebSocket delivers messages as they arrive (sequence-based)
 *    - HTTP history queries stored messages (cursor-based pagination)
 *    - No overlap: WebSocket handles delivery state transitions,
 *      HTTP history only reads current state
 *
 * 3. Ordering guarantees:
 *    - WebSocket: Ordered by sequenceNumber (ascending) for delivery
 *    - HTTP History: Ordered by sequenceNumber (descending) for pagination,
 *      then reversed for client rendering (ascending)
 *    - Both use sequenceNumber as source of truth, ensuring consistency
 *
 * 4. Reconnection compatibility:
 *    - WebSocket resync uses computeMissingMessages() (sequence gaps)
 *    - HTTP history can fetch messages AFTER lastSeenSeq for catch-up
 *    - No duplication: WebSocket resync handles real-time gaps,
 *      HTTP history handles historical browsing
 *
 * This endpoint does NOT:
 * - Mutate delivery state (sent/delivered/read)
 * - Trigger delivery state transitions
 * - Mark messages as read automatically
 * - Duplicate WebSocket resend logic
 *
 * It ONLY:
 * - Reads message history from storage
 * - Filters by chatId, sequenceNumber, timestamp
 * - Performs text search
 * - Respects TTL expiration
 * - Returns delivery state (read-only)
 */

const delivery = require('./delivery.logic.js');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CHAT_TYPE_DIRECT = 'direct';
const CHAT_TYPE_ROOM = 'room';

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Error thrown when history query parameters are invalid.
 * HTTP handlers MUST return 400 Bad Request when this error is thrown.
 */
class InvalidHistoryQueryError extends Error {
  constructor(reason, message = 'Invalid history query') {
    super(message + ': ' + reason);
    this.name = 'InvalidHistoryQueryError';
    this.reason = reason;
    this.httpStatus = 400; // HTTP handlers MUST return 400 Bad Request
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isSafeNonNegativeInteger(value) {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    Number.isSafeInteger(value)
  );
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isPositiveInteger(value) {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value > 0 &&
    Number.isSafeInteger(value)
  );
}

/**
 * Validates chatType parameter.
 *
 * @param {unknown} chatType
 * @returns {boolean}
 */
function isValidChatType(chatType) {
  return chatType === CHAT_TYPE_DIRECT || chatType === CHAT_TYPE_ROOM;
}

/**
 * Checks if a message has expired based on TTL metadata.
 * Uses delivery logic's expiration check.
 *
 * @param {{ expiresAt?: number, [key: string]: unknown }} message
 * @param {number} [now] - optional current timestamp (defaults to now)
 * @returns {boolean}
 */
function isMessageExpired(message, now) {
  return delivery.isMessageExpired(message, now);
}

/**
 * Performs case-insensitive text search on message content/payload.
 *
 * @param {{ content?: string, payload?: unknown, [key: string]: unknown }} message
 * @param {string} searchText
 * @returns {boolean}
 */
function matchesTextSearch(message, searchText) {
  if (!isNonEmptyString(searchText)) return true;
  const searchLower = searchText.toLowerCase().trim();
  if (searchLower.length === 0) return true;

  // Search in content field
  if (typeof message.content === 'string') {
    if (message.content.toLowerCase().includes(searchLower)) return true;
  }

  // Search in payload (if string or JSON-serializable)
  if (message.payload !== undefined) {
    let payloadText = '';
    if (typeof message.payload === 'string') {
      payloadText = message.payload;
    } else if (typeof message.payload === 'object' && message.payload !== null) {
      try {
        payloadText = JSON.stringify(message.payload);
      } catch (_) {
        payloadText = String(message.payload);
      }
    } else {
      payloadText = String(message.payload);
    }
    if (payloadText.toLowerCase().includes(searchLower)) return true;
  }

  return false;
}

/**
 * Gets sequenceNumber from a message, or returns -1 if missing/invalid.
 *
 * @param {{ sequenceNumber?: number, [key: string]: unknown }} message
 * @returns {number}
 */
function getSequenceNumber(message) {
  if (typeof message.sequenceNumber === 'number' && Number.isInteger(message.sequenceNumber) && message.sequenceNumber >= 0) {
    return message.sequenceNumber;
  }
  return -1;
}

/**
 * Gets timestamp from a message (createdAt or updatedAt), or returns -1 if missing/invalid.
 *
 * @param {{ createdAt?: number, updatedAt?: number, [key: string]: unknown }} message
 * @returns {number}
 */
function getMessageTimestamp(message) {
  if (typeof message.createdAt === 'number' && isSafeNonNegativeInteger(message.createdAt)) {
    return message.createdAt;
  }
  if (typeof message.updatedAt === 'number' && isSafeNonNegativeInteger(message.updatedAt)) {
    return message.updatedAt;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Query Building (MongoDB-style)
// ---------------------------------------------------------------------------

/**
 * Builds MongoDB query filter for history retrieval.
 * Returns query object that can be used with MongoDB find().
 *
 * SAFETY GUARDRAILS:
 * ==================
 * - sequenceNumber is the ONLY ordering key (timestamps never used for sorting)
 * - beforeSeq and afterSeq are mutually exclusive (enforced in validateHistoryParams)
 *
 * MONGODB INDEX REQUIREMENTS:
 * ===========================
 * 1. Compound index: { chatId: 1, sequenceNumber: -1 }
 *    - PRIMARY index for all queries
 *    - Enables efficient pagination by sequenceNumber (DESC for backward pagination)
 *    - Enables efficient catch-up by sequenceNumber (ASC for forward catch-up)
 *
 * 2. Compound index: { chatId: 1, sequenceNumber: 1 }
 *    - For forward catch-up queries (afterSeq, ASC ordering)
 *    - Alternative: use { chatId: 1, sequenceNumber: -1 } with reverse scan
 *
 * 3. TTL index: { expiresAt: 1 }
 *    - Automatically removes expired messages
 *    - Must be sparse (only documents with expiresAt)
 *    - NOTE: TTL expiration may cause sequenceNumber gaps (see TTL GAPS comment below)
 *
 * 4. Text index: { content: 'text', 'payload.text': 'text' }
 *    - Enables full-text search (optional, for better performance)
 *    - Alternative: use regex on indexed fields for simple case-insensitive search
 *
 * TTL GAPS WARNING:
 * =================
 * When messages expire due to TTL, sequenceNumber gaps will occur naturally.
 * Example: If messages with seq 5, 6, 7 exist and message 6 expires, there will be a gap.
 * This is EXPECTED BEHAVIOR and must NOT be "fixed" by:
 * - Renumbering sequenceNumbers
 * - Filling gaps with placeholder messages
 * - Changing query logic to skip gaps
 * Gaps are a natural consequence of TTL expiration and must be preserved for correctness.
 *
 * @param {string} chatId
 * @param {number} [beforeSeq] - cursor: sequenceNumber < beforeSeq (user scroll/history)
 * @param {number} [beforeTimestamp] - cursor: createdAt < beforeTimestamp (deprecated, display only)
 * @param {number} [afterSeq] - cursor: sequenceNumber > afterSeq (reconnect/resync catch-up)
 * @param {string} [searchText] - optional text search
 * @returns {object}
 */
function buildHistoryQuery(chatId, beforeSeq, beforeTimestamp, afterSeq, searchText) {
  const query = {
    chatId: chatId,
  };

  // TTL + PAGINATION HOLES NOTE:
  // =============================
  // Ephemeral messages are subject to TTL expiration.
  // This may cause intentional gaps in message history.
  // Such gaps are expected and by design.
  // Example: If messages with sequenceNumber 5, 6, 7 exist and message 6 expires,
  // the result set will contain [5, 7] with a gap at 6. This is correct behavior.
  // Do NOT attempt to fill gaps, renumber sequenceNumbers, or modify query logic.

  // Cursor-based pagination: beforeSeq OR afterSeq (mutually exclusive, enforced in validateHistoryParams)
  if (afterSeq !== undefined && isSafeNonNegativeInteger(afterSeq)) {
    // GUARDRAIL: Reconnect/resync path ONLY - fetch messages AFTER lastSeenSeq (forward catch-up)
    query.sequenceNumber = { $gt: afterSeq };
  } else if (beforeSeq !== undefined && isSafeNonNegativeInteger(beforeSeq)) {
    // GUARDRAIL: User scroll/history path ONLY - fetch messages BEFORE cursor (backward pagination)
    query.sequenceNumber = { $lt: beforeSeq };
  } else if (beforeTimestamp !== undefined && isSafeNonNegativeInteger(beforeTimestamp)) {
    // DEPRECATED: Timestamp-based cursor (kept for backward compatibility)
    // NOTE: Query still filters by sequenceNumber internally, timestamp is display-only
    // This is a legacy feature and should be migrated to beforeSeq
    query.createdAt = { $lt: beforeTimestamp };
  }

  // Text search: if provided, MongoDB will use text index or regex
  // This is handled in-memory after fetch for simplicity (production should use MongoDB $text)
  // For production MongoDB: query.$text = { $search: searchText };

  // TTL: MongoDB TTL index automatically filters expired messages
  // No need to add expiresAt filter here (MongoDB handles it)
  // NOTE: Expired messages create sequenceNumber gaps (see TTL GAPS WARNING above)

  return query;
}

/**
 * Builds MongoDB sort specification for history retrieval.
 *
 * SAFETY GUARDRAIL:
 * =================
 * sequenceNumber is the PRIMARY and ONLY ordering key.
 * Timestamps are NEVER used for sorting (only for display).
 * This ensures consistent ordering across all queries and prevents race conditions.
 *
 * @param {boolean} [useTimestamp] - DEPRECATED: ignored, always sorts by sequenceNumber
 * @param {boolean} [ascending] - if true, sort ASC (for catch-up); otherwise DESC (for pagination)
 * @returns {object}
 */
function buildHistorySort(useTimestamp, ascending) {
  // SAFETY: Always use sequenceNumber for sorting, never timestamps
  // Timestamps are for display only and may have clock skew issues
  if (ascending === true) {
    return { sequenceNumber: 1 }; // ASC for forward catch-up (reconnect/resync)
  }
  return { sequenceNumber: -1 }; // DESC for backward pagination (user scroll/history)
}

// ---------------------------------------------------------------------------
// Result Processing
// ---------------------------------------------------------------------------

/**
 * Filters and processes messages for history response.
 * Applies TTL expiration check and text search in-memory.
 * In production, these should be done in MongoDB query for efficiency.
 *
 * TTL GAPS NOTE:
 * ==============
 * When messages expire due to TTL, they are filtered out here.
 * This creates sequenceNumber gaps in the result set (e.g., seq 5, 7, 8 if seq 6 expired).
 * These gaps are EXPECTED and MUST be preserved - do NOT attempt to fill or renumber.
 * Gaps are a natural consequence of TTL expiration and indicate messages that no longer exist.
 *
 * @param {Array<{ [key: string]: unknown }>} messages
 * @param {string} [searchText] - optional text search
 * @param {number} [now] - optional current timestamp
 * @returns {Array<object>}
 */
function filterHistoryMessages(messages, searchText, now) {
  if (!Array.isArray(messages)) return [];

  const currentTime = now !== undefined ? now : Date.now();
  const result = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg === null || typeof msg !== 'object') continue;

    // TTL expiration check
    // NOTE: Expired messages create sequenceNumber gaps (see TTL GAPS NOTE above)
    if (isMessageExpired(msg, currentTime)) continue;

    // Text search (in-memory; production should use MongoDB $text)
    if (searchText !== undefined && !matchesTextSearch(msg, searchText)) continue;

    result.push(msg);
  }

  return result;
}

/**
 * Reverses message order for client rendering.
 * Messages are fetched DESC (newest first) for pagination,
 * but client needs ASC (oldest first) for chronological display.
 *
 * @param {Array<object>} messages
 * @returns {Array<object>}
 */
function reverseForClient(messages) {
  if (!Array.isArray(messages)) return [];
  const reversed = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    reversed.push(messages[i]);
  }
  return reversed;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validates and normalizes history query parameters.
 *
 * SAFETY GUARDRAILS (MANDATORY):
 * ==============================
 * 1. DUAL-USE GUARDRAIL: Rejects requests with BOTH beforeSeq and afterSeq
 *    - HTTP handlers MUST return 400 Bad Request when InvalidHistoryQueryError is thrown
 *    - User scroll/history path: uses ONLY beforeSeq (backward pagination)
 *    - Reconnect/resync path: uses ONLY afterSeq (forward catch-up)
 *    - Mixing both causes ambiguous query behavior, potential duplicates, and inconsistent results
 *    - Do NOT infer intent automatically - enforce strictly at HTTP boundary
 *
 * 2. ORDERING SOURCE OF TRUTH: sequenceNumber is the ONLY ordering key
 *    - Timestamps are for display only, NEVER for sorting
 *    - This ensures consistent ordering across all queries and prevents race conditions
 *    - All queries MUST be sorted by sequenceNumber (ASC for catch-up, DESC for pagination)
 *
 * @param {unknown} chatType
 * @param {unknown} chatId
 * @param {unknown} beforeSeq
 * @param {unknown} beforeTimestamp
 * @param {unknown} afterSeq
 * @param {unknown} limit
 * @param {unknown} searchText
 * @returns {{ chatType: string, chatId: string, beforeSeq: number | undefined, beforeTimestamp: number | undefined, afterSeq: number | undefined, limit: number, searchText: string | undefined }}
 * @throws {InvalidHistoryQueryError} - HTTP handlers MUST return 400 Bad Request
 */
function validateHistoryParams(chatType, chatId, beforeSeq, beforeTimestamp, afterSeq, limit, searchText) {
  if (!isValidChatType(chatType)) {
    throw new InvalidHistoryQueryError('chatType must be "direct" or "room"');
  }

  if (!isNonEmptyString(chatId)) {
    throw new InvalidHistoryQueryError('chatId must be a non-empty string');
  }

  // SAFETY GUARDRAIL: Reject if BOTH beforeSeq and afterSeq are provided
  // This prevents ambiguous queries, duplicate fetches, and inconsistent results.
  // HTTP handlers MUST return 400 Bad Request when this error is thrown.
  const hasBeforeSeq = beforeSeq !== undefined && beforeSeq !== null;
  const hasAfterSeq = afterSeq !== undefined && afterSeq !== null;
  if (hasBeforeSeq && hasAfterSeq) {
    throw new InvalidHistoryQueryError(
      'Cannot specify both beforeSeq and afterSeq in a single request. ' +
      'Use beforeSeq ONLY for user-driven scroll/history browsing (backward pagination). ' +
      'Use afterSeq ONLY for reconnect/resync catch-up (forward catch-up). ' +
      'Mixing both causes ambiguous query behavior and potential duplicates.'
    );
  }

  // Cursor: beforeSeq OR beforeTimestamp OR afterSeq (mutually exclusive)
  let normalizedBeforeSeq = undefined;
  let normalizedBeforeTimestamp = undefined;
  let normalizedAfterSeq = undefined;

  if (hasBeforeSeq) {
    // GUARDRAIL: beforeSeq is ONLY for user scroll/history browsing (backward pagination)
    // Do NOT use for reconnect/resync - use afterSeq instead
    if (!isSafeNonNegativeInteger(beforeSeq)) {
      throw new InvalidHistoryQueryError('beforeSeq must be a non-negative integer');
    }
    normalizedBeforeSeq = beforeSeq;
  } else if (hasAfterSeq) {
    // GUARDRAIL: afterSeq is ONLY for reconnect/resync catch-up (forward catch-up)
    // Do NOT use for user scroll/history - use beforeSeq instead
    if (!isSafeNonNegativeInteger(afterSeq)) {
      throw new InvalidHistoryQueryError('afterSeq must be a non-negative integer');
    }
    normalizedAfterSeq = afterSeq;
  } else if (beforeTimestamp !== undefined && beforeTimestamp !== null) {
    // DEPRECATED: Timestamp-based pagination (kept for backward compatibility)
    // NOTE: Sorting still uses sequenceNumber, timestamp is only for cursor
    if (!isSafeNonNegativeInteger(beforeTimestamp)) {
      throw new InvalidHistoryQueryError('beforeTimestamp must be a non-negative integer');
    }
    normalizedBeforeTimestamp = beforeTimestamp;
  }

  // Limit: default 30, max 100
  let normalizedLimit = DEFAULT_LIMIT;
  if (limit !== undefined && limit !== null) {
    if (!isPositiveInteger(limit)) {
      throw new InvalidHistoryQueryError('limit must be a positive integer');
    }
    normalizedLimit = Math.min(limit, MAX_LIMIT);
  }

  // Search text: optional, trim whitespace
  let normalizedSearchText = undefined;
  if (searchText !== undefined && searchText !== null) {
    if (typeof searchText !== 'string') {
      throw new InvalidHistoryQueryError('searchText must be a string');
    }
    const trimmed = searchText.trim();
    if (trimmed.length > 0) {
      normalizedSearchText = trimmed;
    }
  }

  return {
    chatType,
    chatId,
    beforeSeq: normalizedBeforeSeq,
    beforeTimestamp: normalizedBeforeTimestamp,
    afterSeq: normalizedAfterSeq,
    limit: normalizedLimit,
    searchText: normalizedSearchText,
  };
}

/**
 * Processes history query results for HTTP response.
 * This function would be called after fetching from MongoDB.
 *
 * MONGODB QUERY EXAMPLE:
 * ======================
 * const query = buildHistoryQuery(chatId, beforeSeq, beforeTimestamp, searchText);
 * const sort = buildHistorySort(beforeTimestamp !== undefined);
 * const messages = await db.messages
 *   .find(query)
 *   .sort(sort)
 *   .limit(limit + 1) // Fetch one extra to check if more pages exist
 *   .toArray();
 *
 * @param {Array<{ [key: string]: unknown }>} messages - raw messages from MongoDB
 * @param {number} requestedLimit - requested limit (before +1 for pagination check)
 * @param {string} [searchText] - optional text search (for in-memory filtering)
 * @param {number} [now] - optional current timestamp (for TTL check)
 * @returns {{ messages: Array<object>, hasMore: boolean, nextCursor: { seq: number | null, timestamp: number | null } }}
 */
function processHistoryResults(messages, requestedLimit, searchText, now) {
  if (!Array.isArray(messages)) {
    return { messages: [], hasMore: false, nextCursor: { seq: null, timestamp: null } };
  }

  // Filter: TTL expiration and text search
  const filtered = filterHistoryMessages(messages, searchText, now);

  // Check if more pages exist (we fetched limit + 1)
  const hasMore = filtered.length > requestedLimit;
  const resultMessages = hasMore ? filtered.slice(0, requestedLimit) : filtered;

  // Reverse for client (DESC -> ASC)
  const reversed = reverseForClient(resultMessages);

  // Build next cursor from oldest message (first in reversed array)
  // This is the message with the smallest sequenceNumber/timestamp
  // Next page will fetch messages BEFORE this cursor
  let nextCursor = { seq: null, timestamp: null };
  if (reversed.length > 0) {
    const oldestMsg = reversed[0]; // First element is oldest (smallest seq/timestamp)
    const seq = getSequenceNumber(oldestMsg);
    const timestamp = getMessageTimestamp(oldestMsg);
    if (seq !== -1) {
      nextCursor.seq = seq;
    }
    if (timestamp !== -1) {
      nextCursor.timestamp = timestamp;
    }
  }

  return {
    messages: reversed,
    hasMore,
    nextCursor,
  };
}

/**
 * Main history retrieval logic.
 * This function orchestrates the history query flow.
 *
 * SAFETY GUARDRAILS:
 * ==================
 * - Enforces sequenceNumber-only sorting (never timestamps)
 * - Uses appropriate sort direction based on query type (beforeSeq vs afterSeq)
 *
 * USAGE IN HTTP HANDLER:
 * ======================
 * GET /api/messages/history?chatType=direct&chatId=user123&beforeSeq=100&limit=30&searchText=hello
 *
 * const params = validateHistoryParams(
 *   req.query.chatType,
 *   req.query.chatId,
 *   req.query.beforeSeq,
 *   req.query.beforeTimestamp,
 *   req.query.afterSeq,
 *   req.query.limit,
 *   req.query.searchText
 * );
 *
 * const query = buildHistoryQuery(params.chatId, params.beforeSeq, params.beforeTimestamp, params.afterSeq, params.searchText);
 * const sort = buildHistorySort(params.beforeTimestamp !== undefined, params.afterSeq !== undefined);
 * const rawMessages = await db.messages.find(query).sort(sort).limit(params.limit + 1).toArray();
 *
 * const result = processHistoryResults(rawMessages, params.limit, params.searchText);
 * res.json(result);
 *
 * @param {object} params - validated parameters from validateHistoryParams()
 * @param {Function} fetchMessages - async function(query, sort, limit) => Promise<Array<object>>
 * @returns {Promise<{ messages: Array<object>, hasMore: boolean, nextCursor: { seq: number | null, timestamp: number | null } }>}
 */
async function retrieveHistory(params, fetchMessages) {
  if (typeof fetchMessages !== 'function') {
    throw new Error('fetchMessages must be a function');
  }

  const query = buildHistoryQuery(
    params.chatId,
    params.beforeSeq,
    params.beforeTimestamp,
    params.afterSeq,
    params.searchText
  );

  // SAFETY: Always sort by sequenceNumber, never timestamps
  // Use ASC for afterSeq (catch-up), DESC for beforeSeq (pagination)
  const sort = buildHistorySort(params.beforeTimestamp !== undefined, params.afterSeq !== undefined);

  // Fetch limit + 1 to check if more pages exist
  const rawMessages = await fetchMessages(query, sort, params.limit + 1);

  const result = processHistoryResults(rawMessages, params.limit, params.searchText);

  return result;
}

/**
 * Helper for reconnection compatibility.
 * Fetches messages AFTER lastSeenSeq for catch-up.
 * This complements WebSocket resync (which handles sequence gaps).
 *
 * SAFETY GUARDRAIL:
 * =================
 * This function MUST use afterSeq only (never beforeSeq).
 * It is specifically for reconnect/resync path, not user scroll/history.
 * Mixing beforeSeq and afterSeq causes ambiguous queries and duplicates.
 *
 * DIFFERENCE FROM WEBSOCKET RESYNC:
 * =================================
 * - WebSocket resync: computeMissingMessages() finds gaps (seq > lastKnownSeq)
 * - HTTP history: fetchMessagesAfterSeq() fetches historical messages (seq > lastSeenSeq)
 * - No duplication: WebSocket handles real-time delivery,
 *   HTTP handles historical browsing/catch-up
 *
 * @param {string} chatId
 * @param {number} lastSeenSeq
 * @param {number} limit
 * @param {Function} fetchMessages - async function(query, sort, limit) => Promise<Array<object>>
 * @returns {Promise<Array<object>>}
 */
async function fetchMessagesAfterSeq(chatId, lastSeenSeq, limit, fetchMessages) {
  if (!isNonEmptyString(chatId)) return [];
  if (!isSafeNonNegativeInteger(lastSeenSeq)) return [];
  if (!isPositiveInteger(limit)) return [];
  if (typeof fetchMessages !== 'function') return [];

  // SAFETY: Use afterSeq only (reconnect/resync path)
  // Do NOT mix with beforeSeq (user scroll/history path)
  const query = buildHistoryQuery(chatId, undefined, undefined, lastSeenSeq, undefined);
  // Query already has sequenceNumber: { $gt: lastSeenSeq } from buildHistoryQuery

  // SAFETY: Sort by sequenceNumber ASC for catch-up (never timestamps)
  const sort = buildHistorySort(false, true); // ASC for forward catch-up

  const rawMessages = await fetchMessages(query, sort, limit);
  return filterHistoryMessages(rawMessages, undefined, undefined);
}

module.exports = {
  // Constants
  CHAT_TYPE_DIRECT,
  CHAT_TYPE_ROOM,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  // Errors
  InvalidHistoryQueryError,
  // Main API
  validateHistoryParams,
  buildHistoryQuery,
  buildHistorySort,
  processHistoryResults,
  retrieveHistory,
  // Reconnection compatibility
  fetchMessagesAfterSeq,
  // Helpers (exported for testing)
  filterHistoryMessages,
  reverseForClient,
  matchesTextSearch,
  isMessageExpired,
};
