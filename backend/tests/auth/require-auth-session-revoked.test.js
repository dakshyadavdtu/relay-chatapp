#!/usr/bin/env node
'use strict';

/**
 * Phase 2F — requireAuth is session-aware.
 * If session is revoked server-side, HTTP requests fail with 401 even if JWT is not expired.
 *
 * Run: JWT_SECRET=test node tests/auth/require-auth-session-revoked.test.js (from backend)
 */

const http = require('http');
const path = require('path');
const backendRoot = path.resolve(__dirname, '..', '..');
const app = require(path.join(backendRoot, 'app'));
const sessionStore = require(path.join(backendRoot, 'auth', 'sessionStore'));

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

  const username = 'revoked_' + Date.now();

  await request('POST', '/api/register', { username, password: 'pass1234' });
  cookieJar.cookie = null;
  const loginRes = await request('POST', '/api/login', { username, password: 'pass1234' });
  if (loginRes.status !== 200) {
    console.error('FAIL: Login', loginRes.status, loginRes.body);
    process.exit(1);
  }

  const userId = loginRes.body?.data?.user?.id ?? loginRes.body?.data?.user?.userId;
  if (!userId) {
    console.error('FAIL: No user id in login response');
    process.exit(1);
  }

  const meBefore = await request('GET', '/api/me');
  if (meBefore.status !== 200) {
    console.error('FAIL: GET /api/me should succeed before revoke', meBefore.status);
    process.exit(1);
  }

  const sessions = await sessionStore.listSessions(userId);
  if (sessions.length === 0) {
    console.error('FAIL: Expected at least one session');
    process.exit(1);
  }
  await sessionStore.revokeSession(sessions[0].sessionId);

  const meAfter = await request('GET', '/api/me');
  if (meAfter.status !== 401) {
    console.error('FAIL: GET /api/me should return 401 after session revoked', meAfter.status, meAfter.body);
    process.exit(1);
  }

  console.log('PASS: GET /api/me returns 401 when session is revoked server-side (JWT still valid)');
  server.close();
  process.exit(0);
}

run().catch((err) => {
  console.error('FAIL:', err.message);
  if (server) server.close();
  process.exit(1);
});
