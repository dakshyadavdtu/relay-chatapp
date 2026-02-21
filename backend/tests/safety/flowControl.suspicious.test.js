'use strict';

/**
 * Flow control + suspicious flag integration test.
 * Asserts that closeAbusiveConnection(ws, non-rate-limit reason) records WS_CLOSED_ABUSIVE.
 * Run from backend: node tests/safety/flowControl.suspicious.test.js
 */

const path = require('path');
const backendRoot = path.resolve(__dirname, '..', '..');
const suspiciousDetector = require(path.join(backendRoot, 'suspicious/suspicious.detector'));
const flowControl = require(path.join(backendRoot, 'websocket/safety/flowControl'));

const TEST_USER = 'flow-control-flag-test-user';

function fail(msg) {
  console.error('FAIL:', msg);
  process.exit(1);
}

function run() {
  const totalBefore = suspiciousDetector.getTotalFlagsCount();

  const ws = {
    readyState: 1,
    close() {},
    context: { userId: TEST_USER },
  };

  flowControl.closeAbusiveConnection(ws, 'Slow consumer: queue overflow', 1008);

  const totalAfter = suspiciousDetector.getTotalFlagsCount();
  if (totalAfter <= totalBefore) {
    fail('getTotalFlagsCount should increase after closeAbusiveConnection with flow-control reason');
  }

  const flags = suspiciousDetector.getUserFlags(TEST_USER);
  const abusiveFlag = flags.find((f) => f.reason === 'WS_CLOSED_ABUSIVE');
  if (!abusiveFlag) {
    fail('getUserFlags should include WS_CLOSED_ABUSIVE after closeAbusiveConnection');
  }
  if (abusiveFlag.count < 1) fail('WS_CLOSED_ABUSIVE count should be at least 1');

  console.log('PASS: closeAbusiveConnection records WS_CLOSED_ABUSIVE and total flags increment');

  process.exit(0);
}

try {
  run();
} catch (err) {
  console.error('FAIL:', err.message);
  process.exit(1);
}
