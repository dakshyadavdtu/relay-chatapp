#!/usr/bin/env node
'use strict';

/**
 * Regression: run root admin ensure twice and verify second run does not crash
 * (MongoServerError "Updating the path 'role' would create a conflict").
 *
 * Requires: DB_URI, ROOT_ADMIN_EMAIL, ROOT_ADMIN_PASSWORD (and env validated by config).
 * Run: node -r dotenv/config scripts/check-root-admin-upsert.js
 * Or: npm run check:rootadmin
 */

const path = require('path');
const backendRoot = path.resolve(__dirname, '..');

require(path.join(backendRoot, 'config/env'));

const config = require(path.join(backendRoot, 'config/constants'));
const userService = require(path.join(backendRoot, 'services/user.service'));
const userStore = require(path.join(backendRoot, 'storage/user.store'));

async function run() {
  const email = (config.ROOT_ADMIN_EMAIL || '').trim().toLowerCase();
  const password = (process.env.ROOT_ADMIN_PASSWORD || '').trim();

  if (!email || !password) {
    console.log('SKIP: ROOT_ADMIN_EMAIL or ROOT_ADMIN_PASSWORD not set');
    process.exit(0);
  }

  await userService.ensureRootAdmin();
  await userService.ensureRootAdmin();

  const root = await userStore.findByEmail(email);
  if (!root) {
    console.error('FAIL: root admin user not found after ensure');
    process.exit(1);
  }
  const expectedUsername = (config.ROOT_ADMIN_USERNAME || 'daksh_root').trim().toLowerCase();
  const actualUsername = (root.username || '').trim().toLowerCase();
  if (actualUsername !== expectedUsername) {
    console.error('FAIL: expected root username', expectedUsername, 'got', actualUsername);
    process.exit(1);
  }
  if (root.role !== 'ADMIN') {
    console.error('FAIL: expected role ADMIN, got', root.role);
    process.exit(1);
  }

  console.log('OK: second run did not conflict');
  process.exit(0);
}

run().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
