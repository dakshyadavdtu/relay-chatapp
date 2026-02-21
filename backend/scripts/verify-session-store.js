#!/usr/bin/env node
'use strict';

/**
 * Verify Phase 2 session store: create, list, touch, refresh hash, revoke.
 * Run from backend: node scripts/verify-session-store.js
 */

const sessionStore = require('../auth/sessionStore');

function fail(msg) {
  console.error('FAIL:', msg);
  process.exit(1);
}

async function main() {
  console.log('1. createSession({ userId, role, userAgent, ip }) -> { sessionId }');
  const { sessionId } = await sessionStore.createSession({
    userId: 'user1',
    role: 'USER',
    userAgent: 'Mozilla/1.0',
    ip: '127.0.0.1',
  });
  if (!sessionId || typeof sessionId !== 'string') fail('createSession did not return sessionId');
  console.log('   sessionId:', sessionId);

  console.log('2. getSession(sessionId)');
  const got = await sessionStore.getSession(sessionId);
  if (!got || got.userId !== 'user1' || got.role !== 'USER') fail('getSession returned wrong data');
  console.log('   userId:', got.userId, 'role:', got.role);

  console.log('3. listSessions(userId)');
  const list = await sessionStore.listSessions('user1');
  if (list.length !== 1 || list[0].sessionId !== sessionId) fail('listSessions should return one session');
  console.log('   count:', list.length);

  console.log('4. touchSession(sessionId) — throttled, no error');
  await sessionStore.touchSession(sessionId);
  console.log('   ok');

  console.log('5. storeRefreshHash + verifyRefreshHash');
  const hash = 'a'.repeat(64);
  const expiresAt = Date.now() + 86400000;
  await sessionStore.storeRefreshHash(sessionId, hash, expiresAt);
  const ok = await sessionStore.verifyRefreshHash(sessionId, hash);
  if (!ok) fail('verifyRefreshHash should be true');
  const bad = await sessionStore.verifyRefreshHash(sessionId, 'b'.repeat(64));
  if (bad) fail('verifyRefreshHash should be false for wrong hash');
  console.log('   verify ok:', ok, 'wrong hash rejected:', !bad);

  console.log('6. rotateRefreshHash');
  const newHash = 'c'.repeat(64);
  const newExpires = Date.now() + 86400000;
  const rotated = await sessionStore.rotateRefreshHash(sessionId, hash, newHash, newExpires);
  if (!rotated) fail('rotateRefreshHash should return true');
  const oldStillWorks = await sessionStore.verifyRefreshHash(sessionId, hash);
  if (oldStillWorks) fail('old hash should be invalid after rotate');
  const newWorks = await sessionStore.verifyRefreshHash(sessionId, newHash);
  if (!newWorks) fail('new hash should be valid after rotate');
  console.log('   rotate ok, old invalid, new valid');

  console.log('7. Create second session, revokeSession(sessionId)');
  const { sessionId: sid2 } = await sessionStore.createSession({
    userId: 'user1',
    role: 'USER',
  });
  const revoked = await sessionStore.revokeSession(sid2);
  if (!revoked) fail('revokeSession should return true');
  const afterRevoke = await sessionStore.getSession(sid2);
  if (!afterRevoke || !afterRevoke.revokedAt) fail('revoked session should have revokedAt set');
  const listAfter = await sessionStore.listSessions('user1');
  if (listAfter.length !== 1) fail('listSessions should return only active (1), got ' + listAfter.length);
  console.log('   revoked:', revoked, 'listSessions (active only):', listAfter.length);

  console.log('8. revokeAllSessions(userId)');
  const n = await sessionStore.revokeAllSessions('user1');
  if (n < 1) fail('revokeAllSessions should revoke at least 1');
  const listEmpty = await sessionStore.listSessions('user1');
  if (listEmpty.length !== 0) fail('listSessions should be 0 after revokeAll');
  console.log('   revoked count:', n, 'listSessions:', listEmpty.length);

  console.log('All session store checks OK.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
