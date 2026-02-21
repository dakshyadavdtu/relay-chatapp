'use strict';

/**
 * Socket safety rate limiter + suspicious flag integration test.
 * Triggers rate limit violations and asserts suspicious flags increment.
 * Run from backend: node tests/safety/socketSafety.suspicious.test.js
 */

const path = require('path');
const backendRoot = path.resolve(__dirname, '..', '..');

const suspiciousDetector = require(path.join(backendRoot, 'suspicious/suspicious.detector'));
const connectionStore = require(path.join(backendRoot, 'websocket/state/connectionStore'));
const socketSafety = require(path.join(backendRoot, 'websocket/safety/socketSafety'));
const config = require(path.join(backendRoot, 'config/constants'));

const TEST_USER = 'rate-limit-flag-test-user';

function fail(msg) {
  console.error('FAIL:', msg);
  process.exit(1);
}

function run() {
  const totalBefore = suspiciousDetector.getTotalFlagsCount();

  const ws = {};
  connectionStore.setSocketUser(ws, TEST_USER);
  socketSafety.initSocket(ws);

  const data = JSON.stringify({ type: 'PING' });
  const maxMessages = config.RATE_LIMIT.maxMessages || 100;
  let violationCount = 0;
  const maxCalls = maxMessages + 20;

  for (let i = 0; i < maxCalls; i++) {
    const result = socketSafety.validateIncomingMessage(ws, data, {});
    if (!result.valid && result.code === 'RATE_LIMIT_EXCEEDED') {
      violationCount++;
      if (violationCount >= 2) break;
    }
  }

  const totalAfter = suspiciousDetector.getTotalFlagsCount();
  if (totalAfter <= totalBefore && violationCount > 0) {
    fail('getTotalFlagsCount should increase after rate limit violations (violations=' + violationCount + ')');
  }

  const flags = suspiciousDetector.getUserFlags(TEST_USER);
  const rateLimitFlag = flags.find((f) => f.reason === 'WS_RATE_LIMIT' || f.reason === 'WS_RATE_LIMIT_CLOSE');
  if (violationCount > 0 && !rateLimitFlag) {
    fail('getUserFlags should include WS_RATE_LIMIT or WS_RATE_LIMIT_CLOSE after rate limit violations');
  }

  socketSafety.cleanupSocket(ws);
  console.log('PASS: rate limit violations trigger suspicious flags (violations=' + violationCount + ', totalDelta=' + (totalAfter - totalBefore) + ')');
  process.exit(0);
}

try {
  run();
} catch (err) {
  console.error('FAIL:', err.message);
  process.exit(1);
}
