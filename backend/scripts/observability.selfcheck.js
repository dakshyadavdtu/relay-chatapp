'use strict';

/**
 * Observability self-check (dev-only). Read-only: prints connection count, connections summary,
 * latency, messages, suspicious flags, and recent activity from in-process aggregators.
 * Does NOT start the server. For non-zero metrics, start the server and generate traffic,
 * then use GET /api/admin/dashboard. Safe to run manually: no state changes, never throws.
 * Run: npm run obs:selfcheck (from backend dir)
 */

const path = require('path');
const backendRoot = path.resolve(__dirname, '..');

function run() {
  const isDev = process.env.NODE_ENV !== 'production';
  if (!isDev) {
    console.log('[observability.selfcheck] NODE_ENV is production; skipping (dev-only).');
    return;
  }

  let connectionCount = 0;
  let connectionsSummary = null;
  let latencySummary = null;
  let messagesSummary = null;
  let suspiciousFlags = 0;
  let activityEvents = null;

  try {
    const connectionManager = require(path.join(backendRoot, 'websocket/connection/connectionManager'));
    connectionCount = typeof connectionManager.getConnectionCount === 'function'
      ? connectionManager.getConnectionCount()
      : 0;
  } catch (e) {
    console.warn('[observability.selfcheck] connectionManager:', e?.message || 'failed');
  }

  try {
    const connectionsAggregator = require(path.join(backendRoot, 'observability/aggregators/connections'));
    connectionsSummary = typeof connectionsAggregator.getConnectionsSummary === 'function'
      ? connectionsAggregator.getConnectionsSummary(null, true)
      : null;
  } catch (e) {
    console.warn('[observability.selfcheck] connectionsAggregator:', e?.message || 'failed');
  }

  try {
    const latencyAggregator = require(path.join(backendRoot, 'observability/aggregators/latency'));
    latencySummary = typeof latencyAggregator.getLatencySummary === 'function'
      ? latencyAggregator.getLatencySummary(null)
      : null;
  } catch (e) {
    console.warn('[observability.selfcheck] latencyAggregator:', e?.message || 'failed');
  }

  try {
    const messagesAggregator = require(path.join(backendRoot, 'observability/aggregators/messages'));
    messagesSummary = typeof messagesAggregator.getMessagesSummary === 'function'
      ? messagesAggregator.getMessagesSummary(null)
      : null;
  } catch (e) {
    console.warn('[observability.selfcheck] messagesAggregator:', e?.message || 'failed');
  }

  try {
    const suspiciousDetector = require(path.join(backendRoot, 'suspicious/suspicious.detector'));
    suspiciousFlags = typeof suspiciousDetector.getTotalFlagsCount === 'function'
      ? suspiciousDetector.getTotalFlagsCount()
      : 0;
  } catch (e) {
    console.warn('[observability.selfcheck] suspiciousDetector:', e?.message || 'failed');
  }

  try {
    const adminActivityBuffer = require(path.join(backendRoot, 'observability/adminActivityBuffer'));
    const data = typeof adminActivityBuffer.getEvents === 'function'
      ? adminActivityBuffer.getEvents({ maxEvents: 10 })
      : null;
    activityEvents = data && Array.isArray(data.events) ? data.events.length : 0;
  } catch (e) {
    console.warn('[observability.selfcheck] adminActivityBuffer:', e?.message || 'failed');
  }

  console.log('[observability.selfcheck] active connections (getConnectionCount):', connectionCount);
  console.log('[observability.selfcheck] connections summary:', connectionsSummary != null
    ? { total: connectionsSummary.total, countByRole: connectionsSummary.countByRole }
    : 'n/a');
  console.log('[observability.selfcheck] latency:', latencySummary != null
    ? { avgLatency: latencySummary.avgLatency, p95Latency: latencySummary.p95Latency, sampleCount: latencySummary.sampleCount }
    : 'n/a');
  console.log('[observability.selfcheck] messages:', messagesSummary != null
    ? { totalMessages: messagesSummary.totalMessages, messagesPerSecond: messagesSummary.messagesPerSecond }
    : 'n/a');
  console.log('[observability.selfcheck] suspiciousFlags:', suspiciousFlags);
  console.log('[observability.selfcheck] activity events (recent 10):', activityEvents != null ? activityEvents : 'n/a');
  console.log('[observability.selfcheck] done.');
}

try {
  run();
} catch (err) {
  console.warn('[observability.selfcheck] run error:', err?.message || err);
}
