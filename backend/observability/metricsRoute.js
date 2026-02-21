'use strict';

/**
 * Shared metrics response handler. Contract: { counters, timestamp }.
 * Used by GET /metrics (app.js) and GET /api/metrics (http/index.js).
 */

const metrics = require('./metrics');

function handleMetrics(req, res) {
  res.status(200).json({
    counters: metrics.getMetrics(),
    timestamp: Date.now(),
  });
}

module.exports = {
  handleMetrics,
};
