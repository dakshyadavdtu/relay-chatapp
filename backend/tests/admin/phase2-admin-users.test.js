'use strict';

// Required before any require() that loads auth (jwt.js validates at load time)
if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'test-secret-phase2';

/**
 * Phase 2 Admin Users acceptance tests.
 * A) GET /api/admin/users stable keys and types
 * B) GET /api/admin/diagnostics/:userId stable shape + 404 for random id
 * C) Revoke single session ownership -> 403 when revoking other user's session
 * D) Ban blocks login -> 403 ACCOUNT_BANNED
 * Run: node tests/admin/phase2-admin-users.test.js (from backend)
 */

const path = require('path');
const backendRoot = path.resolve(__dirname, '../..');
const adminController = require(path.join(backendRoot, 'http/controllers/admin.controller'));
const authController = require(path.join(backendRoot, 'http/controllers/auth.controller'));
const userStoreStorage = require(path.join(backendRoot, 'storage/user.store'));
const authSessionStore = require(path.join(backendRoot, 'auth/sessionStore'));
const userService = require(path.join(backendRoot, 'services/user.service'));
const bcrypt = require('bcrypt');

function fail(msg) {
  console.error('FAIL:', msg);
  process.exit(1);
}

function mockReq(user = { userId: 'dev_admin', role: 'ADMIN' }, overrides = {}) {
  return {
    user: { ...user },
    params: {},
    query: {},
    body: {},
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
  // ─── A) GET /api/admin/users stable keys and types ───
  const usersReq = mockReq();
  usersReq.query = {};
  const usersRes = mockRes();
  adminController.getUsers(usersReq, usersRes);
  const usersOut = usersRes.getOut();
  if (usersOut.statusCode !== 200) fail(`GET /admin/users expected 200, got ${usersOut.statusCode}`);
  const data = usersOut.body?.data || usersOut.body;
  if (!data || !Array.isArray(data.users)) fail('GET /admin/users must return data.users array');
  const requiredUserKeys = [
    'id', 'username', 'role', 'status', 'banned', 'flagged', 'lastSeen',
    'messages', 'reconnects', 'failures', 'violations', 'avgLatencyMs', 'email',
  ];
  for (const u of data.users) {
    for (const k of requiredUserKeys) {
      if (!(k in u)) fail(`User object missing key: ${k}`);
    }
    if (typeof u.messages !== 'number') fail('User.messages must be number');
    if (typeof u.reconnects !== 'number') fail('User.reconnects must be number');
    if (typeof u.failures !== 'number') fail('User.failures must be number');
    if (typeof u.violations !== 'number') fail('User.violations must be number');
    if (typeof u.banned !== 'boolean') fail('User.banned must be boolean');
    if (u.avgLatencyMs !== null && typeof u.avgLatencyMs !== 'number') fail('User.avgLatencyMs must be number or null');
    const role = (u.role || '').toLowerCase();
    if (!['admin', 'user'].includes(role)) fail(`User.role must be admin|user, got ${u.role}`);
  }
  console.log('PASS: GET /api/admin/users stable keys and types');

  // ─── B) GET /api/admin/diagnostics/:userId stable shape + 404 for random id ───
  const existingUserId = data.users.length > 0 ? data.users[0].id : 'dev_admin';
  const diagReq = mockReq();
  diagReq.params = { userId: existingUserId };
  const diagRes = mockRes();
  adminController.getDiagnostics(diagReq, diagRes);
  const diagOut = diagRes.getOut();
  if (diagOut.statusCode !== 200) fail(`GET /admin/diagnostics/:userId expected 200, got ${diagOut.statusCode}`);
  const diagData = diagOut.body?.data || diagOut.body;
  if (!diagData) fail('Diagnostics must return data');
  const requiredDiagKeys = ['userId', 'timestamp', 'online', 'metrics', 'lastActivityAt', 'suspiciousFlags', 'notes'];
  for (const k of requiredDiagKeys) {
    if (!(k in diagData)) fail(`Diagnostics missing key: ${k}`);
  }
  const m = diagData.metrics;
  if (!m || typeof m !== 'object') fail('Diagnostics.metrics must be object');
  const metricKeys = ['messagesWindow', 'reconnectsWindow', 'deliveryFailuresWindow', 'violationsWindow', 'avgLatencyMs'];
  for (const k of metricKeys) {
    if (!(k in m)) fail(`Diagnostics.metrics missing key: ${k}`);
  }
  if (typeof m.messagesWindow !== 'number') fail('metrics.messagesWindow must be number');
  if (m.avgLatencyMs !== null && typeof m.avgLatencyMs !== 'number') fail('metrics.avgLatencyMs must be number or null');
  if (!Array.isArray(diagData.notes)) fail('Diagnostics.notes must be array');
  console.log('PASS: GET /api/admin/diagnostics/:userId stable shape');

  const randomIdReq = mockReq();
  randomIdReq.params = { userId: 'random-nonexistent-user-id-404' };
  const randomIdRes = mockRes();
  adminController.getDiagnostics(randomIdReq, randomIdRes);
  const randomOut = randomIdRes.getOut();
  if (randomOut.statusCode !== 404) fail(`GET /admin/diagnostics random id expected 404, got ${randomOut.statusCode}`);
  if (randomOut.body?.code !== 'NOT_FOUND') fail('Random id must return code NOT_FOUND');
  if (randomOut.body?.success !== false) fail('404 must return success: false');
  console.log('PASS: GET /api/admin/diagnostics random id -> 404 NOT_FOUND');

  // ─── C) Revoke single session ownership: revoking other user's session -> 403 ───
  const uidA = 'phase2_revoke_user_a';
  const uidB = 'phase2_revoke_user_b';
  try {
    userStoreStorage.createDevUser(uidA, 'USER');
  } catch (_) {
    /* may exist */
  }
  try {
    userStoreStorage.createDevUser(uidB, 'USER');
  } catch (_) {
    /* may exist */
  }
  const { sessionId: sessionB } = await authSessionStore.createSession({ userId: uidB, role: 'USER' });
  const revokeOtherReq = mockReq();
  revokeOtherReq.params = { id: uidA, sessionId: sessionB };
  const revokeOtherRes = mockRes();
  await adminController.revokeOneSession(revokeOtherReq, revokeOtherRes);
  const revokeOtherOut = revokeOtherRes.getOut();
  if (revokeOtherOut.statusCode !== 403) fail(`Revoke other user's session expected 403, got ${revokeOtherOut.statusCode}`);
  if (revokeOtherOut.body?.code !== 'FORBIDDEN') fail('Revoke other session must return code FORBIDDEN');
  if (revokeOtherOut.body?.success !== false) fail('403 must return success: false');
  console.log('PASS: Revoke single session ownership -> 403 FORBIDDEN');

  // ─── D) Ban blocks login -> 403 ACCOUNT_BANNED ───
  const banTestUser = 'phase2_ban_login_test';
  try {
    userStoreStorage.createDevUser(banTestUser, 'USER');
  } catch (_) {
    /* may exist */
  }
  const hash = await bcrypt.hash('pass123', 10);
  userStoreStorage.updatePasswordHash(banTestUser, hash);
  const banReq = mockReq({ userId: 'dev_admin', role: 'ADMIN' });
  banReq.params = { id: banTestUser };
  const banRes = mockRes();
  await adminController.banUser(banReq, banRes);
  if (banRes.getOut().statusCode !== 200) fail('Ban user expected 200');
  const loginReq = {
    body: { username: banTestUser, password: 'pass123' },
  };
  const loginRes = mockRes();
  await authController.login(loginReq, loginRes);
  const loginOut = loginRes.getOut();
  if (loginOut.statusCode !== 403) fail(`Login after ban expected 403, got ${loginOut.statusCode}`);
  if (loginOut.body?.code !== 'ACCOUNT_BANNED') fail('Login after ban must return code ACCOUNT_BANNED');
  if (loginOut.body?.success !== false) fail('403 must return success: false');
  userStoreStorage.setUnbanned(banTestUser);
  console.log('PASS: Ban blocks login -> 403 ACCOUNT_BANNED');

  console.log('\n✅ Phase 2 Admin Users acceptance tests passed');
  process.exit(0);
}

run().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
