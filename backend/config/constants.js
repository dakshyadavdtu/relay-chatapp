'use strict';

/**
 * Centralized Configuration Module
 * 
 * All configurable values for the WebSocket server.
 * Values can be overridden via environment variables.
 * 
 * No external dependencies - uses only Node.js built-ins
 */

/**
 * HTTP server listen port.
 * B1: In dev, default 8000 so Vite proxy (default 8000) matches without setting VITE_BACKEND_PORT.
 * @type {number}
 */
const PORT = parseInt(
  process.env.PORT || (process.env.NODE_ENV === 'development' ? '8000' : '3001'),
  10
);

/**
 * Cookie name for access token (JWT). Behavioral default.
 * @type {string}
 */
const JWT_COOKIE_NAME = process.env.JWT_COOKIE_NAME || 'token';

/**
 * Cookie name for refresh token (opaque). Phase 2.
 * @type {string}
 */
const REFRESH_COOKIE_NAME = process.env.REFRESH_COOKIE_NAME || 'refresh_token';

/**
 * Phase 2 auth: access token TTL (seconds). Short-lived JWT in cookie.
 * @type {number}
 */
const ACCESS_TOKEN_EXPIRES_IN_SECONDS = parseInt(
  process.env.ACCESS_TOKEN_EXPIRES_IN_SECONDS || '900',
  10
); // 15 min default

/**
 * Phase 2 auth: refresh token TTL (seconds). Long-lived opaque cookie.
 * @type {number}
 */
const REFRESH_TOKEN_EXPIRES_IN_SECONDS = parseInt(
  process.env.REFRESH_TOKEN_EXPIRES_IN_SECONDS || '604800',
  10
); // 7 days default

/**
 * Phase 2 auth: pepper for hashing refresh tokens. sha256(token + REFRESH_PEPPER).
 * In production must be set and non-empty; empty allowed for dev/test.
 * @type {string}
 */
const REFRESH_PEPPER = (function () {
  const raw = process.env.REFRESH_PEPPER != null ? String(process.env.REFRESH_PEPPER) : '';
  const trimmed = raw.trim();
  if (process.env.NODE_ENV === 'production' && trimmed === '') {
    throw new Error('REFRESH_PEPPER is required in prod and non-empty');
  }
  return trimmed;
})();

/**
 * Protocol version
 * Increment this when making breaking protocol changes
 * @type {string}
 */
const PROTOCOL_VERSION = process.env.WS_PROTOCOL_VERSION || '1.0.0';

/**
 * Rate limiting configuration
 */
const RATE_LIMIT = {
  // Maximum messages per window
  maxMessages: parseInt(process.env.WS_RATE_LIMIT_MESSAGES || '100', 10),
  // Time window in milliseconds
  windowMs: parseInt(process.env.WS_RATE_LIMIT_WINDOW_MS || '60000', 10), // 1 minute
  // Stricter cap for sensitive room actions (create/delete/promote/remove) per window
  maxSensitiveRoomActionsPerWindow: parseInt(process.env.WS_RATE_LIMIT_SENSITIVE_ROOM_ACTIONS || '20', 10),
  // Warning threshold (percentage of maxMessages)
  warningThreshold: parseFloat(process.env.WS_RATE_LIMIT_WARNING_THRESHOLD || '0.8', 10), // 80%
  // Violations before throttling (after warning)
  violationsBeforeThrottle: parseInt(process.env.WS_VIOLATIONS_BEFORE_THROTTLE || '2', 10),
  // Violations before connection closure (PHASE 4: throttle first, close only after sustained abuse)
  maxViolations: parseInt(process.env.WS_MAX_VIOLATIONS || '5', 10),
  // PHASE 4: Close only after this many violations in window (e.g. 10 in 60s); below this we send ERROR only
  violationsBeforeClose: parseInt(process.env.WS_VIOLATIONS_BEFORE_CLOSE || '10', 10),
};

/**
 * Payload size limits
 */
const PAYLOAD = {
  // Maximum payload size in bytes (default: 1MB)
  maxSize: parseInt(process.env.WS_MAX_PAYLOAD_SIZE || '1048576', 10),
};

/**
 * Root admin identity. Single source of truth; do not check email/username elsewhere.
 * Only this identity is treated as root; protected from ban, revoke, role change, etc.
 * ROOT_ADMIN_EMAIL: set via env (e.g. dakshyadavproject@gmail.com); empty = no root.
 * ROOT_ADMIN_USERNAME: default daksh_root; used for bootstrap and isRootUser().
 */
const ROOT_ADMIN_EMAIL = (process.env.ROOT_ADMIN_EMAIL || '').trim().toLowerCase();
const ROOT_ADMIN_USERNAME = (process.env.ROOT_ADMIN_USERNAME || 'daksh_root').trim().toLowerCase();

/**
 * Backpressure configuration
 */
const BACKPRESSURE = {
  // Threshold (number of pending sends) before dropping messages
  threshold: parseInt(process.env.WS_BACKPRESSURE_THRESHOLD || '100', 10),
  // Maximum queue size before closing slow socket
  maxQueueSize: parseInt(process.env.WS_BACKPRESSURE_MAX_QUEUE || '200', 10),
  // Buffered amount threshold (bytes) to consider socket slow
  bufferedAmountThreshold: parseInt(process.env.WS_BACKPRESSURE_BUFFERED_THRESHOLD || '1048576', 10), // 1MB
  // Maximum consecutive queue overflows before closing socket
  maxQueueOverflows: parseInt(process.env.WS_BACKPRESSURE_MAX_OVERFLOWS || '5', 10),
};

/**
 * Heartbeat configuration
 */
const HEARTBEAT = {
  // Interval between heartbeat checks in milliseconds
  interval: parseInt(process.env.WS_HEARTBEAT_INTERVAL || '30000', 10), // 30 seconds
  // Timeout before marking connection as dead
  timeout: parseInt(process.env.WS_HEARTBEAT_TIMEOUT || '60000', 10), // 60 seconds
};

/**
 * Server configuration
 */
const SERVER = {
  // Graceful shutdown timeout in milliseconds
  shutdownTimeout: parseInt(process.env.WS_SHUTDOWN_TIMEOUT || '10000', 10), // 10 seconds
  // Maximum number of connections (0 = unlimited)
  maxConnections: parseInt(process.env.WS_MAX_CONNECTIONS || '0', 10),
  // Maximum connections per user (0 = unlimited)
  maxConnectionsPerUser: parseInt(process.env.WS_MAX_CONNECTIONS_PER_USER || '5', 10),
  // Maximum connections per IP (0 = unlimited)
  maxConnectionsPerIp: parseInt(process.env.WS_MAX_CONNECTIONS_PER_IP || '50', 10),
};

/** When true, emit info-level logs for admin report details (context window, etc.). Otherwise debug-level only; no message content ever logged. */
const ADMIN_REPORTS_DEBUG = process.env.ADMIN_REPORTS_DEBUG === 'true';

/** Max WebSocket connections per sessionId (per device/tab). Excess closed with 4002 "Too many tabs". */
const MAX_SOCKETS_PER_SESSION = parseInt(process.env.WS_MAX_SOCKETS_PER_SESSION || '3', 10);

/** Grace window (ms) before emitting OFFLINE after last socket closes; reconnect within window cancels OFFLINE. */
const PRESENCE_OFFLINE_GRACE_MS = parseInt(process.env.PRESENCE_OFFLINE_GRACE_MS || '1200', 10);

/**
 * Logging configuration
 */
const LOGGING = {
  // Log level: 'debug', 'info', 'warn', 'error'
  level: process.env.WS_LOG_LEVEL || 'info',
  // Enable structured JSON logging
  json: process.env.WS_LOG_JSON === 'true',
};

/**
 * Message content limit (must match frontend wsContract MAX_CONTENT_LENGTH)
 */
const MAX_CONTENT_LENGTH = parseInt(process.env.WS_MAX_CONTENT_LENGTH || '10000', 10);

/** Search read-after-write: recent fallback window (minutes) and max messages to scan. */
const SEARCH_RECENT_FALLBACK_MINUTES = parseInt(process.env.SEARCH_RECENT_FALLBACK_MINUTES || '2', 10);
const SEARCH_RECENT_FALLBACK_MAX = parseInt(process.env.SEARCH_RECENT_FALLBACK_MAX || '200', 10);

/** Max length for room display name (metadata). */
const MAX_ROOM_NAME_LENGTH = parseInt(process.env.WS_MAX_ROOM_NAME_LENGTH || '200', 10);
/** Max length for room thumbnail URL (metadata). */
const MAX_THUMBNAIL_URL_LENGTH = parseInt(process.env.WS_MAX_THUMBNAIL_URL_LENGTH || '2048', 10);

/**
 * Room configuration
 */
const ROOMS = {
  // Maximum number of rooms (0 = unlimited)
  maxRooms: parseInt(process.env.WS_MAX_ROOMS || '0', 10),
  // Maximum members per room (0 = unlimited)
  maxMembersPerRoom: parseInt(process.env.WS_MAX_MEMBERS_PER_ROOM || '0', 10),
  // Auto-create room on join if it doesn't exist
  autoCreate: process.env.WS_ROOM_AUTO_CREATE !== 'false',
  // Auto-delete empty rooms
  autoDeleteEmpty: process.env.WS_ROOM_AUTO_DELETE_EMPTY !== 'false',
  // Do not remove user from rooms on WS disconnect (refresh/tab close). Set to true only for explicit "leave on disconnect" behavior.
  leaveOnDisconnect: process.env.WS_ROOM_LEAVE_ON_DISCONNECT === 'true',
};

module.exports = {
  PORT,
  ROOT_ADMIN_EMAIL,
  ROOT_ADMIN_USERNAME,
  JWT_COOKIE_NAME,
  REFRESH_COOKIE_NAME,
  ACCESS_TOKEN_EXPIRES_IN_SECONDS,
  REFRESH_TOKEN_EXPIRES_IN_SECONDS,
  REFRESH_PEPPER,
  PROTOCOL_VERSION,
  RATE_LIMIT,
  PAYLOAD,
  BACKPRESSURE,
  HEARTBEAT,
  SERVER,
  LOGGING,
  ADMIN_REPORTS_DEBUG,
  MAX_SOCKETS_PER_SESSION,
  PRESENCE_OFFLINE_GRACE_MS,
  ROOMS,
  MAX_CONTENT_LENGTH,
  MAX_ROOM_NAME_LENGTH,
  MAX_THUMBNAIL_URL_LENGTH,
  SEARCH_RECENT_FALLBACK_MINUTES,
  SEARCH_RECENT_FALLBACK_MAX,
};
