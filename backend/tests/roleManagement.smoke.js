#!/usr/bin/env node
'use strict';

/**
 * Role management smoke test.
 * - Register root user (ROOT_ADMIN_EMAIL) + normal user
 * - Root promotes normal user to ADMIN via POST /api/admin/users/:id/role
 * - Login as normal user, confirm /api/me shows role ADMIN and isRootAdmin false
 * - As normal ADMIN, POST /api/admin/users/:id/role -> must be 403
 *
 * Prerequisites: Backend running with ROOT_ADMIN_EMAIL=dakshyadavproject@gmail.com
 * Run: cd backend && ROOT_ADMIN_EMAIL=dakshyadavproject@gmail.com PORT=8000 node tests/roleManagement.smoke.js
 */

const http = require('http');

const PORT = process.env.PORT || '8000';
const BASE = `http://localhost:${PORT}`;
const ROOT_EMAIL = process.env.ROOT_ADMIN_EMAIL || 'dakshyadavproject@gmail.com';
const PASSWORD = process.env.SMOKE_PASSWORD || 'RoleMgmtSmoke123!';
const ROOT_PASSWORD_FALLBACK = process.env.SMOKE_ROOT_PASSWORD || PASSWORD;

function fail(msg) {
  console.error('FAIL:', msg);
  process.exit(1);
}

function request(method, path, body = null, cookies = '') {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const opts = {
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(cookies ? { Cookie: cookies } : {}),
      },
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          const json = data ? JSON.parse(data) : {};
          resolve({ status: res.statusCode, data: json, setCookie: res.headers['set-cookie'] });
        } catch {
          resolve({ status: res.statusCode, data: null, raw: data, setCookie: res.headers['set-cookie'] });
        }
      });
    });
    req.on('error', reject);
    if (body != null) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

function getCookies(setCookie) {
  if (!setCookie || !Array.isArray(setCookie)) return '';
  return setCookie.map((c) => c.split(';')[0]).join('; ');
}

function userFromMe(res) {
  const d = res.data?.data ?? res.data;
  return d?.user ?? d;
}

async function main() {
  const ts = Date.now();
  const rootUsername = 'root_rm_' + ts;
  const normalUsername = 'normal_rm_' + ts;
  let rootCookies = '';

  // 1) Register root user
  const regRoot = await request('POST', '/api/register', {
    email: ROOT_EMAIL,
    username: rootUsername,
    password: PASSWORD,
  });
  if (regRoot.status !== 200 && regRoot.status !== 201) {
    if (regRoot.data?.code === 'DUPLICATE_EMAIL') {
      const rootLoginUsername = process.env.SMOKE_ROOT_USERNAME || ROOT_EMAIL.split('@')[0];
      const loginRoot = await request('POST', '/api/login', {
        username: rootLoginUsername,
        password: ROOT_PASSWORD_FALLBACK,
      });
      if (loginRoot.status !== 200) {
        fail('Root email already registered. Set SMOKE_ROOT_USERNAME to existing root username or use fresh backend.');
      }
      rootCookies = getCookies(loginRoot.setCookie);
    } else {
      fail('Register root failed: ' + JSON.stringify(regRoot.data));
    }
  } else {
    rootCookies = getCookies(regRoot.setCookie);
  }
  if (!rootCookies) fail('No root session');
  console.log('Root user OK');

  // 2) Register normal user
  const regNormal = await request('POST', '/api/register', {
    email: `normal_rm_${ts}@test.local`,
    username: normalUsername,
    password: PASSWORD,
  });
  if (regNormal.status !== 200 && regNormal.status !== 201) fail('Register normal failed: ' + JSON.stringify(regNormal.data));
  const normalUserId = regNormal.data?.data?.user?.id ?? regNormal.data?.user?.id;
  if (!normalUserId) fail('No normal user id in register response');
  console.log('Normal user OK:', normalUserId);

  // 3) Root promotes normal user to ADMIN (POST /api/admin/users/:id/role)
  const setRole = await request('POST', `/api/admin/users/${normalUserId}/role`, { role: 'ADMIN' }, rootCookies);
  if (setRole.status !== 200) fail('Root set role failed: ' + setRole.status + ' ' + JSON.stringify(setRole.data));
  if (!setRole.data?.success) fail('Set role response missing success');
  console.log('Root promoted normal user to ADMIN');

  // 4) Login as normal user, confirm /api/me shows role ADMIN and isRootAdmin false
  const loginNormal = await request('POST', '/api/login', { username: normalUsername, password: PASSWORD });
  if (loginNormal.status !== 200) fail('Login normal failed');
  const normalCookies = getCookies(loginNormal.setCookie);
  const meNormal = await request('GET', '/api/me', null, normalCookies);
  if (meNormal.status !== 200) fail('/api/me normal failed');
  const normalUser = userFromMe(meNormal);
  if (!normalUser) fail('No user in /api/me');
  if (normalUser.role !== 'ADMIN') fail('Expected role ADMIN, got ' + normalUser.role);
  if (normalUser.isRootAdmin !== false) fail('Expected isRootAdmin false, got ' + normalUser.isRootAdmin);
  console.log('PASS: Normal user has role ADMIN, isRootAdmin false');

  // 5) As normal ADMIN, POST /api/admin/users/:id/role -> must be 403
  const otherId = normalUserId;
  const setRoleAsNormal = await request('POST', `/api/admin/users/${otherId}/role`, { role: 'USER' }, normalCookies);
  if (setRoleAsNormal.status !== 403) fail('Expected 403 when non-root sets role, got ' + setRoleAsNormal.status);
  const code = setRoleAsNormal.data?.code;
  if (code !== 'ROOT_ADMIN_REQUIRED' && code !== 'ROOT_REQUIRED') {
    fail('Expected ROOT_ADMIN_REQUIRED or ROOT_REQUIRED, got ' + code);
  }
  console.log('PASS: Non-root ADMIN gets 403 when setting role');

  console.log('All role management smoke checks passed.');
  process.exit(0);
}

main().catch((err) => {
  console.error('FAIL:', err.message);
  process.exit(1);
});
