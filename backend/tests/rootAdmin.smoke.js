#!/usr/bin/env node
'use strict';

/**
 * Root admin smoke test.
 * Registers user with ROOT_ADMIN_EMAIL, logs in, calls /api/me, asserts isRootAdmin === true.
 *
 * Prerequisites: Backend must be running with ROOT_ADMIN_EMAIL=dakshyadavproject@gmail.com
 * Run: ROOT_ADMIN_EMAIL=dakshyadavproject@gmail.com PORT=8000 node server.js
 * Then: cd backend && ROOT_ADMIN_EMAIL=dakshyadavproject@gmail.com PORT=8000 node tests/rootAdmin.smoke.js
 */

const http = require('http');

const PORT = process.env.PORT || '8000';
const BASE = `http://localhost:${PORT}`;
const ROOT_EMAIL = process.env.ROOT_ADMIN_EMAIL || 'dakshyadavproject@gmail.com';
const TEST_PASSWORD = 'RootAdminTest123!';

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
          resolve({ status: res.statusCode, headers: res.headers, data: json, setCookie: res.headers['set-cookie'] });
        } catch {
          resolve({ status: res.statusCode, headers: res.headers, data: null, raw: data, setCookie: res.headers['set-cookie'] });
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

async function main() {
  const username = 'root_smoke_' + Date.now();

  // 1) Register with root email (or login if already registered from prior run)
  const reg = await request('POST', '/api/register', {
    email: ROOT_EMAIL,
    username,
    password: TEST_PASSWORD,
  });
  let cookies = '';
  if (reg.status === 200 || reg.status === 201) {
    cookies = getCookies(reg.setCookie);
    console.log('Register OK');
  } else if (reg.data?.code === 'DUPLICATE_EMAIL') {
    const loginRes = await request('POST', '/api/login', {
      username: process.env.SMOKE_ROOT_USERNAME || 'root_smoke_1771126537970',
      password: TEST_PASSWORD,
    });
    if (loginRes.status !== 200) {
      fail(`Root email already registered. Set SMOKE_ROOT_USERNAME to existing username or use fresh backend.`);
    }
    cookies = getCookies(loginRes.setCookie);
    console.log('Login OK (user already existed)');
  } else {
    fail(`Register failed: ${reg.status} ${JSON.stringify(reg.data)}`);
  }
  if (!cookies) fail('No session cookies');

  // 2) Call /api/me and assert isRootAdmin === true
  const me = await request('GET', '/api/me', null, cookies);
  if (me.status !== 200) fail(`/api/me failed: ${me.status} ${JSON.stringify(me.data)}`);
  const user = me.data?.data?.user ?? me.data?.user ?? me.data;
  if (!user) fail('/api/me: no user in response. Raw: ' + JSON.stringify(me.data));
  if (user.isRootAdmin !== true) {
    fail(`Expected user.isRootAdmin === true, got ${user.isRootAdmin}. User keys: ${Object.keys(user).join(',')}`);
  }
  console.log('PASS: /api/me returns isRootAdmin: true');
  process.exit(0);
}

main().catch((err) => {
  console.error('FAIL:', err.message);
  process.exit(1);
});
