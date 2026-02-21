'use strict';

/**
 * Monitoring Module
 * 
 * Provides monitoring hooks for connection count, heartbeat failures, and other metrics.
 * 
 * No external dependencies - uses only Node.js built-ins
 */

const logger = require('./logger');

/**
 * Monitoring metrics
 * @type {Object}
 */
const metrics = {
  // Connection metrics
  connections: {
    total: 0,
    active: 0,
    closed: 0,
    rejected: 0,
  },
  // Heartbeat metrics
  heartbeat: {
    checks: 0,
    failures: 0,
    timeouts: 0,
  },
  // Message metrics
  messages: {
    received: 0,
    sent: 0,
    errors: 0,
  },
  // Rate limiting metrics
  rateLimit: {
    violations: 0,
    throttled: 0,
    closed: 0,
  },
  // Room metrics
  rooms: {
    created: 0,
    deleted: 0,
    joins: 0,
    leaves: 0,
    messages: 0,
    broadcasts: 0,
  },
};

/**
 * Monitoring listeners
 * @type {Set<Function>}
 */
const listeners = new Set();

/**
 * Increment a metric counter
 * @param {string} category - Metric category
 * @param {string} metric - Metric name
 * @param {number} [value=1] - Value to increment by
 */
function increment(category, metric, value = 1) {
  if (metrics[category] && typeof metrics[category][metric] === 'number') {
    metrics[category][metric] += value;
    
    // Notify listeners
    for (const listener of listeners) {
      try {
        listener({ category, metric, value, current: metrics[category][metric] });
      } catch (err) {
        logger.error('Monitoring', 'listener_error', { error: err.message });
      }
    }
  }
}

/**
 * Set a metric value
 * @param {string} category - Metric category
 * @param {string} metric - Metric name
 * @param {number} value - Value to set
 */
function set(category, metric, value) {
  if (metrics[category] && typeof metrics[category][metric] === 'number') {
    metrics[category][metric] = value;
    
    // Notify listeners
    for (const listener of listeners) {
      try {
        listener({ category, metric, value, current: metrics[category][metric] });
      } catch (err) {
        logger.error('Monitoring', 'listener_error', { error: err.message });
      }
    }
  }
}

/**
 * Get all metrics
 * @returns {Object} Copy of all metrics
 */
function getMetrics() {
  return JSON.parse(JSON.stringify(metrics));
}

/**
 * Get specific metric
 * @param {string} category - Metric category
 * @param {string} [metric] - Specific metric name (optional)
 * @returns {Object|number} Metric value(s)
 */
function getMetric(category, metric = null) {
  if (!metrics[category]) {
    return null;
  }
  
  if (metric) {
    return metrics[category][metric] || null;
  }
  
  return JSON.parse(JSON.stringify(metrics[category]));
}

/**
 * Subscribe to metric changes
 * @param {Function} callback - Callback function({category, metric, value, current})
 * @returns {Function} Unsubscribe function
 */
function onMetricChange(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

/**
 * Reset all metrics
 */
function reset() {
  metrics.connections.total = 0;
  metrics.connections.active = 0;
  metrics.connections.closed = 0;
  metrics.connections.rejected = 0;
  metrics.heartbeat.checks = 0;
  metrics.heartbeat.failures = 0;
  metrics.heartbeat.timeouts = 0;
  metrics.messages.received = 0;
  metrics.messages.sent = 0;
  metrics.messages.errors = 0;
  metrics.rateLimit.violations = 0;
  metrics.rateLimit.throttled = 0;
  metrics.rateLimit.closed = 0;
  metrics.rooms.created = 0;
  metrics.rooms.deleted = 0;
  metrics.rooms.joins = 0;
  metrics.rooms.leaves = 0;
  metrics.rooms.messages = 0;
  metrics.rooms.broadcasts = 0;
}

module.exports = {
  increment,
  set,
  getMetrics,
  getMetric,
  onMetricChange,
  reset,
};
