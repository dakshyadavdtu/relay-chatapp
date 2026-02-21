#!/usr/bin/env node
'use strict';

/**
 * Phase 6B — Auth Contract Verification
 * Ensures /api/me is the single source of truth for auth state.
 *
 * Contract:
 * - POST /api/login: { success, data: { user, capabilities } } — does NOT authenticate frontend
 * - GET /api/me: validates JWT cookie, returns user, 401 if invalid/expired
 * - POST /api/logout: clears cookie, invalidates session
 *
 * Run: node tests/auth/auth-contract-6b.test.js (from backend)
 */

const http = require('http');
const path = require('path');
const backendRoot = path.resolve(__dirname, '..', '..');

const app = require(path.join(backendRoot, 'app'));

const cookieJar = {};

function request(method, pathname, body, useCookie = true) {
  return new Promise((resolve, reject) => {
    const port = 0; // Let OS assign
    const opts = {
      hostname: '127.0.0.1',
      port: server.address().port,
      path: pathname,
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (useCookie && cookieJar.cookie) {
      opts.headers['Cookie'] = cookieJar.cookie;
    }
    if (body) {
      opts.headers['Content-Length'] = Buffer.byteLength(JSON.stringify(body));
    }
    const req = http.request(opts, (res) => {
      const setCookie = res.headers['set-cookie'];
      if (setCookie) {
        cookieJar.cookie = setCookie.map((c) => c.split(';')[0]).join('; ');
      }
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () =>
        resolve({ status: res.statusCode, body: data ? JSON.parse(data) : {} })
      );
    });
    req.on('error', reject);
    req.write(body ? JSON.stringify(body) : '');
    req.end();
  });
}

let server;

async function run() {
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  const username = 'auth6b_' + Date.now();

  // 1. GET /api/me with NO cookie → 401
  const r0 = await request('GET', '/api/me', null);
  if (r0.status !== 401 || r0.body.code !== 'UNAUTHORIZED') {
    console.error('FAIL: GET /api/me (no cookie) should return 401 UNAUTHORIZED, got', r0.status, r0.body.code);
    process.exit(1);
  }
  console.log('PASS: GET /api/me (no cookie) → 401 UNAUTHORIZED');

  // 2. Register user
  const reg = await request('POST', '/api/register', { username, password: 'pass1234' });
  if (reg.status !== 201) {
    console.error('FAIL: Register failed', reg.status, reg.body);
    process.exit(1);
  }
  // Clear cookie to test login path (register sets cookie)
  cookieJar.cookie = null;

  // 3. POST /api/login → 200, shape { success, data: { user, capabilities } }
  const r1 = await request('POST', '/api/login', { username, password: 'pass1234' });
  if (r1.status !== 200) {
    console.error('FAIL: Login should return 200, got', r1.status, r1.body);
    process.exit(1);
  }
  const hasShape = r1.body.success && r1.body.data?.user && r1.body.data?.capabilities;
  if (!hasShape) {
    console.error('FAIL: Login response must have { success, data: { user, capabilities } }, got', JSON.stringify(r1.body).slice(0, 200));
    process.exit(1);
  }
  console.log('PASS: POST /api/login → 200, shape { success, data: { user, capabilities } }');

  // 4. GET /api/me with cookie → 200, same user
  const r2 = await request('GET', '/api/me');
  if (r2.status !== 200 || !r2.body.data?.user) {
    console.error('FAIL: GET /api/me (with cookie) should return 200 with user, got', r2.status, r2.body);
    process.exit(1);
  }
  if (r2.body.data.user.id !== r1.body.data.user.id) {
    console.error('FAIL: /api/me user.id should match login user.id');
    process.exit(1);
  }
  console.log('PASS: GET /api/me (with cookie) → 200, user matches login');

  // 5. POST /api/logout
  const r3 = await request('POST', '/api/logout');
  if (r3.status !== 200) {
    console.error('FAIL: Logout should return 200, got', r3.status);
    process.exit(1);
  }
  console.log('PASS: POST /api/logout → 200');

  // 6. GET /api/me after logout → 401
  const r4 = await request('GET', '/api/me');
  if (r4.status !== 401) {
    console.error('FAIL: GET /api/me (after logout) should return 401, got', r4.status);
    process.exit(1);
  }
  console.log('PASS: GET /api/me (after logout) → 401');

  console.log('');
  console.log('Phase 6B auth contract verified: /api/me is single source of truth.');
  server.close();
  process.exit(0);
}

run().catch((err) => {
  console.error('FAIL:', err.message);
  if (server) server.close();
  process.exit(1);
});
