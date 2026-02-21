'use strict';

/**
 * Observability "never throws" safety tests.
 * Calls each exported function with bad inputs; asserts no throw and safe default shapes.
 * Run from backend: node tests/observability.safety.test.js
 */
if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'test-secret-observability';

const path = require('path');
const backendRoot = path.resolve(__dirname, '..');

function fail(msg) {
  console.error('FAIL:', msg);
  process.exit(1);
}

function assertNoThrow(fn, label) {
  try {
    fn();
  } catch (e) {
    fail(`${label}: threw ${e?.message || e}`);
  }
}

function assertObjectWithKeys(obj, keys, label) {
  if (!obj || typeof obj !== 'object') fail(`${label}: expected object, got ${typeof obj}`);
  for (const k of keys) {
    if (!(k in obj)) fail(`${label}: missing key ${k}`);
  }
}

function assertNumber(val, label) {
  if (typeof val !== 'number' || !Number.isFinite(val) || val < 0) {
    fail(`${label}: expected non-negative number, got ${typeof val}`);
  }
}

function run() {
  let out;

  // ─── snapshot ───
  const snapshot = require(path.join(backendRoot, 'observability/snapshot'));
  assertNoThrow(() => snapshot.assembleSnapshot(null), 'assembleSnapshot(null)');
  assertNoThrow(() => snapshot.assembleSnapshot(undefined), 'assembleSnapshot(undefined)');
  assertNoThrow(() => snapshot.assembleSnapshot({}), 'assembleSnapshot({})');
  assertNoThrow(() => snapshot.assembleSnapshot({ devtools: true }), 'assembleSnapshot({ devtools: true })');
  assertNoThrow(() => snapshot.assembleSnapshot(''), 'assembleSnapshot("")');
  assertNoThrow(() => snapshot.assembleSnapshot(NaN), 'assembleSnapshot(NaN)');
  out = snapshot.assembleSnapshot(null);
  assertObjectWithKeys(out, ['overview', 'network', 'events', 'state'], 'assembleSnapshot(null) return');
  assertObjectWithKeys(out.overview, ['connections', 'messages'], 'assembleSnapshot overview');
  assertObjectWithKeys(out.network, ['connections', 'latency'], 'assembleSnapshot network');
  console.log('PASS: snapshot.js');

  // ─── adminDashboardBuffer ───
  const adminDashboardBuffer = require(path.join(backendRoot, 'observability/adminDashboardBuffer'));
  assertNoThrow(() => adminDashboardBuffer.getSeries(null), 'getSeries(null)');
  assertNoThrow(() => adminDashboardBuffer.getSeries(undefined), 'getSeries(undefined)');
  assertNoThrow(() => adminDashboardBuffer.getSeries({}), 'getSeries({})');
  assertNoThrow(() => adminDashboardBuffer.getSeries('bad'), 'getSeries("bad")');
  out = adminDashboardBuffer.getSeries({});
  assertObjectWithKeys(out, ['windowSeconds', 'intervalSeconds', 'points'], 'getSeries return');
  if (!Array.isArray(out.points)) fail('getSeries().points must be array');
  assertNoThrow(() => adminDashboardBuffer.getExtendedStats(), 'getExtendedStats()');
  out = adminDashboardBuffer.getExtendedStats();
  if (out == null || typeof out !== 'object') fail('getExtendedStats must return object');
  console.log('PASS: adminDashboardBuffer.js');

  // ─── messages aggregator (empty + bad inputs) ───
  const messagesAgg = require(path.join(backendRoot, 'observability/aggregators/messages'));
  assertNoThrow(() => messagesAgg.getMessagesSummary(null), 'getMessagesSummary(null)');
  assertNoThrow(() => messagesAgg.getMessagesSummary(undefined), 'getMessagesSummary(undefined)');
  assertNoThrow(() => messagesAgg.getMessagesSummary(NaN), 'getMessagesSummary(NaN)');
  assertNoThrow(() => messagesAgg.getMessagesSummary(''), 'getMessagesSummary("")');
  assertNoThrow(() => messagesAgg.trackPersistedMessageTimestamp(), 'trackPersistedMessageTimestamp()');
  assertNoThrow(() => messagesAgg.trackPersistedMessageTimestamp(null), 'trackPersistedMessageTimestamp(null)');
  out = messagesAgg.getMessagesSummary(null);
  assertObjectWithKeys(out, ['totalMessages', 'messagesPerSecond', 'messagesLastMinute'], 'getMessagesSummary return');
  assertObjectWithKeys(out.totalMessages, ['received', 'sent'], 'getMessagesSummary.totalMessages');
  assertNumber(out.totalMessages.received, 'getMessagesSummary.totalMessages.received');
  assertNumber(out.totalMessages.sent, 'getMessagesSummary.totalMessages.sent');
  if (typeof out.messagesPerSecond !== 'number') fail('getMessagesSummary().messagesPerSecond must be number');
  console.log('PASS: aggregators/messages.js (empty + bad inputs)');

  // ─── latency aggregator (empty + bad inputs) ───
  const latencyAgg = require(path.join(backendRoot, 'observability/aggregators/latency'));
  assertNoThrow(() => latencyAgg.getLatencySummary(null), 'getLatencySummary(null)');
  assertNoThrow(() => latencyAgg.getLatencySummary(undefined), 'getLatencySummary(undefined)');
  assertNoThrow(() => latencyAgg.getLatencySummary(NaN), 'getLatencySummary(NaN)');
  assertNoThrow(() => latencyAgg.getLatencySummary(''), 'getLatencySummary("")');
  assertNoThrow(() => latencyAgg.recordLatency(null), 'recordLatency(null)');
  assertNoThrow(() => latencyAgg.recordLatency(undefined), 'recordLatency(undefined)');
  assertNoThrow(() => latencyAgg.recordLatency('x'), 'recordLatency("x")');
  assertNoThrow(() => latencyAgg.recordLatency(NaN), 'recordLatency(NaN)');
  assertNoThrow(() => latencyAgg.recordLatency(-1), 'recordLatency(-1)');
  assertNoThrow(() => latencyAgg.recordLatency(10), 'recordLatency(10)');
  out = latencyAgg.getLatencySummary(null);
  assertObjectWithKeys(out, ['avgLatency', 'p95Latency', 'maxLatency', 'sampleCount'], 'getLatencySummary return');
  assertNumber(out.avgLatency, 'getLatencySummary.avgLatency');
  assertNumber(out.p95Latency, 'getLatencySummary.p95Latency');
  assertNumber(out.maxLatency, 'getLatencySummary.maxLatency');
  assertNumber(out.sampleCount, 'getLatencySummary.sampleCount');
  console.log('PASS: aggregators/latency.js (empty + bad inputs)');

  // ─── connections aggregator (sessionStore returns [] equivalent) ───
  const connectionsAgg = require(path.join(backendRoot, 'observability/aggregators/connections'));
  assertNoThrow(() => connectionsAgg.getConnectionsSummary(null), 'getConnectionsSummary(null)');
  assertNoThrow(() => connectionsAgg.getConnectionsSummary(null, true), 'getConnectionsSummary(null, true)');
  assertNoThrow(() => connectionsAgg.getConnectionsSummary({}, false), 'getConnectionsSummary({}, false)');
  assertNoThrow(() => connectionsAgg.getConnectionsSummary(NaN, false), 'getConnectionsSummary(NaN, false)');
  assertNoThrow(() => connectionsAgg.getConnectionsSummary('', true), 'getConnectionsSummary("", true)');
  out = connectionsAgg.getConnectionsSummary(null);
  assertObjectWithKeys(out, ['total'], 'getConnectionsSummary return');
  if (typeof out.total !== 'number' || out.total < 0) fail('getConnectionsSummary().total must be number >= 0');
  if (!out.countByRole || typeof out.countByRole !== 'object') fail('getConnectionsSummary().countByRole must be object');
  assertObjectWithKeys(out.countByRole, ['admin', 'user'], 'getConnectionsSummary.countByRole');
  console.log('PASS: aggregators/connections.js');

  // ─── adminActivityBuffer (overfilled + bad inputs) ───
  const adminActivityBuffer = require(path.join(backendRoot, 'observability/adminActivityBuffer'));
  assertNoThrow(() => adminActivityBuffer.recordEvent(null), 'recordEvent(null)');
  assertNoThrow(() => adminActivityBuffer.recordEvent(undefined), 'recordEvent(undefined)');
  assertNoThrow(() => adminActivityBuffer.recordEvent({}), 'recordEvent({})');
  assertNoThrow(() => adminActivityBuffer.recordEvent({ type: 'connect', title: 't', detail: 'd' }), 'recordEvent(connect)');
  for (let i = 0; i < 100; i++) {
    assertNoThrow(() => adminActivityBuffer.recordEvent({ type: 'info', title: 'overfill', detail: String(i) }), `recordEvent(overfill ${i})`);
  }
  assertNoThrow(() => adminActivityBuffer.getEvents({ maxEvents: 50 }), 'getEvents after overfill');
  out = adminActivityBuffer.getEvents({ maxEvents: 50 });
  assertObjectWithKeys(out, ['windowSeconds', 'maxEvents', 'events'], 'getEvents return');
  if (!Array.isArray(out.events)) fail('getEvents().events must be array');
  if (out.events.length > 50) fail('getEvents().events must be bounded by maxEvents (50)');
  assertNoThrow(() => adminActivityBuffer.getEvents(null), 'getEvents(null)');
  assertNoThrow(() => adminActivityBuffer.getEvents(undefined), 'getEvents(undefined)');
  assertNoThrow(() => adminActivityBuffer.getEvents({ windowSeconds: 'x', maxEvents: 'y' }), 'getEvents(bad opts)');
  out = adminActivityBuffer.getEvents({});
  if (typeof out.windowSeconds !== 'number' || !Number.isFinite(out.windowSeconds)) fail('getEvents().windowSeconds must be finite number');
  if (typeof out.maxEvents !== 'number' || !Number.isFinite(out.maxEvents)) fail('getEvents().maxEvents must be finite number');
  console.log('PASS: adminActivityBuffer.js (overfilled + bad inputs)');

  console.log('\n✅ Observability safety tests passed');
  process.exit(0);
}

run();
