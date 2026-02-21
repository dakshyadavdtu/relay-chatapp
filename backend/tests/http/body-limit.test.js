#!/usr/bin/env node
'use strict';

/**
 * Body limit regression test (Phase 1 + Phase 2).
 * Ensures oversized JSON is rejected with 413 and a clean JSON error.
 *
 * - Uses POST /api/login (public, no auth) with a body > 256kb.
 * - Asserts: status 413, Content-Type application/json, code PAYLOAD_TOO_LARGE.
 *
 * Run: node -r dotenv/config tests/http/body-limit.test.js (from backend)
 * Fails before Phase 1 (no limit); passes after Phase 1 + Phase 2.
 */

const http = require('http');
const path = require('path');

const backendRoot = path.resolve(__dirname, '..', '..');
const app = require(path.join(backendRoot, 'app'));

function request(method, pathname, body) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: '127.0.0.1',
      port: server.address().port,
      path: pathname,
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    const bodyStr = body ? JSON.stringify(body) : '';
    if (bodyStr) opts.headers['Content-Length'] = Buffer.byteLength(bodyStr);

    const req = http.request(opts, (res) => {
      const ct = res.headers['content-type'] || '';
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        let parsed = {};
        try {
          if (data.trim()) parsed = JSON.parse(data);
        } catch (_) {}
        resolve({ status: res.statusCode, contentType: ct, body: parsed, raw: data });
      });
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

let server;

async function run() {
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  // Payload > 256kb (default BODY_LIMIT). ~300kb.
  const big = 'a'.repeat(300 * 1024);
  const payload = { username: 'bodylimit', password: big };

  const res = await request('POST', '/api/login', payload);

  if (res.status !== 413) {
    console.error('FAIL: Expected status 413, got', res.status);
    process.exit(1);
  }
  console.log('PASS: status 413');

  if (!res.contentType.includes('application/json')) {
    console.error('FAIL: Expected Content-Type application/json, got', res.contentType);
    process.exit(1);
  }
  console.log('PASS: Content-Type application/json');

  if (res.body.code !== 'PAYLOAD_TOO_LARGE') {
    console.error('FAIL: Expected error.code PAYLOAD_TOO_LARGE, got', res.body.code);
    process.exit(1);
  }
  console.log('PASS: error.code PAYLOAD_TOO_LARGE');

  if (res.body.success !== false) {
    console.error('FAIL: Expected success: false, got', res.body.success);
    process.exit(1);
  }
  console.log('PASS: success false');

  console.log('\nBody limit regression test passed.');
  server.close();
  process.exit(0);
}

run().catch((err) => {
  console.error('FAIL:', err.message);
  if (server) server.close();
  process.exit(1);
});
