'use strict';

/**
 * In-memory metrics registry for system health.
 * Lightweight, non-blocking, never throws in hot paths.
 * Metric names must not change (contract for GET /metrics).
 */

/** Allowed metric names; used for O(1) lookup without Set (state ownership rule). */
const ALLOWED = {
  messages_persisted_total: true,
  messages_delivered_total: true,
  replay_count_total: true,
  ack_drop_count_total: true,
  reconnect_total: true,
  rate_limit_hits_total: true,
  delivery_failures_total: true,
};

const counters = {
  messages_persisted_total: 0,
  messages_delivered_total: 0,
  replay_count_total: 0,
  ack_drop_count_total: 0,
  reconnect_total: 0,
  rate_limit_hits_total: 0,
  delivery_failures_total: 0,
};

/**
 * Increment a counter by value. O(1). Ignores unknown metric names; never throws.
 * @param {string} metricName - One of the ALLOWED names
 * @param {number} [value=1]
 */
function increment(metricName, value = 1) {
  if (ALLOWED[metricName] && typeof value === 'number' && value >= 0) {
    counters[metricName] += value;
  }
}

/**
 * Return a snapshot of counters. Safe to call from GET /metrics.
 * @returns {{ [key: string]: number }}
 */
function getMetrics() {
  return { ...counters };
}

/**
 * Reset all counters to zero. For tests only.
 */
function resetMetrics() {
  for (const key of Object.keys(counters)) {
    counters[key] = 0;
  }
}

module.exports = {
  increment,
  getMetrics,
  resetMetrics,
};
