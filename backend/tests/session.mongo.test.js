#!/usr/bin/env node
'use strict';

/**
 * Atlas session store acceptance tests (ATLAS-AUDIT-1).
 * (a) createSession → exists in Mongo
 * (b) storeRefreshHash → verifyRefreshHash works
 * (c) revokeSession → auth middleware rejects token with revoked sid
 * (d) Revoke persists in Mongo (manual: restart backend and verify session still revoked).
 *
 * Requires: DB_URI. For (c) also requires JWT_SECRET. Run from backend:
 *   DB_URI=mongodb://... JWT_SECRET=test node tests/session.mongo.test.js
 */

if (!process.env.DB_URI || !process.env.DB_URI.trim()) {
  console.log('SKIP: DB_URI not set (Atlas session store tests require MongoDB)');
  process.exit(0);
}

const http = require('http');
const path = require('path');
const backendRoot = path.resolve(__dirname, '..');
const sessionStore = require(path.join(backendRoot, 'auth', 'sessionStore'));
const mongoClient = require(path.join(backendRoot, 'storage', 'mongo.client'));

const COLLECTION = 'sessions';

function fail(msg) {
  console.error('FAIL:', msg);
  process.exit(1);
}

function pass(label) {
  console.log('PASS:', label);
}

const cookieJar = {};

function request(server, method, pathname, body, useCookie = true) {
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

async function run() {
  let server;

  try {
    // (a) createSession → exists in Mongo
    const userId = 'session_mongo_test_' + Date.now();
    const { sessionId } = await sessionStore.createSession({
      userId,
      role: 'USER',
      userAgent: 'test',
      ip: '127.0.0.1',
    });
    if (!sessionId || typeof sessionId !== 'string') fail('createSession must return sessionId');
    const created = await sessionStore.getSession(sessionId);
    if (!created || created.userId !== userId) fail('getSession must return session (exists in Mongo)');
    const db = await mongoClient.getDb();
    const doc = await db.collection(COLLECTION).findOne({ sessionId });
    if (!doc) fail('Session document must exist in Mongo collection "sessions"');
    pass('(a) createSession → session exists in Mongo');

    // (b) storeRefreshHash → verifyRefreshHash works
    const hash = 'a'.repeat(64);
    const expiresAt = Date.now() + 86400000;
    await sessionStore.storeRefreshHash(sessionId, hash, expiresAt);
    const verified = await sessionStore.verifyRefreshHash(sessionId, hash);
    if (!verified) fail('verifyRefreshHash must be true after storeRefreshHash');
    if (await sessionStore.verifyRefreshHash(sessionId, 'b'.repeat(64))) fail('wrong hash must be false');
    pass('(b) storeRefreshHash → verifyRefreshHash works');

    // (c) revokeSession → auth middleware rejects token with revoked sid
    if (!process.env.JWT_SECRET) {
      console.log('SKIP (c): JWT_SECRET not set; run with JWT_SECRET=test for full (c) auth middleware check');
    } else {
      const app = require(path.join(backendRoot, 'app'));
      server = http.createServer(app);
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

      const username = 'revoked_mongo_' + Date.now();
      await request(server, 'POST', '/api/register', { username, password: 'pass1234' });
      cookieJar.cookie = null;
      const loginRes = await request(server, 'POST', '/api/login', { username, password: 'pass1234' });
      if (loginRes.status !== 200) fail('Login failed: ' + loginRes.status);
      const uid = loginRes.body?.data?.user?.id ?? loginRes.body?.data?.user?.userId;
      if (!uid) fail('No userId in login response');
      const meBefore = await request(server, 'GET', '/api/me');
      if (meBefore.status !== 200) fail('GET /api/me before revoke should be 200');
      const sessions = await sessionStore.listSessions(uid);
      if (sessions.length === 0) fail('Expected at least one session');
      await sessionStore.revokeSession(sessions[0].sessionId);
      const meAfter = await request(server, 'GET', '/api/me');
      if (meAfter.status !== 401) fail('GET /api/me after revoke must return 401 (auth middleware rejects revoked sid)');
      pass('(c) revokeSession → auth middleware rejects token with revoked sid');
    }

    // (d) Revoke persists in Mongo (same process read; manual: restart backend and confirm still revoked)
    await sessionStore.revokeSession(sessionId);
    const revokedSession = await sessionStore.getSession(sessionId);
    if (!revokedSession || revokedSession.revokedAt == null) {
      fail('getSession(sessionId) must have revokedAt set (persisted in Mongo)');
    }
    pass('(d) Revoke persisted in Mongo; manual: restart backend and verify session still revoked');

    console.log('');
    console.log('All session.mongo acceptance tests passed.');
  } finally {
    if (server) server.close();
    try {
      await mongoClient.closeDb();
    } catch (_) {}
  }
  process.exit(0);
}

run().catch((err) => {
  console.error('FAIL:', err.message);
  process.exit(1);
});
