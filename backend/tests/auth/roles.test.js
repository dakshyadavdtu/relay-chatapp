'use strict';

/**
 * Role middleware and access tests.
 * Run: node tests/auth/roles.test.js (from backend)
 * Does not require real DB.
 */

const path = require('path');
const backendRoot = path.resolve(__dirname, '..', '..');

const { ROLES } = require(path.join(backendRoot, 'auth/roles'));
const { requireAdmin } = require(path.join(backendRoot, 'http/middleware/requireRole'));
const adminController = require(path.join(backendRoot, 'http/controllers/admin.controller'));
const userStoreStorage = require(path.join(backendRoot, 'storage/user.store'));

function fail(msg) {
  console.error('FAIL:', msg);
  process.exit(1);
}

function runMiddlewareSync(middleware, req, res) {
  let nextCalled = false;
  middleware(req, res, () => { nextCalled = true; });
  return nextCalled;
}

async function run() {
  // ─── 1. USER cannot access diagnostics (ADMIN only) ───
  const reqUser = { user: { userId: 'u1', role: ROLES.USER } };
  const res1 = { statusCode: null, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  runMiddlewareSync(requireAdmin, reqUser, res1);
  if (res1.statusCode !== 403) fail('USER should get 403 for diagnostics, got ' + res1.statusCode);
  if (!res1.body || res1.body.code !== 'FORBIDDEN') fail('USER should get FORBIDDEN code');
  console.log('PASS: USER cannot access diagnostics');

  // ─── 2. ADMIN can access diagnostics ───
  const reqAdmin = { user: { userId: 'a1', role: ROLES.ADMIN } };
  const res2 = { statusCode: null, status() { return this; }, json() { return this; } };
  const nextCalled2 = runMiddlewareSync(requireAdmin, reqAdmin, res2);
  if (!nextCalled2) fail('ADMIN should pass through to next()');
  console.log('PASS: ADMIN can access diagnostics');

  // ─── 3. USER cannot promote roles ───
  const reqUserPromote = { user: { userId: 'u2', role: ROLES.USER } };
  const res3 = { statusCode: null, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  runMiddlewareSync(requireAdmin, reqUserPromote, res3);
  if (res3.statusCode !== 403) fail('USER should get 403 for promote, got ' + res3.statusCode);
  if (!res3.body || res3.body.code !== 'FORBIDDEN') fail('USER should get FORBIDDEN code');
  console.log('PASS: USER cannot promote roles');

  // ─── 4. Root admin can promote roles (only root can change roles) ───
  await userStoreStorage.createDevUser('user1', ROLES.USER);
  const reqRootPromote = {
    user: { userId: 'admin1', role: ROLES.ADMIN, isRootAdmin: true },
    params: { id: 'user1' },
    body: { role: ROLES.ADMIN },
  };
  const res4 = { statusCode: null, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  await adminController.promoteUserToAdmin(reqRootPromote, res4);
  if (res4.statusCode !== 200) fail('Root ADMIN should get 200 when promoting, got ' + res4.statusCode + ' ' + JSON.stringify(res4.body));
  if (!res4.body || !res4.body.success) fail('Root promote should return success');
  const promotedUser = await userStoreStorage.findById('user1');
  if (!promotedUser || promotedUser.role !== ROLES.ADMIN) fail('Target user role should be updated to ADMIN');
  console.log('PASS: Root admin can promote roles');

  // ─── 5. Non-root ADMIN cannot promote roles ───
  await userStoreStorage.createDevUser('user2', ROLES.USER);
  const reqNonRootAdmin = {
    user: { userId: 'admin2', role: ROLES.ADMIN, isRootAdmin: false },
    params: { id: 'user2' },
    body: { role: ROLES.ADMIN },
  };
  const res5 = { statusCode: null, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  await adminController.promoteUserToAdmin(reqNonRootAdmin, res5);
  if (res5.statusCode !== 403) fail('Non-root ADMIN should get 403 when promoting, got ' + res5.statusCode);
  if (!res5.body || res5.body.code !== 'ROOT_REQUIRED') fail('Non-root promote should return ROOT_REQUIRED');
  console.log('PASS: Non-root ADMIN cannot promote roles');

  console.log('All role tests passed');
  process.exit(0);
}

run().catch((err) => {
  console.error('FAIL:', err.message);
  process.exit(1);
});
