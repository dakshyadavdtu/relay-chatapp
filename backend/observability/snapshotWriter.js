'use strict';

/**
 * Writes coarse metrics snapshots to Atlas at a fixed interval.
 * One doc per interval (e.g. 60s). Non-blocking; never throws.
 */

const observability = require('./index');
const suspiciousDetector = require('../suspicious/suspicious.detector');
const metricsSnapshotStore = require('../storage/metricsSnapshot.mongo');

const DEFAULT_INTERVAL_SECONDS = 60;
let intervalId = null;

function getIntervalSeconds() {
  const env = process.env.METRICS_SNAPSHOT_INTERVAL_SECONDS;
  const n = parseInt(env, 10);
  if (Number.isFinite(n) && n >= 10 && n <= 3600) return n;
  return DEFAULT_INTERVAL_SECONDS;
}

function writeOne() {
  try {
    const capabilities = { devtools: true };
    const snapshot = observability.getSnapshot(capabilities);
    const network = snapshot && snapshot.network;
    const connections = network && network.connections;
    const latency = network && network.latency;
    const events = snapshot && snapshot.events;
    const totalMessages = events && events.totalMessages;

    const onlineUsers = typeof connections?.totalConnections === 'number' ? connections.totalConnections : 0;
    const latencyAvgMs = typeof latency?.avgLatency === 'number' ? latency.avgLatency : 0;
    const latencyP95Ms = typeof latency?.p95Latency === 'number' ? latency.p95Latency : 0;
    const latencyMaxMs = typeof latency?.maxLatency === 'number' ? latency.maxLatency : 0;
    const messagesPerSecond = typeof events?.messagesPerSecond === 'number' ? events.messagesPerSecond : 0;
    const persistedTotal = totalMessages && typeof totalMessages.received === 'number' ? totalMessages.received : 0;
    const deliveredTotal = totalMessages && typeof totalMessages.sent === 'number' ? totalMessages.sent : 0;
    const suspiciousFlags = typeof suspiciousDetector.getTotalFlagsCount === 'function'
      ? suspiciousDetector.getTotalFlagsCount()
      : 0;

    const snap = {
      createdAt: Date.now(),
      onlineUsers,
      latencyAvgMs,
      latencyP95Ms,
      latencyMaxMs,
      messagesPerSecond,
      suspiciousFlags,
      persistedTotal,
      deliveredTotal,
    };
    metricsSnapshotStore.insertSnapshot(snap).catch(() => {});
  } catch (_) {
    /* never throw */
  }
}

function start() {
  if (intervalId != null) return;
  const sec = getIntervalSeconds();
  intervalId = setInterval(writeOne, sec * 1000);
  writeOne();
}

function stop() {
  if (intervalId != null) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

module.exports = {
  start,
  stop,
  writeOne,
};
