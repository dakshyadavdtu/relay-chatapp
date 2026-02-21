'use strict';

/**
 * This file defines the IMMUTABLE production environment contract.
 * AWS deployment correctness depends on this contract remaining stable.
 * Any change here MUST be reviewed as a breaking change.
 *
 * Startup env validation. Runs once after env load, before app.
 * Throws on invalid type or bounds. Never logs secrets or values.
 * If NODE_ENV === 'production' and any required var is missing: console.error + process.exit(1).
 * ZERO silent defaults in production. Dev-only defaults allowed only when NODE_ENV !== 'production'.
 */
function validateEnv() {
  const v = process.env;
  const isProduction = v.NODE_ENV === 'production';

  // --- DEV_TOKEN_MODE: must never run in production ---
  const devTokenEnabled = v.DEV_TOKEN_MODE === 'true';
  if (isProduction && devTokenEnabled) {
    console.error('DEV_TOKEN_MODE must never be enabled in production.');
    process.exit(1);
  }

  // --- DB_URI: required for all environments; Atlas-only unless dev + ALLOW_LOCAL_DB ---
  const dbUri = v.DB_URI;
  if (dbUri === undefined || typeof dbUri !== 'string' || dbUri.trim() === '') {
    console.error('DB_URI is required and must be a non-empty string. Backend is Atlas-only.');
    process.exit(1);
  }
  const uriTrim = dbUri.trim().toLowerCase();
  const allowLocalDb = v.NODE_ENV === 'development' && v.ALLOW_LOCAL_DB === 'true';
  if (uriTrim.includes('localhost') || uriTrim.includes('127.0.0.1')) {
    if (!allowLocalDb) {
      console.error('DB_URI must not point to localhost/127.0.0.1 unless NODE_ENV=development and ALLOW_LOCAL_DB=true.');
      process.exit(1);
    }
  }
  if (uriTrim.startsWith('mongodb://') && !uriTrim.startsWith('mongodb+srv://')) {
    if (!allowLocalDb) {
      console.error('DB_URI must use Atlas SRV (mongodb+srv://) unless NODE_ENV=development and ALLOW_LOCAL_DB=true.');
      process.exit(1);
    }
  }
  if (isProduction && !uriTrim.startsWith('mongodb+srv://')) {
    console.error('In production DB_URI must start with mongodb+srv:// (Atlas).');
    process.exit(1);
  }

  // --- Production: hard required (no silent defaults) ---
  // Prod required (keep in sync with .env.example + docs): NODE_ENV, PORT, JWT_SECRET, DB_URI, REFRESH_PEPPER, WS_PATH (+ at least one of CORS_ORIGIN, CORS_ORIGINS, or CORS_ORIGIN_PATTERNS). COOKIE_DOMAIN not required (host-only cookies).
  if (isProduction) {
    const required = ['NODE_ENV', 'PORT', 'JWT_SECRET', 'DB_URI', 'REFRESH_PEPPER', 'WS_PATH'];
    for (const name of required) {
      const val = v[name];
      if (val === undefined || val === '' || (typeof val === 'string' && val.trim() === '')) {
        console.error('Missing required environment variable for production: ' + name);
        process.exit(1);
      }
    }
    // At least one of CORS_ORIGIN, CORS_ORIGINS, or CORS_ORIGIN_PATTERNS must be set (non-empty)
    const corsOriginsRaw = (v.CORS_ORIGINS || '').trim();
    const corsOriginRaw = (v.CORS_ORIGIN || '').trim();
    const corsOriginPatternsRaw = (v.CORS_ORIGIN_PATTERNS || '').trim();
    const originStrings = corsOriginsRaw
      ? corsOriginsRaw.split(',').map((s) => s.trim()).filter(Boolean)
      : corsOriginRaw
        ? [corsOriginRaw.trim()]
        : [];
    const patternStrings = corsOriginPatternsRaw
      ? corsOriginPatternsRaw.split(',').map((s) => s.trim()).filter(Boolean)
      : [];
    const hasOrigins = originStrings.length > 0;
    const hasPatterns = patternStrings.length > 0;
    if (!hasOrigins && !hasPatterns) {
      console.error('Missing required for production: at least one of CORS_ORIGIN, CORS_ORIGINS, or CORS_ORIGIN_PATTERNS must be set.');
      process.exit(1);
    }
    const { validateOriginFormat, validateOriginPatternString } = require('./origins');
    for (const origin of originStrings) {
      if (!validateOriginFormat(origin)) {
        console.error('CORS_ORIGIN / CORS_ORIGINS entry must be an origin only, e.g. https://app.com (no path/query/hash).');
        process.exit(1);
      }
    }
    for (const pattern of patternStrings) {
      if (!validateOriginPatternString(pattern)) {
        console.error('CORS_ORIGIN_PATTERNS entry must be one of the allowed pattern strings (see config/origins.js).');
        process.exit(1);
      }
    }
  }

  // --- Category A: critical ---
  const jwtSecret = v.JWT_SECRET;
  if (jwtSecret === undefined || typeof jwtSecret !== 'string' || jwtSecret.trim() === '') {
    throw new Error('JWT_SECRET is required and must be a non-empty string.');
  }

  // --- Category B: behavioral (type + bounds when set) ---
  if (v.PORT !== undefined && v.PORT !== '') {
    const port = parseInt(v.PORT, 10);
    if (!Number.isFinite(port) || port < 1 || port > 65535) {
      throw new Error('PORT must be a positive integer between 1 and 65535.');
    }
  }

  if (v.JWT_COOKIE_NAME !== undefined && v.JWT_COOKIE_NAME !== '') {
    if (typeof v.JWT_COOKIE_NAME !== 'string' || v.JWT_COOKIE_NAME.trim() === '') {
      throw new Error('JWT_COOKIE_NAME must be a non-empty string.');
    }
  }

  const numericBounds = [
    ['WS_RATE_LIMIT_MESSAGES', 1, 1e7],
    ['WS_RATE_LIMIT_WINDOW_MS', 1, 86400000],
    ['WS_RATE_LIMIT_WARNING_THRESHOLD', 0, 1],
    ['WS_VIOLATIONS_BEFORE_THROTTLE', 0, 1000],
    ['WS_MAX_VIOLATIONS', 0, 1000],
    ['WS_MAX_PAYLOAD_SIZE', 1, 1e9],
    ['WS_BACKPRESSURE_THRESHOLD', 0, 1e6],
    ['WS_BACKPRESSURE_MAX_QUEUE', 0, 1e6],
    ['WS_BACKPRESSURE_BUFFERED_THRESHOLD', 0, 1e9],
    ['WS_BACKPRESSURE_MAX_OVERFLOWS', 0, 1000],
    ['WS_HEARTBEAT_INTERVAL', 1, 86400000],
    ['WS_HEARTBEAT_TIMEOUT', 1, 86400000],
    ['WS_SHUTDOWN_TIMEOUT', 0, 3600000],
    ['WS_MAX_CONNECTIONS', 0, 1e7],
    ['WS_MAX_CONNECTIONS_PER_USER', 0, 1e7],
    ['WS_MAX_CONNECTIONS_PER_IP', 0, 1e7],
    ['WS_MAX_ROOMS', 0, 1e7],
    ['WS_MAX_MEMBERS_PER_ROOM', 0, 1e7],
  ];

  for (const [name, minVal, maxVal] of numericBounds) {
    const raw = v[name];
    if (raw === undefined || raw === '') continue;
    const num = name.includes('WARNING_THRESHOLD') ? parseFloat(raw) : parseInt(raw, 10);
    if (!Number.isFinite(num) || num < minVal || num > maxVal) {
      throw new Error(name + ' must be a finite number between ' + minVal + ' and ' + maxVal + '.');
    }
  }

  if (v.WS_PROTOCOL_VERSION !== undefined && v.WS_PROTOCOL_VERSION !== '') {
    if (typeof v.WS_PROTOCOL_VERSION !== 'string' || v.WS_PROTOCOL_VERSION.trim() === '') {
      throw new Error('WS_PROTOCOL_VERSION must be a non-empty string.');
    }
  }

  if (v.WS_LOG_LEVEL !== undefined && v.WS_LOG_LEVEL !== '') {
    const allowed = ['debug', 'info', 'warn', 'error'];
    if (typeof v.WS_LOG_LEVEL !== 'string' || !allowed.includes(v.WS_LOG_LEVEL)) {
      throw new Error('WS_LOG_LEVEL must be one of: debug, info, warn, error.');
    }
  }

  const booleanVars = [
    'WS_LOG_JSON',
    'WS_ROOM_AUTO_CREATE',
    'WS_ROOM_AUTO_DELETE_EMPTY',
    'WS_ROOM_LEAVE_ON_DISCONNECT',
  ];
  for (const name of booleanVars) {
    const raw = v[name];
    if (raw === undefined || raw === '') continue;
    if (raw !== 'true' && raw !== 'false') {
      throw new Error(name + ' must be exactly "true" or "false".');
    }
  }

  // --- Metrics protection (Phase 2) ---
  const allowedMetricsModes = ['open', 'secret', 'admin', 'disabled'];
  const rawMetricsMode = v.METRICS_MODE;
  if (rawMetricsMode !== undefined && rawMetricsMode !== '') {
    const mode = String(rawMetricsMode).toLowerCase().trim();
    if (!allowedMetricsModes.includes(mode)) {
      throw new Error('METRICS_MODE must be one of: open, secret, admin, disabled.');
    }
  }
  const effectiveMetricsMode = (() => {
    if (rawMetricsMode !== undefined && typeof rawMetricsMode === 'string' && rawMetricsMode.trim() !== '') {
      return rawMetricsMode.toLowerCase().trim();
    }
    return isProduction ? 'secret' : 'open';
  })();
  if (isProduction && effectiveMetricsMode === 'secret') {
    const secret = v.METRICS_SECRET;
    if (secret === undefined || typeof secret !== 'string' || secret.trim() === '') {
      console.error('METRICS_SECRET is required in production when metrics mode is secret (default or METRICS_MODE=secret).');
      process.exit(1);
    }
  }
  if (isProduction && effectiveMetricsMode === 'open') {
    if (v.ALLOW_PUBLIC_METRICS_IN_PROD !== 'true') {
      console.error('METRICS_MODE=open in production is not allowed unless ALLOW_PUBLIC_METRICS_IN_PROD=true.');
      process.exit(1);
    }
  }
  if (v.METRICS_ENABLE_ADMIN_ROUTE !== undefined && v.METRICS_ENABLE_ADMIN_ROUTE !== '') {
    if (v.METRICS_ENABLE_ADMIN_ROUTE !== 'true' && v.METRICS_ENABLE_ADMIN_ROUTE !== 'false') {
      throw new Error('METRICS_ENABLE_ADMIN_ROUTE must be exactly "true" or "false".');
    }
  }
  if (v.ALLOW_PUBLIC_METRICS_IN_PROD !== undefined && v.ALLOW_PUBLIC_METRICS_IN_PROD !== '') {
    if (v.ALLOW_PUBLIC_METRICS_IN_PROD !== 'true' && v.ALLOW_PUBLIC_METRICS_IN_PROD !== 'false') {
      throw new Error('ALLOW_PUBLIC_METRICS_IN_PROD must be exactly "true" or "false".');
    }
  }

  // --- Category C: dev/test ---
  if (v.SIMULATE_DB_ERROR !== undefined && v.SIMULATE_DB_ERROR !== '') {
    if (v.SIMULATE_DB_ERROR !== 'true' && v.SIMULATE_DB_ERROR !== 'false') {
      throw new Error('SIMULATE_DB_ERROR must be exactly "true" or "false".');
    }
  }
}

module.exports = validateEnv;
