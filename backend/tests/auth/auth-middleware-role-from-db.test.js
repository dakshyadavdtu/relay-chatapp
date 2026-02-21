#!/usr/bin/env node
'use strict';

/**
 * PHASE 4 — Auth middleware uses role from DB, not JWT.
 * Ensures: token with role USER + DB role ADMIN → request passes requireRole(ADMIN).
 *
 * Run: node tests/auth/auth-middleware-role-from-db.test.js (from backend)
 */
if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'test-secret-role-from-db';

const path = require('path');
const backendRoot = path.resolve(__dirname, '..', '..');

const config = require(path.join(backendRoot, 'config/constants'));
const userStore = require(path.join(backendRoot, 'storage/user.store'));
const tokenService = require(path.join(backendRoot, 'auth/tokenService'));

const originalFindById = userStore.findById;
const originalVerify = tokenService.verifyAccess;
const originalIsBanned = userStore.isBanned;

const TEST_USER_ID = 'auth-role-db-test-user';
const JWT_COOKIE_NAME = config.JWT_COOKIE_NAME || 'jwt';

function fail(msg) {
  console.error('FAIL:', msg);
  process.exit(1);
}

function run() {
  // Mock: DB says user is ADMIN
  userStore.findById = async (id) => {
    if (id === TEST_USER_ID) {
      return { id: TEST_USER_ID, username: 'test', role: 'ADMIN', email: null };
    }
    return originalFindById ? await originalFindById(id) : null;
  };

  userStore.isBanned = async () => false;

  tokenService.verifyAccess = () => {
    return { userId: TEST_USER_ID, role: 'USER', sid: 'session-1' };
  };

  const authMiddleware = require(path.join(backendRoot, 'http/middleware/auth.middleware')).authMiddleware;
  const { requireRole } = require(path.join(backendRoot, 'http/middleware/requireRole'));
  const { ROLES } = require(path.join(backendRoot, 'auth/roles'));

  const req = { headers: { cookie: `${JWT_COOKIE_NAME}=fake-token` }, user: null };
  const res = {
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
    statusCode: null,
    body: null,
  };

  return new Promise((resolve, reject) => {
    const afterAuth = (err) => {
      if (err) {
        reject(err);
        return;
      }
      if (!req.user || req.user.role !== 'ADMIN') {
        fail(`Expected req.user.role === 'ADMIN' (from DB), got ${req.user?.role}`);
      }
      if (req.user.tokenRole !== 'USER') {
        fail(`Expected req.user.tokenRole === 'USER' (from JWT), got ${req.user?.tokenRole}`);
      }

      const afterRequireRole = (err2) => {
        if (err2) {
          reject(err2);
          return;
        }
        if (res.statusCode === 403) {
          fail('requireRole(ADMIN) should pass when DB role is ADMIN (got 403)');
        }
        userStore.findById = originalFindById;
        userStore.isBanned = originalIsBanned;
        tokenService.verifyAccess = originalVerify;
        console.log('PASS: Token role USER + DB role ADMIN → requireRole(ADMIN) passes');
        resolve();
      };

      requireRole(ROLES.ADMIN)(req, res, afterRequireRole);
    };

    authMiddleware(req, res, afterAuth);
  });
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    if (userStore.findById !== originalFindById) userStore.findById = originalFindById;
    if (userStore.isBanned !== originalIsBanned) userStore.isBanned = originalIsBanned;
    if (tokenService.verifyAccess !== originalVerify) tokenService.verifyAccess = originalVerify;
    console.error('FAIL:', err.message);
    process.exit(1);
  });
