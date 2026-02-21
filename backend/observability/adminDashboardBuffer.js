'use strict';

/**
 * Admin dashboard metrics ring buffer.
 * Samples every SAMPLE_INTERVAL_MS (1 second). Keeps last MAX_POINTS (60) samples.
 * Message rate = messages aggregator (rolling 60s timestamps), same source as "Last 60s: N msgs".
 * Used by GET /api/admin/dashboard, /series, /stats. Bounded: max 60 points.
 */

const connectionManager = require('../websocket/connection/connectionManager');
const latencyAggregator = require('./aggregators/latency');
const suspiciousDetector = require('../suspicious/suspicious.detector');
const messagesAggregator = require('./aggregators/messages');

/** Sampling interval: 1 second. */
const SAMPLE_INTERVAL_MS = 1000;
const SAMPLE_INTERVAL_SECONDS = 1;
const DEFAULT_WINDOW_SECONDS = 60;
const DEFAULT_INTERVAL_SECONDS = 1;
const MAX_POINTS = 60;

/** @type {Array<{ ts: number, messagesPerSecondAvg: number, connectionsAvg: number, latencyAvg: number, suspiciousFlags: number }>} */
const buffer = [];
let lastSampleTs = 0;
let intervalHandle = null;

function sample() {
  try {
    const ts = Date.now();
    let messagesPerSecondAvg = 0;
    let connectionsAvg = 0;
    let latencyAvg = 0;
    let suspiciousFlags = 0;

    try {
      const summary = messagesAggregator.getMessagesSummary && messagesAggregator.getMessagesSummary(null);
      messagesPerSecondAvg = typeof summary?.messagesPerSecond === 'number' && summary.messagesPerSecond >= 0
        ? Math.round(summary.messagesPerSecond * 100) / 100
        : 0;

    } catch (_) {
      /* no-op */
    }

    try {
      // Use online user count (unique users) so graph matches "Online users" card, not total sockets.
      connectionsAvg = connectionManager.getOnlineUserCount ? connectionManager.getOnlineUserCount() : 0;
      if (typeof connectionsAvg !== 'number') connectionsAvg = 0;
    } catch (_) {
      connectionsAvg = 0;
    }

    try {
      const latSummary = latencyAggregator.getLatencySummary(null);
      latencyAvg = typeof latSummary?.avgLatency === 'number' ? latSummary.avgLatency : 0;
    } catch (_) {
      /* no-op */
    }

    try {
      suspiciousFlags = suspiciousDetector.getTotalFlagsCount ? suspiciousDetector.getTotalFlagsCount() : 0;
      if (typeof suspiciousFlags !== 'number') suspiciousFlags = 0;
    } catch (_) {
      /* no-op */
    }

    buffer.push({
      ts,
      messagesPerSecondAvg,
      connectionsAvg,
      latencyAvg,
      suspiciousFlags,
    });

    while (buffer.length > MAX_POINTS) {
      buffer.shift();
    }
    lastSampleTs = ts;
  } catch (_) {
    /* never throw */
  }
}

/**
 * Current messages-per-second (latest sample). Backend-only; frontend must not compute rates.
 * @returns {number}
 */
function getCurrentMps() {
  try {
    if (!Array.isArray(buffer) || buffer.length === 0) return 0;
    const last = buffer[buffer.length - 1];
    return typeof last?.messagesPerSecondAvg === 'number' ? last.messagesPerSecondAvg : 0;
  } catch (_) {
    return 0;
  }
}

/**
 * Average MPS over last N samples (up to 60). Backend-only.
 * @returns {number}
 */
function getMpsAvg60() {
  try {
    if (!Array.isArray(buffer) || buffer.length === 0) return 0;
    const slice = buffer.slice(-MAX_POINTS);
    const values = slice
      .map((p) => (p && typeof p === 'object' ? p.messagesPerSecondAvg : undefined))
      .filter((v) => typeof v === 'number');
    if (values.length === 0) return 0;
    const sum = values.reduce((a, b) => a + b, 0);
    return Math.round((sum / values.length) * 100) / 100;
  } catch (_) {
    return 0;
  }
}

function start() {
  if (intervalHandle) return;
  sample();
  intervalHandle = setInterval(sample, SAMPLE_INTERVAL_MS);
}

function stop() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

/**
 * Get time-series points for chart. Never throws; returns safe default on reset/bad state.
 * @param {Object} opts - { windowSeconds?, intervalSeconds? }
 * @returns {{ windowSeconds: number, intervalSeconds: number, points: Array }}
 */
function getSeries(opts) {
  try {
    if (!Array.isArray(buffer)) {
      return { windowSeconds: DEFAULT_WINDOW_SECONDS, intervalSeconds: DEFAULT_INTERVAL_SECONDS, points: [] };
    }
    // Buffer is always 1s interval, 60 samples (60s window). Return that so clients know sampling interval.
    const windowSeconds = DEFAULT_WINDOW_SECONDS;
    const intervalSeconds = DEFAULT_INTERVAL_SECONDS;
    const points = buffer.slice(-MAX_POINTS).map((p) => {
      if (!p || typeof p !== 'object') return { ts: 0, label: '00:00:00', messagesPerSecondAvg: 0, connectionsAvg: 0 };
      const ts = typeof p.ts === 'number' ? p.ts : 0;
      const d = new Date(ts);
      const hours = String(d.getHours()).padStart(2, '0');
      const mins = String(d.getMinutes()).padStart(2, '0');
      const secs = String(d.getSeconds()).padStart(2, '0');
      return {
        ts,
        label: `${hours}:${mins}:${secs}`,
        messagesPerSecondAvg: Math.round((typeof p.messagesPerSecondAvg === 'number' ? p.messagesPerSecondAvg : 0) * 100) / 100,
        connectionsAvg: typeof p.connectionsAvg === 'number' ? p.connectionsAvg : 0,
      };
    });
    return {
      windowSeconds,
      intervalSeconds,
      points: points.slice(-60),
    };
  } catch (_) {
    return { windowSeconds: DEFAULT_WINDOW_SECONDS, intervalSeconds: DEFAULT_INTERVAL_SECONDS, points: [] };
  }
}

/**
 * Compute extended stats from buffer (peak, p95, delta).
 * @returns {{ messagesPerSecondPeak?: number, messagesPerSecondP95?: number, latencyMaxMs?: number, latencyP95Ms?: number, latencyAvgP95?: number, suspiciousFlagsDeltaLastHour?: number }}
 */
function getExtendedStats() {
  const result = {};
  try {
    if (!Array.isArray(buffer) || buffer.length === 0) return result;

    const mpsValues = buffer.map((p) => (p && typeof p === 'object' ? p.messagesPerSecondAvg : undefined)).filter((v) => typeof v === 'number');
    if (mpsValues.length > 0) {
      result.messagesPerSecondPeak = Math.round(Math.max(...mpsValues) * 100) / 100;
      const sorted = [...mpsValues].sort((a, b) => a - b);
      const p95Idx = Math.ceil(sorted.length * 0.95) - 1;
      result.messagesPerSecondP95 = Math.round((sorted[Math.max(0, p95Idx)] || 0) * 100) / 100;
    }

    const latValues = buffer.map((p) => (p && typeof p === 'object' ? p.latencyAvg : undefined)).filter((v) => typeof v === 'number' && v >= 0);
    if (latValues.length > 0) {
      result.latencyMaxMs = Math.round(Math.max(...latValues) * 100) / 100;
      const sorted = [...latValues].sort((a, b) => a - b);
      const p95Idx = Math.ceil(sorted.length * 0.95) - 1;
      result.latencyAvgP95 = Math.round((sorted[Math.max(0, p95Idx)] || 0) * 100) / 100;
    }

    // Compute suspiciousFlagsDeltaLastHour: delta from one hour ago (or baseline if uptime < 1h)
    if (buffer.length >= 2) {
      const now = Date.now();
      const oneHourAgo = now - 3600 * 1000;
      const newest = buffer[buffer.length - 1];
      
      if (newest && typeof newest.ts === 'number') {
        // Find the most recent point with ts <= oneHourAgo
        let pastPoint = null;
        for (let i = buffer.length - 1; i >= 0; i--) {
          const p = buffer[i];
          if (p && typeof p.ts === 'number' && p.ts <= oneHourAgo) {
            pastPoint = p;
            break;
          }
        }
        
        // Fallback: if no point <= oneHourAgo, use first point (baseline since start)
        if (!pastPoint && buffer.length > 0) {
          pastPoint = buffer[0];
        }
        
        if (pastPoint) {
          const pastValue = typeof pastPoint.suspiciousFlags === 'number' ? pastPoint.suspiciousFlags : 0;
          const currentValue = typeof newest.suspiciousFlags === 'number' ? newest.suspiciousFlags : 0;
          result.suspiciousFlagsDeltaLastHour = currentValue - pastValue;
        } else {
          // Edge case: buffer has points but none are valid
          result.suspiciousFlagsDeltaLastHour = 0;
        }
      } else {
        result.suspiciousFlagsDeltaLastHour = 0;
      }
    } else {
      // Buffer has < 2 points: return 0 (no delta can be computed)
      result.suspiciousFlagsDeltaLastHour = 0;
    }
  } catch (_) {
    /* no-op */
  }
  return result;
}

start();

module.exports = {
  getSeries,
  getExtendedStats,
  getCurrentMps,
  getMpsAvg60,
  start,
  stop,
};
