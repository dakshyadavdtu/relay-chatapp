#!/usr/bin/env node
'use strict';

/**
 * JWT access token clock tolerance (skew) — access tokens only.
 * - token exp = now-10s => still accepted (within 30s skew)
 * - token exp = now-60s => rejected
 * Refresh flow is unchanged (opaque tokens; no JWT exp skew).
 *
 * Run: node -r dotenv/config tests/auth/jwt-clock-skew.test.js (from backend)
 */

const path = require('path');
const backendRoot = path.resolve(__dirname, '..', '..');
const { signJwt, verifyJwt, ACCESS_TOKEN_CLOCK_TOLERANCE_MS } = require(path.join(backendRoot, 'utils/jwt'));
const tokenService = require(path.join(backendRoot, 'auth/tokenService'));

function fail(msg) {
  console.error('FAIL:', msg);
  process.exit(1);
}

async function run() {
  const payload = { userId: 'clock-skew-user', sid: 's1', role: 'USER' };

  // Token that expired 10 seconds ago: within 30s tolerance => verifyAccess should accept
  const tokenExpired10sAgo = signJwt(payload, -10);
  const result10 = tokenService.verifyAccess(tokenExpired10sAgo);
  if (!result10 || result10.userId !== payload.userId) {
    fail(`token exp=now-10s: expected accepted (within skew), got ${result10 ? result10.userId : 'null'}`);
  }
  console.log('PASS: token exp=now-10s => accepted (within 30s skew)');

  // Token that expired 60 seconds ago: beyond 30s tolerance => verifyAccess should reject
  const tokenExpired60sAgo = signJwt(payload, -60);
  const result60 = tokenService.verifyAccess(tokenExpired60sAgo);
  if (result60 !== null) {
    fail(`token exp=now-60s: expected rejected, got userId=${result60.userId}`);
  }
  console.log('PASS: token exp=now-60s => rejected');

  // Strict verifyJwt (no tolerance) still rejects exp=now-10s
  const strictResult = verifyJwt(tokenExpired10sAgo, undefined, {});
  if (strictResult !== null) {
    fail('verifyJwt with no tolerance: exp=now-10s should be rejected');
  }
  console.log('PASS: verifyJwt without clockToleranceMs rejects exp=now-10s');

  console.log('\n✅ JWT clock skew tests passed');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
