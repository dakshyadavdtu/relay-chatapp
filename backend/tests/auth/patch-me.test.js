#!/usr/bin/env node
'use strict';

/**
 * P2 — PATCH /api/me verification
 * Ensures profile updates persist and reflect in GET /api/me and GET /api/users.
 * Rejects email changes with 400.
 *
 * Run: JWT_SECRET=test node tests/auth/patch-me.test.js (from backend)
 */

const http = require('http');
const path = require('path');
const backendRoot = path.resolve(__dirname, '..', '..');
const app = require(path.join(backendRoot, 'app'));

const cookieJar = {};

function request(method, pathname, body, useCookie = true) {
  return new Promise((resolve, reject) => {
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
    if (body != null) {
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
    req.write(body != null ? JSON.stringify(body) : '');
    req.end();
  });
}

let server;

async function run() {
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  const username = 'patch_me_' + Date.now();

  // 1. Register and login
  const reg = await request('POST', '/api/register', { username, password: 'pass1234' });
  if (reg.status !== 201) {
    console.error('FAIL: Register failed', reg.status, reg.body);
    process.exit(1);
  }
  cookieJar.cookie = null;
  const loginRes = await request('POST', '/api/login', { username, password: 'pass1234' });
  if (loginRes.status !== 200 || !loginRes.body.data?.user) {
    console.error('FAIL: Login failed', loginRes.status, loginRes.body);
    process.exit(1);
  }
  const userId = loginRes.body.data.user.id;
  console.log('PASS: Login as', username, '(id:', userId, ')');

  // 2. PATCH /api/me { displayName: "daksh" }
  const patchRes = await request('PATCH', '/api/me', { displayName: 'daksh' });
  if (patchRes.status !== 200 || !patchRes.body.data?.user) {
    console.error('FAIL: PATCH /api/me displayName → expected 200 with user, got', patchRes.status, patchRes.body);
    process.exit(1);
  }
  if (patchRes.body.data.user.displayName !== 'daksh') {
    console.error('FAIL: PATCH response user.displayName should be "daksh", got', patchRes.body.data.user.displayName);
    process.exit(1);
  }
  console.log('PASS: PATCH /api/me { displayName: "daksh" } → 200, displayName in response');

  // 3. GET /api/me shows new displayName
  const meRes = await request('GET', '/api/me');
  if (meRes.status !== 200 || !meRes.body.data?.user) {
    console.error('FAIL: GET /api/me failed', meRes.status, meRes.body);
    process.exit(1);
  }
  if (meRes.body.data.user.displayName !== 'daksh') {
    console.error('FAIL: GET /api/me displayName should be "daksh", got', meRes.body.data.user.displayName);
    process.exit(1);
  }
  console.log('PASS: GET /api/me shows displayName "daksh"');

  // 4. GET /api/users shows same updated displayName for same userId
  const usersRes = await request('GET', '/api/users');
  if (usersRes.status !== 200 || !Array.isArray(usersRes.body.data?.users)) {
    console.error('FAIL: GET /api/users failed', usersRes.status, usersRes.body);
    process.exit(1);
  }
  const found = usersRes.body.data.users.find((u) => u.id === userId);
  if (!found) {
    console.error('FAIL: User not found in GET /api/users');
    process.exit(1);
  }
  if (found.displayName !== 'daksh') {
    console.error('FAIL: GET /api/users user displayName should be "daksh", got', found.displayName);
    process.exit(1);
  }
  console.log('PASS: GET /api/users shows same displayName "daksh" for userId');

  // 5. PATCH /api/me { email: "x@y.com" } → 400
  const emailRes = await request('PATCH', '/api/me', { email: 'x@y.com' });
  if (emailRes.status !== 400) {
    console.error('FAIL: PATCH /api/me with email should return 400, got', emailRes.status, emailRes.body);
    process.exit(1);
  }
  if (emailRes.body.error !== 'Email cannot be changed.') {
    console.error('FAIL: Expected error "Email cannot be changed.", got', emailRes.body.error);
    process.exit(1);
  }
  console.log('PASS: PATCH /api/me { email } → 400 "Email cannot be changed."');

  console.log('');
  console.log('P2 verified: Profile updates persist and reflect in GET /api/me and GET /api/users.');
  server.close();
  process.exit(0);
}

run().catch((err) => {
  console.error('FAIL:', err.message);
  if (server) server.close();
  process.exit(1);
});
