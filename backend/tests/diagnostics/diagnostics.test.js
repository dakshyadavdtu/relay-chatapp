'use strict';

/**
 * Diagnostics aggregator and snapshot tests.
 * Run: node tests/diagnostics/diagnostics.test.js (from backend)
 * Does not require real DB.
 */

const path = require('path');
const backendRoot = path.resolve(__dirname, '..', '..');

const userDiagnostics = require(path.join(backendRoot, 'diagnostics/userDiagnosticsAggregator'));
const { buildUserSnapshot } = require(path.join(backendRoot, 'diagnostics/console.snapshot'));

const TEST_USER = 'diagnostics-test-user';

function fail(msg) {
  console.error('FAIL:', msg);
  process.exit(1);
}

async function run() {
  // Reset: ensure user and read baseline
  userDiagnostics.ensureUser(TEST_USER);
  const d0 = userDiagnostics.getUserDiagnostics(TEST_USER);
  if (!d0) fail('ensureUser should create diagnostics');

  // ─── 1. onMessageSent increments counters ───
  const beforeMessages = d0.messageCountWindow;
  userDiagnostics.onMessageSent(TEST_USER);
  userDiagnostics.onMessageSent(TEST_USER);
  const d1 = userDiagnostics.getUserDiagnostics(TEST_USER);
  if (d1.messageCountWindow !== beforeMessages + 2) {
    fail('onMessageSent should increment messageCountWindow by 2, got ' + d1.messageCountWindow);
  }
  if (d1.lastActivity == null) fail('onMessageSent should set lastActivity');
  console.log('PASS: onMessageSent increments counters');

  // ─── 2. onReconnect increments reconnectCount ───
  const beforeReconnect = d1.reconnectCount;
  userDiagnostics.onReconnect(TEST_USER);
  userDiagnostics.onReconnect(TEST_USER);
  const d2 = userDiagnostics.getUserDiagnostics(TEST_USER);
  if (d2.reconnectCount !== beforeReconnect + 2) {
    fail('onReconnect should increment reconnectCount by 2, got ' + d2.reconnectCount);
  }
  console.log('PASS: onReconnect increments reconnectCount');

  // ─── 3. onDeliveryFail increments deliveryFailures ───
  const beforeFailures = d2.deliveryFailures;
  userDiagnostics.onDeliveryFail(TEST_USER);
  const d3 = userDiagnostics.getUserDiagnostics(TEST_USER);
  if (d3.deliveryFailures !== beforeFailures + 1) {
    fail('onDeliveryFail should increment deliveryFailures, got ' + d3.deliveryFailures);
  }
  console.log('PASS: onDeliveryFail increments deliveryFailures');

  // ─── 4. buildUserSnapshot returns valid structure ───
  const snapshot = buildUserSnapshot(TEST_USER);
  if (!snapshot || typeof snapshot !== 'object') fail('buildUserSnapshot should return object');
  if (typeof snapshot.connectionStatus !== 'string') fail('snapshot.connectionStatus required');
  if (!snapshot.messageSummary || typeof snapshot.messageSummary.totalMessages !== 'number') {
    fail('snapshot.messageSummary.totalMessages required');
  }
  if (!Array.isArray(snapshot.flags)) fail('snapshot.flags must be array');
  if (snapshot.reconnectCount !== d3.reconnectCount) fail('snapshot.reconnectCount should match store');
  if (snapshot.deliveryFailures !== d3.deliveryFailures) fail('snapshot.deliveryFailures should match store');
  if (snapshot.lastActivity !== d3.lastActivity) fail('snapshot.lastActivity should match store');
  console.log('PASS: buildUserSnapshot returns valid structure');

  // ─── 5. Endpoint returns Phase 2 stable shape (userId, timestamp ISO, online, metrics, lastActivityAt, suspiciousFlags, notes) ───
  const adminController = require(path.join(backendRoot, 'http/controllers/admin.controller'));
  const captured = { statusCode: null, body: null };
  const req = { params: { userId: TEST_USER } };
  const res = {
    status(code) {
      captured.statusCode = code;
      return this;
    },
    json(obj) {
      captured.body = obj;
      return this;
    },
  };
  await adminController.getDiagnostics(req, res);
  if (captured.statusCode !== 200) fail('GET /admin/diagnostics/:userId should return 200, got ' + captured.statusCode);
  const payload = captured.body?.data || captured.body;
  if (!payload) fail('Response should include data');
  if (payload.userId !== TEST_USER) fail('Response should include userId');
  if (typeof payload.timestamp !== 'string') fail('Response should include timestamp (ISO string)');
  if (typeof payload.online !== 'boolean') fail('Response should include online (boolean)');
  if (!payload.metrics || typeof payload.metrics !== 'object') fail('Response should include metrics object');
  const m = payload.metrics;
  if (typeof m.messagesWindow !== 'number') fail('metrics.messagesWindow should be number');
  if (typeof m.reconnectsWindow !== 'number') fail('metrics.reconnectsWindow should be number');
  if (typeof m.deliveryFailuresWindow !== 'number') fail('metrics.deliveryFailuresWindow should be number');
  if (typeof m.violationsWindow !== 'number') fail('metrics.violationsWindow should be number');
  if (m.reconnectsWindow !== d3.reconnectCount) fail('Endpoint metrics.reconnectsWindow should match store');
  if (m.deliveryFailuresWindow !== d3.deliveryFailures) fail('Endpoint metrics.deliveryFailuresWindow should match store');
  if (!Array.isArray(payload.notes)) fail('Response should include notes array');
  if (typeof payload.suspiciousFlags !== 'number') fail('Response should include suspiciousFlags (number)');
  console.log('PASS: Endpoint returns Phase 2 stable shape');

  // 404 for unknown user (code NOT_FOUND)
  const req404 = { params: { userId: 'never-seen-user-404' } };
  const res404 = { statusCode: null, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  await adminController.getDiagnostics(req404, res404);
  if (res404.statusCode !== 404) fail('Unknown user should return 404, got ' + res404.statusCode);
  if (res404.body?.code !== 'NOT_FOUND') fail('404 should return code NOT_FOUND');
  console.log('PASS: Unknown user returns 404 NOT_FOUND');

  console.log('All diagnostics tests passed');
  process.exit(0);
}

run().catch((err) => {
  console.error('FAIL:', err.message);
  process.exit(1);
});
