#!/usr/bin/env node
'use strict';

/**
 * Phase 4 — UI Preferences verification
 * Ensures GET /api/me/ui-preferences and PATCH /api/me/ui-preferences persist and return correct values.
 *
 * Run: JWT_SECRET=test node tests/auth/ui-preferences.test.js (from backend)
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

  const username = 'ui_prefs_' + Date.now();

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
  console.log('PASS: Login as', username);

  // 2. GET /api/me/ui-preferences returns defaults
  const getRes = await request('GET', '/api/me/ui-preferences');
  if (getRes.status !== 200 || !getRes.body.data?.uiPreferences) {
    console.error('FAIL: GET /api/me/ui-preferences failed', getRes.status, getRes.body);
    process.exit(1);
  }
  const defaults = getRes.body.data.uiPreferences;
  if (typeof defaults.soundNotifications !== 'boolean' || typeof defaults.desktopNotifications !== 'boolean') {
    console.error('FAIL: GET /api/me/ui-preferences should return boolean values', defaults);
    process.exit(1);
  }
  if (defaults.soundNotifications !== true || defaults.desktopNotifications !== false) {
    console.error('FAIL: Expected defaults { soundNotifications: true, desktopNotifications: false }, got', defaults);
    process.exit(1);
  }
  console.log('PASS: GET /api/me/ui-preferences returns defaults');

  // 3. PATCH /api/me/ui-preferences { soundNotifications: false, desktopNotifications: true }
  const patchRes = await request('PATCH', '/api/me/ui-preferences', {
    soundNotifications: false,
    desktopNotifications: true,
  });
  if (patchRes.status !== 200 || !patchRes.body.data?.uiPreferences) {
    console.error('FAIL: PATCH /api/me/ui-preferences failed', patchRes.status, patchRes.body);
    process.exit(1);
  }
  const updated = patchRes.body.data.uiPreferences;
  if (updated.soundNotifications !== false || updated.desktopNotifications !== true) {
    console.error('FAIL: PATCH response should reflect updated values', updated);
    process.exit(1);
  }
  console.log('PASS: PATCH /api/me/ui-preferences updates values');

  // 4. GET /api/me/ui-preferences shows persisted values
  const getRes2 = await request('GET', '/api/me/ui-preferences');
  if (getRes2.status !== 200 || !getRes2.body.data?.uiPreferences) {
    console.error('FAIL: GET /api/me/ui-preferences (second call) failed', getRes2.status, getRes2.body);
    process.exit(1);
  }
  const persisted = getRes2.body.data.uiPreferences;
  if (persisted.soundNotifications !== false || persisted.desktopNotifications !== true) {
    console.error('FAIL: GET /api/me/ui-preferences should show persisted values', persisted);
    process.exit(1);
  }
  console.log('PASS: GET /api/me/ui-preferences shows persisted values');

  // 5. PATCH /api/me/ui-preferences with invalid type → 400
  const invalidRes = await request('PATCH', '/api/me/ui-preferences', { soundNotifications: 'not-boolean' });
  if (invalidRes.status !== 400) {
    console.error('FAIL: PATCH with invalid type should return 400, got', invalidRes.status, invalidRes.body);
    process.exit(1);
  }
  console.log('PASS: PATCH /api/me/ui-preferences rejects invalid types');

  // 6. PATCH /api/me/ui-preferences partial update (only soundNotifications)
  const partialRes = await request('PATCH', '/api/me/ui-preferences', { soundNotifications: true });
  if (partialRes.status !== 200 || !partialRes.body.data?.uiPreferences) {
    console.error('FAIL: Partial PATCH failed', partialRes.status, partialRes.body);
    process.exit(1);
  }
  const partialUpdated = partialRes.body.data.uiPreferences;
  if (partialUpdated.soundNotifications !== true || partialUpdated.desktopNotifications !== true) {
    console.error('FAIL: Partial update should only change soundNotifications', partialUpdated);
    process.exit(1);
  }
  console.log('PASS: Partial PATCH /api/me/ui-preferences works');

  console.log('');
  console.log('Phase 4 verified: UI preferences persist and reflect in GET/PATCH /api/me/ui-preferences.');
  server.close();
  process.exit(0);
}

run().catch((err) => {
  console.error('FAIL:', err.message);
  if (server) server.close();
  process.exit(1);
});
