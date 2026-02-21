# Environment Variable Contract

**Phase 0 Baseline Documentation**  
**Last Updated:** 2026-02-03  
**Purpose:** Complete inventory of all environment variables used by the backend, their purpose, and behavior.

---

## Production Required Variables

These variables **MUST** be set when `NODE_ENV=production`. Missing values cause `process.exit(1)`.

| Variable | Used In | Purpose | Required | Default (if any) | Failure Behavior |
|----------|---------|---------|----------|------------------|------------------|
| `NODE_ENV` | `config/env.validate.js` | Runtime mode (`development` \| `production`) | **Yes** (production) | None | Production: `process.exit(1)` if missing |
| `PORT` | `config/constants.js`, `server.js` | HTTP server listen port | **Yes** (production) | `3000` (dev only) | Production: `process.exit(1)` if missing; validation error if invalid range |
| `JWT_SECRET` | `utils/jwt.js`, `config/env.validate.js` | JWT signing secret for authentication | **Yes** (always) | None | Throws error on module load if missing |
| `DB_URI` | `config/env.validate.js` | Database connection string | **Yes** (production) | None | Production: `process.exit(1)` if missing |
| `COOKIE_DOMAIN` | `config/env.validate.js` | Cookie domain scope for browser JWT | **Yes** (production) | None | Production: `process.exit(1)` if missing |
| `CORS_ORIGIN` | `config/env.validate.js`, `config/origins.js` | Single allowed CORS origin for frontend | **Yes** (production, if `CORS_ORIGINS` unset) | None | Production: at least one of `CORS_ORIGIN` or `CORS_ORIGINS` required; invalid format → `process.exit(1)` |
| `CORS_ORIGINS` | `config/origins.js` | Comma-separated allowed CORS origins (alternative to `CORS_ORIGIN`) | **Yes** (production, if `CORS_ORIGIN` unset) | None | If set, takes priority over `CORS_ORIGIN`; each value validated as origin-only (http/https, no path/query) |
| `WS_PATH` | `config/env.validate.js`, `websocket/index.js` | WebSocket endpoint path (must match NGINX config) | **Yes** (production) | `/ws` (dev only) | Production: `process.exit(1)` if missing |

---

## Optional Behavioral Variables

These variables have defaults and are optional. If set, they are validated for type and bounds.

### Authentication & Cookies

| Variable | Used In | Purpose | Required | Default | Validation |
|----------|---------|---------|----------|---------|------------|
| `JWT_COOKIE_NAME` | `config/constants.js`, `websocket/connection/wsServer.js` | Cookie name for JWT token | No | `token` | Must be non-empty string if set |

### WebSocket Protocol

| Variable | Used In | Purpose | Required | Default | Validation |
|----------|---------|---------|----------|---------|------------|
| `WS_PROTOCOL_VERSION` | `config/constants.js` | Protocol version string | No | `1.0.0` | Must be non-empty string if set |

### Rate Limiting

| Variable | Used In | Purpose | Required | Default | Validation |
|----------|---------|---------|----------|---------|------------|
| `WS_RATE_LIMIT_MESSAGES` | `config/constants.js` | Max messages per window | No | `100` | Integer 1-10,000,000 |
| `WS_RATE_LIMIT_WINDOW_MS` | `config/constants.js` | Time window in milliseconds | No | `60000` | Integer 1-86,400,000 |
| `WS_RATE_LIMIT_WARNING_THRESHOLD` | `config/constants.js` | Warning threshold (percentage) | No | `0.8` | Float 0-1 |
| `WS_VIOLATIONS_BEFORE_THROTTLE` | `config/constants.js` | Violations before throttling | No | `2` | Integer 0-1000 |
| `WS_MAX_VIOLATIONS` | `config/constants.js` | Max violations before closure | No | `5` | Integer 0-1000 |

### Payload Limits

| Variable | Used In | Purpose | Required | Default | Validation |
|----------|---------|---------|----------|---------|------------|
| `WS_MAX_PAYLOAD_SIZE` | `config/constants.js` | Maximum payload size in bytes | No | `1048576` (1MB) | Integer 1-1,000,000,000 |

### Backpressure

| Variable | Used In | Purpose | Required | Default | Validation |
|----------|---------|---------|----------|---------|------------|
| `WS_BACKPRESSURE_THRESHOLD` | `config/constants.js` | Threshold before dropping messages | No | `100` | Integer 0-1,000,000 |
| `WS_BACKPRESSURE_MAX_QUEUE` | `config/constants.js` | Max queue size before closing socket | No | `200` | Integer 0-1,000,000 |
| `WS_BACKPRESSURE_BUFFERED_THRESHOLD` | `config/constants.js` | Buffered amount threshold (bytes) | No | `1048576` (1MB) | Integer 0-1,000,000,000 |
| `WS_BACKPRESSURE_MAX_OVERFLOWS` | `config/constants.js` | Max consecutive queue overflows | No | `5` | Integer 0-1000 |

### Heartbeat

| Variable | Used In | Purpose | Required | Default | Validation |
|----------|---------|---------|----------|---------|------------|
| `WS_HEARTBEAT_INTERVAL` | `config/constants.js` | Interval between heartbeat checks (ms) | No | `30000` | Integer 1-86,400,000 |
| `WS_HEARTBEAT_TIMEOUT` | `config/constants.js` | Timeout before marking dead (ms) | No | `60000` | Integer 1-86,400,000 |

### Server Configuration

| Variable | Used In | Purpose | Required | Default | Validation |
|----------|---------|---------|----------|---------|------------|
| `WS_SHUTDOWN_TIMEOUT` | `config/constants.js` | Graceful shutdown timeout (ms) | No | `10000` | Integer 0-3,600,000 |
| `WS_MAX_CONNECTIONS` | `config/constants.js` | Maximum connections (0 = unlimited) | No | `0` | Integer 0-10,000,000 |
| `WS_MAX_CONNECTIONS_PER_USER` | `config/constants.js` | Max connections per user (0 = unlimited) | No | `5` | Integer 0-10,000,000 |
| `WS_MAX_CONNECTIONS_PER_IP` | `config/constants.js` | Max connections per IP (0 = unlimited) | No | `50` | Integer 0-10,000,000 |

### Logging

| Variable | Used In | Purpose | Required | Default | Validation |
|----------|---------|----------|----------|---------|------------|
| `WS_LOG_LEVEL` | `config/constants.js` | Log level | No | `info` | Must be: `debug`, `info`, `warn`, `error` |
| `WS_LOG_JSON` | `config/constants.js` | Enable structured JSON logging | No | `false` | Must be exactly `true` or `false` |

### Rooms

| Variable | Used In | Purpose | Required | Default | Validation |
|----------|---------|---------|----------|---------|------------|
| `WS_MAX_ROOMS` | `config/constants.js` | Maximum rooms (0 = unlimited) | No | `0` | Integer 0-10,000,000 |
| `WS_MAX_MEMBERS_PER_ROOM` | `config/constants.js` | Max members per room (0 = unlimited) | No | `0` | Integer 0-10,000,000 |
| `WS_ROOM_AUTO_CREATE` | `config/constants.js` | Auto-create room on join | No | `true` | Must be exactly `true` or `false` |
| `WS_ROOM_AUTO_DELETE_EMPTY` | `config/constants.js` | Auto-delete empty rooms | No | `true` | Must be exactly `true` or `false` |
| `WS_ROOM_LEAVE_ON_DISCONNECT` | `config/constants.js` | Remove user from rooms on disconnect | No | `true` | Must be exactly `true` or `false` |

### Metrics protection

| Variable | Used In | Purpose | Required | Default | Validation |
|----------|---------|---------|----------|---------|------------|
| `METRICS_MODE` | `config/env.validate.js`, `http/middleware/metricsAccess.middleware.js` | Access mode: `open`, `secret`, `admin`, `disabled` | No | Prod: `secret`; dev: `open` | If set, must be one of the four values |
| `METRICS_SECRET` | `config/env.validate.js`, `http/middleware/metricsAccess.middleware.js` | Secret for header `x-metrics-key` when mode is `secret` | **Yes** in production when mode is `secret` | None | Non-empty string when required |
| `METRICS_ENABLE_ADMIN_ROUTE` | `config/env.validate.js`, `http/index.js` | Enable `GET /api/metrics` (admin-only) | No | `false` | If set, must be `true` or `false` |
| `ALLOW_PUBLIC_METRICS_IN_PROD` | `config/env.validate.js` | Allow `METRICS_MODE=open` in production | No | `false` | If set, must be `true` or `false` |

**Behavior:** In production, `/metrics` requires header `x-metrics-key: <METRICS_SECRET>` by default. Optional: set `METRICS_ENABLE_ADMIN_ROUTE=true` to allow admins to call `GET /api/metrics` with cookie auth. **Never** set `METRICS_MODE=open` in production unless you intentionally allow public metrics and set `ALLOW_PUBLIC_METRICS_IN_PROD=true`.

---

## Development/Test Variables

| Variable | Used In | Purpose | Required | Default | Validation |
|----------|---------|---------|----------|---------|------------|
| `SIMULATE_DB_ERROR` | `config/db.js` | Simulate database errors (dev/test only) | No | `false` | Must be exactly `true` or `false` |

---

## Environment Loading Order

1. `dotenv` loads `.env` file (if present) via `config/env.js`
2. `config/env.validate.js` runs validation (throws or exits on failure)
3. `config/env.js` exports frozen `process.env` snapshot
4. `config/constants.js` reads env vars with defaults
5. `utils/jwt.js` reads `JWT_SECRET` at module load (fail-fast)

---

## Notes

- **Production Mode:** When `NODE_ENV=production`, required variables must be set. No silent defaults.
- **Development Mode:** Defaults are allowed for convenience, but `JWT_SECRET` is always required.
- **Validation:** All numeric variables are validated for type and bounds when set.
- **Secrets:** `JWT_SECRET` and `DB_URI` are secrets and should never be logged or committed.
- **CORS/Origin:** `CORS_ORIGIN` and `CORS_ORIGINS` are used by `config/origins.js` (origin guard, CORS middleware, Helmet CSP connect-src). `ALLOWED_ORIGINS` is deprecated and ignored; use `CORS_ORIGIN` or `CORS_ORIGINS`.

---

## Usage Examples

### Production
```bash
export NODE_ENV=production
export PORT=3000
export JWT_SECRET=your-strong-secret-minimum-32-characters-long
export DB_URI=mongodb://user:pass@host:27017/dbname
export COOKIE_DOMAIN=.example.com
export CORS_ORIGIN=https://app.example.com
export WS_PATH=/ws
```

### Development
```bash
export JWT_SECRET=dev-secret-key
# All other vars optional with defaults
```
