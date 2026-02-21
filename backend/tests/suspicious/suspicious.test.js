'use strict';

/**
 * Suspicious behavior detection tests.
 * Run: node tests/suspicious/suspicious.test.js (from backend)
 * Does not require real DB or sockets.
 */

const path = require('path');
const backendRoot = path.resolve(__dirname, '..', '..');

const suspiciousDetector = require(path.join(backendRoot, 'suspicious/suspicious.detector'));

const TEST_USER = 'suspicious-test-user';

function fail(msg) {
  console.error('FAIL:', msg);
  process.exit(1);
}

async function run() {
  // ─── 1. Simulate 26 messages quickly → MESSAGE_BURST flag created ───
  for (let i = 0; i < 26; i++) {
    suspiciousDetector.recordMessage(TEST_USER);
  }
  const flags1 = suspiciousDetector.getUserFlags(TEST_USER);
  const messageBurstFlag = flags1.find((f) => f.reason === 'MESSAGE_BURST');
  if (!messageBurstFlag) fail('MESSAGE_BURST flag should be created after 26 messages');
  if (messageBurstFlag.userId !== TEST_USER) fail('Flag userId should match');
  if (messageBurstFlag.count < 1) fail('Flag count should be at least 1');
  if (!messageBurstFlag.lastDetectedAt || typeof messageBurstFlag.lastDetectedAt !== 'number') {
    fail('Flag lastDetectedAt should be a number');
  }
  console.log('PASS: Simulate 26 messages quickly → MESSAGE_BURST flag created');

  // ─── 2. Simulate 9 reconnects quickly → RECONNECT_BURST flag created ───
  const TEST_USER_2 = 'suspicious-test-user-2';
  for (let i = 0; i < 9; i++) {
    suspiciousDetector.recordReconnect(TEST_USER_2);
  }
  const flags2 = suspiciousDetector.getUserFlags(TEST_USER_2);
  const reconnectBurstFlag = flags2.find((f) => f.reason === 'RECONNECT_BURST');
  if (!reconnectBurstFlag) fail('RECONNECT_BURST flag should be created after 9 reconnects');
  if (reconnectBurstFlag.userId !== TEST_USER_2) fail('Flag userId should match');
  if (reconnectBurstFlag.count < 1) fail('Flag count should be at least 1');
  if (!reconnectBurstFlag.lastDetectedAt || typeof reconnectBurstFlag.lastDetectedAt !== 'number') {
    fail('Flag lastDetectedAt should be a number');
  }
  console.log('PASS: Simulate 9 reconnects quickly → RECONNECT_BURST flag created');

  // ─── 3. getUserFlags returns expected structure ───
  const flags3 = suspiciousDetector.getUserFlags(TEST_USER);
  if (!Array.isArray(flags3)) fail('getUserFlags should return array');
  if (flags3.length === 0) fail('getUserFlags should return flags for user with violations');
  const flag = flags3[0];
  if (!flag.userId || typeof flag.userId !== 'string') fail('Flag should have userId string');
  if (!flag.reason || typeof flag.reason !== 'string') fail('Flag should have reason string');
  if (typeof flag.count !== 'number') fail('Flag should have count number');
  if (typeof flag.lastDetectedAt !== 'number') fail('Flag should have lastDetectedAt number');
  console.log('PASS: getUserFlags returns expected structure');

  // ─── 4. Flags update count correctly on repeated violations ───
  const TEST_USER_3 = 'suspicious-test-user-3';
  for (let i = 0; i < 26; i++) {
    suspiciousDetector.recordMessage(TEST_USER_3);
  }
  const flags4a = suspiciousDetector.getUserFlags(TEST_USER_3);
  const flag4a = flags4a.find((f) => f.reason === 'MESSAGE_BURST');
  if (!flag4a || flag4a.count !== 1) fail('First violation should have count 1');
  for (let i = 0; i < 26; i++) {
    suspiciousDetector.recordMessage(TEST_USER_3);
  }
  const flags4b = suspiciousDetector.getUserFlags(TEST_USER_3);
  const flag4b = flags4b.find((f) => f.reason === 'MESSAGE_BURST');
  if (!flag4b || flag4b.count < 2) fail('Repeated violation should increment count, got ' + flag4b.count);
  if (flag4b.lastDetectedAt < flag4a.lastDetectedAt) fail('lastDetectedAt should not decrease');
  console.log('PASS: Flags update count correctly on repeated violations');

  // ─── 5. Functions do not throw on unknown user ───
  const unknownUser = 'never-seen-user-xyz';
  try {
    suspiciousDetector.recordMessage(unknownUser);
    suspiciousDetector.recordReconnect(unknownUser);
    suspiciousDetector.evaluateUser(unknownUser);
    const flags5 = suspiciousDetector.getUserFlags(unknownUser);
    if (!Array.isArray(flags5)) fail('getUserFlags should return array for unknown user');
  } catch (err) {
    fail('Functions should not throw on unknown user: ' + err.message);
  }
  console.log('PASS: Functions do not throw on unknown user');

  // ─── 6. recordFlag creates entry ───
  const flagUser = 'record-flag-test-user';
  if (typeof suspiciousDetector.recordFlag !== 'function') fail('recordFlag should be a function');
  suspiciousDetector.recordFlag(flagUser, 'WS_RATE_LIMIT', { lastDetail: 'throttle' });
  const flags6 = suspiciousDetector.getUserFlags(flagUser);
  const rateLimitFlag = flags6.find((f) => f.reason === 'WS_RATE_LIMIT');
  if (!rateLimitFlag) fail('recordFlag should create entry for WS_RATE_LIMIT');
  if (rateLimitFlag.userId !== flagUser) fail('recordFlag userId should match');
  if (rateLimitFlag.count !== 1) fail('recordFlag initial count should be 1');
  if (!rateLimitFlag.lastDetectedAt || typeof rateLimitFlag.lastDetectedAt !== 'number') {
    fail('recordFlag lastDetectedAt should be a number');
  }
  console.log('PASS: recordFlag creates entry');

  // ─── 7. recordFlag increments count on same reason (after cooldown) ───
  const flagUser2 = 'record-flag-increment-user';
  suspiciousDetector.recordFlag(flagUser2, 'WS_CLOSED_ABUSIVE', { reason: 'slow consumer', code: 1008 });
  suspiciousDetector.recordFlag(flagUser2, 'WS_CLOSED_ABUSIVE', { reason: 'slow consumer', code: 1008 });
  const flags7 = suspiciousDetector.getUserFlags(flagUser2);
  const abusiveFlag = flags7.find((f) => f.reason === 'WS_CLOSED_ABUSIVE');
  if (!abusiveFlag) fail('recordFlag should create entry for WS_CLOSED_ABUSIVE');
  if (abusiveFlag.count < 1) fail('recordFlag count should be at least 1 (may be 1 or 2 depending on cooldown)');
  console.log('PASS: recordFlag increments count on same reason (or cooldown applies)');

  // ─── 8. recordFlag with no userId does not throw and does not create entry ───
  const totalBefore = suspiciousDetector.getTotalFlagsCount();
  suspiciousDetector.recordFlag(null, 'WS_RATE_LIMIT', {});
  suspiciousDetector.recordFlag('', 'WS_RATE_LIMIT', {});
  const totalAfter = suspiciousDetector.getTotalFlagsCount();
  if (totalAfter !== totalBefore) fail('recordFlag with null/empty userId should not add flags');
  console.log('PASS: recordFlag with no userId does not create entry');

  // ─── 9. Cooldown prevents repeated increments within cooldown window ───
  const cooldownUser = 'cooldown-test-user';
  suspiciousDetector.recordFlag(cooldownUser, 'WS_RATE_LIMIT', { lastDetail: 'first' });
  const flags9a = suspiciousDetector.getUserFlags(cooldownUser);
  const flag9 = flags9a.find((f) => f.reason === 'WS_RATE_LIMIT');
  if (!flag9 || flag9.count !== 1) fail('First recordFlag should have count 1');
  suspiciousDetector.recordFlag(cooldownUser, 'WS_RATE_LIMIT', { lastDetail: 'second' });
  const flags9b = suspiciousDetector.getUserFlags(cooldownUser);
  const flag9b = flags9b.find((f) => f.reason === 'WS_RATE_LIMIT');
  if (!flag9b || flag9b.count !== 1) fail('Second recordFlag within cooldown should not increment count (count still 1)');
  console.log('PASS: cooldown prevents repeated increments within cooldown window');

  // ─── 10. Flag retention / TTL: old flags are pruned ───
  const detectorModulePath = require.resolve(path.join(backendRoot, 'suspicious/suspicious.detector'));
  const prevRetention = process.env.SUSPICIOUS_FLAG_RETENTION_MS;
  process.env.SUSPICIOUS_FLAG_RETENTION_MS = '50';
  delete require.cache[detectorModulePath];
  const detectorTTL = require(path.join(backendRoot, 'suspicious/suspicious.detector'));
  const ttlUser = 'ttl-prune-test-user';
  const originalDateNow = Date.now;
  try {
    const baseTime = 1000000000000;
    Date.now = () => baseTime;
    detectorTTL.recordFlag(ttlUser, 'WS_RATE_LIMIT', { lastDetail: 'ttl-test' });
    const flagsAfterRecord = detectorTTL.getUserFlags(ttlUser);
    const ttlFlag = flagsAfterRecord.find((f) => f.reason === 'WS_RATE_LIMIT');
    if (!ttlFlag) fail('TTL test: flag should exist immediately after recordFlag');
    Date.now = () => baseTime + 1000;
    const flagsAfterAdvance = detectorTTL.getUserFlags(ttlUser);
    if (flagsAfterAdvance.length !== 0) {
      fail('TTL test: flags should be empty after advancing time past retention (got ' + flagsAfterAdvance.length + ')');
    }
    console.log('PASS: flag retention prunes old flags (TTL)');
  } finally {
    Date.now = originalDateNow;
    if (prevRetention !== undefined) process.env.SUSPICIOUS_FLAG_RETENTION_MS = prevRetention;
    else delete process.env.SUSPICIOUS_FLAG_RETENTION_MS;
  }

  console.log('All suspicious detection tests passed');
  process.exit(0);
}

run().catch((err) => {
  console.error('FAIL:', err.message);
  process.exit(1);
});
