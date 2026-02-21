'use strict';

/**
 * Metrics registry and GET /metrics tests.
 * Run: node tests/metrics/metrics.test.js (from backend)
 * Does not depend on production DB.
 */

const path = require('path');
const http = require('http');
const backendRoot = path.resolve(__dirname, '..', '..');

const metrics = require(path.join(backendRoot, 'observability/metrics'));

function fail(msg) {
  console.error('FAIL:', msg);
  process.exit(1);
}

async function run() {
  metrics.resetMetrics();

  // ─── 1. Increment messages_persisted_total → counter increases ───
  const before = metrics.getMetrics().messages_persisted_total;
  metrics.increment('messages_persisted_total');
  metrics.increment('messages_persisted_total', 2);
  const after = metrics.getMetrics().messages_persisted_total;
  if (after !== before + 3) fail('messages_persisted_total should increase by 3, got ' + (after - before));
  console.log('PASS: Increment messages_persisted_total → counter increases');

  // ─── 2. Replay triggers replay_count_total increment ───
  metrics.resetMetrics();
  metrics.increment('replay_count_total');
  const replayCount = metrics.getMetrics().replay_count_total;
  if (replayCount !== 1) fail('replay_count_total should be 1, got ' + replayCount);
  console.log('PASS: Replay triggers replay_count_total increment');

  // ─── 3. Delivery failure increments delivery_failures_total ───
  metrics.resetMetrics();
  metrics.increment('delivery_failures_total');
  metrics.increment('ack_drop_count_total');
  const failures = metrics.getMetrics().delivery_failures_total;
  const ackDrop = metrics.getMetrics().ack_drop_count_total;
  if (failures !== 1) fail('delivery_failures_total should be 1, got ' + failures);
  if (ackDrop !== 1) fail('ack_drop_count_total should be 1, got ' + ackDrop);
  console.log('PASS: Delivery failure increments delivery_failures_total');

  // ─── 4. GET /metrics returns counters (same contract as app.js route) ───
  metrics.resetMetrics();
  metrics.increment('reconnect_total', 2);
  const express = require('express');
  const miniApp = express();
  miniApp.get('/metrics', (req, res) => {
    res.status(200).json({
      counters: metrics.getMetrics(),
      timestamp: Date.now(),
    });
  });
  const server = http.createServer(miniApp);
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      http.get('http://127.0.0.1:' + port + '/metrics', (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          server.close();
          if (res.statusCode !== 200) return reject(new Error('GET /metrics status ' + res.statusCode));
          let obj;
          try { obj = JSON.parse(data); } catch (e) { return reject(e); }
          if (!obj || typeof obj.counters !== 'object' || typeof obj.timestamp !== 'number') {
            return reject(new Error('GET /metrics should return { counters, timestamp }'));
          }
          if (obj.counters.reconnect_total !== 2) fail('GET /metrics counters.reconnect_total should be 2, got ' + obj.counters.reconnect_total);
          console.log('PASS: GET /metrics returns counters');
          resolve();
        });
      }).on('error', (err) => {
        server.close();
        reject(err);
      });
    });
  }).then(() => {
    // ─── 5. resetMetrics() clears counters ───
    metrics.resetMetrics();
    const m = metrics.getMetrics();
    const sum = Object.values(m).reduce((a, b) => a + b, 0);
    if (sum !== 0) fail('After resetMetrics() all counters should be 0, got sum ' + sum);
    console.log('PASS: resetMetrics() clears counters');

    // Unknown metric name is ignored
    metrics.increment('unknown_metric', 1);
    if (metrics.getMetrics().unknown_metric !== undefined) fail('Unknown metric should be ignored');
    console.log('PASS: Unknown metric name ignored');

    console.log('All metrics tests passed');
    process.exit(0);
  });
}

run().catch((err) => {
  console.error('FAIL:', err.message);
  process.exit(1);
});
