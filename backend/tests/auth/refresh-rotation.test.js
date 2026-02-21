#!/usr/bin/env node
'use strict';

/**
 * Phase 2E — Refresh endpoint + rotation.
 * - Expired access -> refresh -> app continues (GET /api/me works after refresh).
 * - Old refresh token stops working after rotation (second use returns 401).
 *
 * Run: JWT_SECRET=test node tests/auth/refresh-rotation.test.js (from backend)
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

  const username = 'refresh_' + Date.now();

  // 1. Register + login
  await request('POST', '/api/register', { username, password: 'pass1234' });
  cookieJar.cookie = null;
  const loginRes = await request('POST', '/api/login', { username, password: 'pass1234' });
  if (loginRes.status !== 200) {
    console.error('FAIL: Login', loginRes.status, loginRes.body);
    process.exit(1);
  }
  const refreshCookieAfterLogin = cookieJar.cookie;
  if (!refreshCookieAfterLogin || !refreshCookieAfterLogin.includes('refresh_token=')) {
    console.error('FAIL: Login should set refresh_token cookie');
    process.exit(1);
  }

  // 2. POST /api/auth/refresh -> 200, new cookies
  const refreshRes = await request('POST', '/api/auth/refresh', null);
  if (refreshRes.status !== 200 || !refreshRes.body?.data?.ok) {
    console.error('FAIL: Refresh should return 200 and { ok: true }', refreshRes.status, refreshRes.body);
    process.exit(1);
  }
  const cookieAfterFirstRefresh = cookieJar.cookie;

  // 3. Use OLD refresh cookie again -> 401 (rotation: old token invalidated)
  cookieJar.cookie = refreshCookieAfterLogin;
  const reuseRes = await request('POST', '/api/auth/refresh', null);
  if (reuseRes.status !== 401) {
    console.error('FAIL: Reusing old refresh token should return 401', reuseRes.status);
    process.exit(1);
  }

  // 4. Restore cookies from first refresh, GET /api/me -> 200 (app continues)
  cookieJar.cookie = cookieAfterFirstRefresh;
  const meRes = await request('GET', '/api/me');
  if (meRes.status !== 200 || !meRes.body?.data?.user) {
    console.error('FAIL: GET /api/me after refresh should return 200 with user', meRes.status, meRes.body);
    process.exit(1);
  }

  console.log('PASS: Refresh returns 200 and { ok: true }');
  console.log('PASS: Old refresh token returns 401 after rotation');
  console.log('PASS: GET /api/me works after refresh (app continues)');
  server.close();
  process.exit(0);
}

run().catch((err) => {
  console.error('FAIL:', err.message);
  if (server) server.close();
  process.exit(1);
});
