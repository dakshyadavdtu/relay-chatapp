'use strict';

/**
 * Unit tests for the messages aggregator (MPS and messagesLastMinute).
 * Verifies that after tracking N persisted message timestamps, getMessagesSummary returns
 * messagesLastMinute === N and messagesPerSecond === round(N/60, 2).
 *
 * How to run (from backend directory):
 *   node tests/observability/aggregators/messages.test.js
 *
 * Or with the full test suite:
 *   npm test
 * (this file must be added to the test script in package.json to run with npm test)
 */

const path = require('path');
const backendRoot = path.resolve(__dirname, '..', '..', '..');
const messagesAgg = require(path.join(backendRoot, 'observability/aggregators/messages'));

function fail(msg) {
  console.error('FAIL:', msg);
  process.exit(1);
}

function run() {
  // Reset so we start with an empty window
  if (typeof messagesAgg._resetForTest !== 'function') {
    fail('messages aggregator must export _resetForTest for tests');
  }
  messagesAgg._resetForTest();

  const N = 5;
  for (let i = 0; i < N; i++) {
    messagesAgg.trackPersistedMessageTimestamp();
  }

  const out = messagesAgg.getMessagesSummary(null);
  if (out == null || typeof out !== 'object') {
    fail('getMessagesSummary() must return an object');
  }

  if (out.messagesLastMinute !== N) {
    fail(`messagesLastMinute expected ${N}, got ${out.messagesLastMinute}`);
  }
  console.log('PASS: messagesLastMinute == N after tracking N timestamps');

  const expectedMps = Math.round((N / 60) * 100) / 100;
  if (out.messagesPerSecond !== expectedMps) {
    fail(`messagesPerSecond expected ${expectedMps} (round(N/60, 2)), got ${out.messagesPerSecond}`);
  }
  console.log('PASS: messagesPerSecond == round(N/60, 2)');

  console.log('\n✅ Messages aggregator unit tests passed');
  process.exit(0);
}

run();
