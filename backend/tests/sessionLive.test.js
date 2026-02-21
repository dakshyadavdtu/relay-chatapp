'use strict';

/**
 * Unit tests for sessionLive helpers (getLiveWindowMs, isLiveSession).
 * Run: node tests/sessionLive.test.js (from backend)
 */
const path = require('path');
const backendRoot = path.resolve(__dirname, '..');
const { getLiveWindowMs, isLiveSession } = require(path.join(backendRoot, 'utils/sessionLive'));

function fail(msg) {
  console.error('FAIL:', msg);
  process.exit(1);
}

function run() {
  const now = 1000000;

  if (isLiveSession(null, now, 60000) !== false) fail('null lastSeenAt => not live');
  if (isLiveSession(undefined, now, 60000) !== false) fail('undefined lastSeenAt => not live');
  if (isLiveSession(now, now, 60000) !== true) fail('lastSeenAt === now => live');
  if (isLiveSession(now - 30000, now, 60000) !== true) fail('30s ago within 60s => live');
  if (isLiveSession(now - 60000, now, 60000) !== true) fail('exactly 60s ago => live (<=)');
  if (isLiveSession(now - 60001, now, 60000) !== false) fail('61s ago => not live');
  if (isLiveSession(new Date(now - 10000), now, 60000) !== true) fail('Date 10s ago => live');

  const config = { HEARTBEAT: { timeout: 45000 } };
  if (getLiveWindowMs(config) !== 45000) fail('getLiveWindowMs should return config.HEARTBEAT.timeout');
  if (getLiveWindowMs({}) !== 60000) fail('missing HEARTBEAT => default 60000');

  console.log('PASS: sessionLive unit tests');
  process.exit(0);
}

run();
