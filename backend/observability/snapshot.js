'use strict';

/**
 * Snapshot assembly and redaction.
 * Assembles observability snapshot from aggregators.
 * Applies redaction based on caller capabilities.
 * NEVER throws - always returns safe snapshot.
 */

const connectionsAggregator = require('./aggregators/connections');
const messagesAggregator = require('./aggregators/messages');
const latencyAggregator = require('./aggregators/latency');

/**
 * Safe empty snapshot (returned on ANY failure)
 */
const SAFE_EMPTY_SNAPSHOT = {
  overview: {},
  network: {},
  events: {},
  state: {},
};

/**
 * Assemble snapshot with redaction
 * @param {Object} capabilities - Caller capabilities (REQUIRED)
 * @returns {Object} Redacted snapshot (always safe, never throws)
 */
function assembleSnapshot(capabilities) {
  try {
    const safeCapabilities = capabilities && typeof capabilities === 'object' ? capabilities : { devtools: false };
    const isAdmin = safeCapabilities.devtools === true;

    // Call all aggregators inside try/catch
    // On ANY exception: discard partial data, return SAFE EMPTY SNAPSHOT
    let connections, messages, latency;

    try {
      connections = connectionsAggregator.getConnectionsSummary(null, isAdmin);
    } catch {
      return SAFE_EMPTY_SNAPSHOT;
    }

    try {
      messages = messagesAggregator.getMessagesSummary(null);
    } catch {
      return SAFE_EMPTY_SNAPSHOT;
    }

    try {
      latency = latencyAggregator.getLatencySummary(null);
    } catch {
      return SAFE_EMPTY_SNAPSHOT;
    }

    // Validate aggregator results (defensive)
    if (!connections || typeof connections !== 'object') {
      return SAFE_EMPTY_SNAPSHOT;
    }
    if (!messages || typeof messages !== 'object') {
      return SAFE_EMPTY_SNAPSHOT;
    }
    if (!latency || typeof latency !== 'object') {
      return SAFE_EMPTY_SNAPSHOT;
    }

    // Assemble snapshot (create new object, no references). Defensive: coerce to numbers to survive resets.
    const totalConn = typeof connections.total === 'number' && connections.total >= 0 ? connections.total : 0;
    const countByRole = connections.countByRole && typeof connections.countByRole === 'object'
      ? { admin: 0, user: 0, ...connections.countByRole }
      : { admin: 0, user: 0 };
    const totalMessages = messages.totalMessages && typeof messages.totalMessages === 'object'
      ? { received: 0, sent: 0, ...messages.totalMessages }
      : { received: 0, sent: 0 };
    const mps = typeof messages.messagesPerSecond === 'number' && messages.messagesPerSecond >= 0 ? messages.messagesPerSecond : 0;
    const messagesLastMinute = typeof messages.messagesLastMinute === 'number' && messages.messagesLastMinute >= 0 ? messages.messagesLastMinute : 0;
    const avgLat = typeof latency.avgLatency === 'number' && latency.avgLatency >= 0 ? latency.avgLatency : 0;
    const p95Lat = typeof latency.p95Latency === 'number' && latency.p95Latency >= 0 ? latency.p95Latency : 0;
    const maxLat = typeof latency.maxLatency === 'number' && latency.maxLatency >= 0 ? latency.maxLatency : 0;

    const snapshot = {
      timestamp: Date.now(),
      overview: {
        connections: totalConn,
        messages: totalMessages,
      },
      network: {
        connections: {
          totalConnections: totalConn,
          countByRole,
        },
        latency: {
          avgLatency: avgLat,
          p95Latency: p95Lat,
          maxLatency: maxLat,
        },
      },
      events: {
        messagesPerSecond: mps,
        messagesLastMinute,
        totalMessages,
      },
      state: {
        connectionCount: totalConn,
        roleDistribution: countByRole,
      },
    };

    if (isAdmin && Array.isArray(connections.adminUserIds)) {
      snapshot.network.connections.adminUserIds = [...connections.adminUserIds];
    }

    return snapshot;
  } catch {
    // On ANY exception: return SAFE EMPTY SNAPSHOT
    return SAFE_EMPTY_SNAPSHOT;
  }
}

module.exports = {
  assembleSnapshot,
  SAFE_EMPTY_SNAPSHOT,
};
