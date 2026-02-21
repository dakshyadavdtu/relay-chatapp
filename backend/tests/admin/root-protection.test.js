'use strict';

// Set root identity before any require that loads config/rootProtection
if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'test-secret-root-protection';
process.env.ROOT_ADMIN_EMAIL = 'root@test.local';
process.env.ROOT_ADMIN_USERNAME = 'daksh_root';

const path = require('path');
const backendRoot = path.resolve(__dirname, '../..');

// Tests require MongoDB (user store); skip gracefully if not configured
if (!process.env.DB_URI) {
  console.log('SKIP: root-protection tests (no DB_URI)');
  process.exit(0);
}

const adminController = require(path.join(backendRoot, 'http/controllers/admin.controller'));
const userStoreStorage = require(path.join(backendRoot, 'storage/user.store'));

function fail(msg) {
  console.error('FAIL:', msg);
  process.exit(1);
}

function mockReq(user = { userId: 'dev_admin', role: 'ADMIN', isRootAdmin: false }, overrides = {}) {
  return {
    user: { userId: 'dev_admin', role: 'ADMIN', isRootAdmin: false, ...user },
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
  // Create root user (email and username match config)
  const rootId = 'daksh_root';
  const adminNonRootId = 'admin_nonroot';
  const normalUserId1 = 'normal_user_1';
  const normalUserId2 = 'normal_user_2';
  try {
    await userStoreStorage.createDevUser(rootId, 'ADMIN', 'root@test.local');
  } catch (_) {
    /* may exist */
  }
  try {
    await userStoreStorage.createDevUser(adminNonRootId, 'ADMIN', 'admin@test.local');
  } catch (_) {
    /* may exist */
  }
  try {
    await userStoreStorage.createDevUser(normalUserId1, 'USER', 'user1@test.local');
  } catch (_) {
    /* may exist */
  }
  try {
    await userStoreStorage.createDevUser(normalUserId2, 'USER', 'user2@test.local');
  } catch (_) {
    /* may exist */
  }

  // 1) Admin (non-root) tries to ban root → 403 "Root admin is protected"
  const banRootReq = mockReq(
    { userId: adminNonRootId, role: 'ADMIN', isRootAdmin: false },
    { params: { id: rootId } }
  );
  const banRootRes = mockRes();
  await adminController.banUser(banRootReq, banRootRes);
  const banRootOut = banRootRes.getOut();
  if (banRootOut.statusCode !== 403) {
    fail(`Admin banning root expected 403, got ${banRootOut.statusCode}`);
  }
  if (banRootOut.body?.code !== 'ROOT_ADMIN_PROTECTED') {
    fail(`Expected code ROOT_ADMIN_PROTECTED, got ${banRootOut.body?.code}`);
  }
  if (banRootOut.body?.error !== 'Root admin is protected') {
    fail(`Expected message "Root admin is protected", got ${banRootOut.body?.error}`);
  }
  console.log('PASS: Admin tries to ban root → 403 ROOT_ADMIN_PROTECTED');

  // 2) Root bans normal user → success
  const rootBanUserReq = mockReq(
    { userId: rootId, role: 'ADMIN', isRootAdmin: true },
    { params: { id: normalUserId1 } }
  );
  const rootBanUserRes = mockRes();
  await adminController.banUser(rootBanUserReq, rootBanUserRes);
  const rootBanUserOut = rootBanUserRes.getOut();
  if (rootBanUserOut.statusCode !== 200) {
    fail(`Root banning normal user expected 200, got ${rootBanUserOut.statusCode}`);
  }
  if (rootBanUserOut.body?.success !== true) {
    fail('Root ban normal user must return success: true');
  }
  console.log('PASS: Root bans normal user → success');

  // 3) Admin (non-root) bans normal user → success
  const adminBanUserReq = mockReq(
    { userId: adminNonRootId, role: 'ADMIN', isRootAdmin: false },
    { params: { id: normalUserId2 } }
  );
  const adminBanUserRes = mockRes();
  await adminController.banUser(adminBanUserReq, adminBanUserRes);
  const adminBanUserOut = adminBanUserRes.getOut();
  if (adminBanUserOut.statusCode !== 200) {
    fail(`Admin banning normal user expected 200, got ${adminBanUserOut.statusCode}`);
  }
  if (adminBanUserOut.body?.success !== true) {
    fail('Admin ban normal user must return success: true');
  }
  console.log('PASS: Admin bans normal user → success');

  // Cleanup: unban so other tests are not affected
  await userStoreStorage.setUnbanned(normalUserId1);
  await userStoreStorage.setUnbanned(normalUserId2);

  console.log('\n✅ Root protection tests passed');
  process.exit(0);
}

run().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
