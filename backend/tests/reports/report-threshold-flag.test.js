'use strict';

/**
 * Regression test: when N reports are created within the threshold window,
 * the target user gets a REPORT_THRESHOLD suspicious flag (on the Nth report only).
 *
 * Run: cd backend && node -r dotenv/config tests/reports/report-threshold-flag.test.js
 */

const path = require('path');
const backendRoot = path.resolve(__dirname, '..', '..');

const reportsStore = require(path.join(backendRoot, 'storage/reports.store'));

function fail(msg) {
  console.error('FAIL:', msg);
  process.exit(1);
}

function mockReq(overrides = {}) {
  return {
    user: { userId: 'user_reporter_1' },
    body: { targetUserId: 'target_user_1', reason: 'spam' },
    ...overrides,
  };
}

function mockRes() {
  const out = { statusCode: null, body: null };
  return {
    status(code) {
      out.statusCode = code;
      return this;
    },
    json(data) {
      out.body = data;
      return this;
    },
    getOut() {
      return out;
    },
  };
}

async function run() {
  await reportsStore.clear();

  process.env.REPORT_THRESHOLD_COUNT = '3';
  process.env.REPORT_THRESHOLD_WINDOW_HOURS = '24';

  const detectorPath = require.resolve(path.join(backendRoot, 'suspicious/suspicious.detector'));
  const controllerPath = require.resolve(path.join(backendRoot, 'http/controllers/reports.controller'));
  delete require.cache[detectorPath];
  delete require.cache[controllerPath];

  const reportsController = require(path.join(backendRoot, 'http/controllers/reports.controller'));
  const suspiciousDetector = require(path.join(backendRoot, 'suspicious/suspicious.detector'));

  const targetUserId = 'target_user_1';

  for (let i = 0; i < 2; i++) {
    const req = mockReq();
    const res = mockRes();
    await reportsController.createReport(req, res);
    const out = res.getOut();
    if (out.statusCode !== 201) fail(`Report ${i + 1} expected 201, got ${out.statusCode}`);
    const flags = suspiciousDetector.getUserFlags(targetUserId);
    const reportThreshold = flags.find((f) => f.reason === 'REPORT_THRESHOLD');
    if (reportThreshold) {
      fail(`After ${i + 1} report(s), REPORT_THRESHOLD should not exist yet, got ${JSON.stringify(reportThreshold)}`);
    }
  }

  const req3 = mockReq();
  const res3 = mockRes();
  await reportsController.createReport(req3, res3);
  const out3 = res3.getOut();
  if (out3.statusCode !== 201) fail(`Report 3 expected 201, got ${out3.statusCode}`);

  const flagsAfter3 = suspiciousDetector.getUserFlags(targetUserId);
  const flag = flagsAfter3.find((f) => f.reason === 'REPORT_THRESHOLD');
  if (!flag) fail('After 3 reports, REPORT_THRESHOLD flag must exist. Flags: ' + JSON.stringify(flagsAfter3));
  if (typeof flag.count !== 'number' || flag.count < 1) fail('REPORT_THRESHOLD flag.count must be >= 1, got ' + flag.count);
  const detail = flag.lastDetail != null ? String(flag.lastDetail) : '';
  if (!detail.includes('count=3/3')) fail('REPORT_THRESHOLD lastDetail must contain "count=3/3", got: ' + detail);

  console.log('PASS report threshold -> suspicious flag');
  process.exit(0);
}

run().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
