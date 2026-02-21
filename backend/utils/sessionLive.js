'use strict';

/**
 * Live-session filter helpers.
 * A session is "live" when lastSeenAt is within LIVE_WINDOW_MS of now.
 *
 * Config source for live window:
 *   backend/config/constants.js → HEARTBEAT.timeout (ms)
 *   Default: 60000 (WS_HEARTBEAT_TIMEOUT). Same as "connection considered dead" threshold.
 *   Env: WS_HEARTBEAT_TIMEOUT (1..86400000 ms, validated in config/env.validate.js).
 *
 * Formula: liveWindowMs = HEARTBEAT.timeout (so sessions with no activity in the last
 * heartbeat timeout are considered not live, aligned with WS heartbeat semantics).
 */

/**
 * Derive live window in ms from backend config.
 * @param {Object} config - config/constants (must have config.HEARTBEAT.timeout in ms)
 * @returns {number} liveWindowMs
 */
function getLiveWindowMs(config) {
  const timeout = config?.HEARTBEAT?.timeout;
  if (typeof timeout === 'number' && timeout > 0) return timeout;
  return 60000;
}

/**
 * Whether a session is "live" (last seen within liveWindowMs of now).
 * @param {Date|number|null|undefined} lastSeenAt - Session lastSeenAt (may be Date or ms)
 * @param {number} nowMs - Current time in ms (e.g. Date.now())
 * @param {number} liveWindowMs - Window in ms (e.g. from getLiveWindowMs(config))
 * @returns {boolean}
 */
function isLiveSession(lastSeenAt, nowMs, liveWindowMs) {
  if (lastSeenAt == null) return false;
  const lastMs = typeof lastSeenAt === 'number' ? lastSeenAt : (lastSeenAt instanceof Date ? lastSeenAt.getTime() : Number(lastSeenAt));
  if (!Number.isFinite(lastMs) || !Number.isFinite(nowMs) || !Number.isFinite(liveWindowMs)) return false;
  return (nowMs - lastMs) <= liveWindowMs;
}

module.exports = {
  getLiveWindowMs,
  isLiveSession,
};
