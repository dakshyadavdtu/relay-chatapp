#!/usr/bin/env node
'use strict';

/**
 * Regression tests for canonical origin normalization (backend/config/origins.js).
 * Prevents trailing-slash / path / query / hash CORS mismatches and 403 CSRF_BLOCKED.
 *
 * Run only these tests:
 *   cd backend && npm run test:origins
 *   cd backend && node -r dotenv/config tests/origins.test.js
 *
 * Run full backend test suite:
 *   cd backend && npm test
 *
 * These tests fail if normalization is removed (e.g. parse() stores raw strings
 * or isAllowedOrigin uses exact match only); they pass with canonical URL.origin.
 */

const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const backendRoot = path.resolve(__dirname, '..');
const originsPath = path.join(backendRoot, 'config', 'origins.js');
const envValidatePath = path.join(backendRoot, 'config', 'env.validate.js');

function clearOriginsCache() {
  try {
    delete require.cache[require.resolve(originsPath)];
  } catch (_) {}
}

function loadOrigins() {
  clearOriginsCache();
  return require(originsPath);
}

function runEnvValidateWithEnv(env) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['-e', 'require(process.argv[1])();', envValidatePath],
      { cwd: backendRoot, env, stdio: ['ignore', 'pipe', 'pipe'] }
    );
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code, signal) => resolve({ code, signal, stderr }));
    child.on('error', reject);
  });
}

let savedEnv = {};
function saveEnv() {
  savedEnv.CORS_ORIGINS = process.env.CORS_ORIGINS;
  savedEnv.CORS_ORIGIN = process.env.CORS_ORIGIN;
  savedEnv.NODE_ENV = process.env.NODE_ENV;
}
function restoreEnv() {
  if (savedEnv.CORS_ORIGINS !== undefined) process.env.CORS_ORIGINS = savedEnv.CORS_ORIGINS;
  else delete process.env.CORS_ORIGINS;
  if (savedEnv.CORS_ORIGIN !== undefined) process.env.CORS_ORIGIN = savedEnv.CORS_ORIGIN;
  else delete process.env.CORS_ORIGIN;
  if (savedEnv.NODE_ENV !== undefined) process.env.NODE_ENV = savedEnv.NODE_ENV;
  else delete process.env.NODE_ENV;
}

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
}

async function main() {
  saveEnv();

  // --- 1) Parse: CORS_ORIGINS="https://a.com/" -> allowed contains "https://a.com" ---
  clearOriginsCache();
  process.env.CORS_ORIGINS = 'https://a.com/';
  process.env.NODE_ENV = 'production';
  const origins1 = loadOrigins();
  const allowed1 = origins1.getAllowedOrigins().allowedOrigins;
  assert(Array.isArray(allowed1), 'allowedOrigins is array');
  assert(allowed1.includes('https://a.com'), 'allowed contains "https://a.com" (canonical, no trailing slash)');
  assert(!allowed1.includes('https://a.com/'), 'allowed does not contain "https://a.com/"');
  console.log('PASS: CORS_ORIGINS="https://a.com/" -> allowed contains "https://a.com"');
  restoreEnv();
  clearOriginsCache();

  // --- 2) isAllowedOrigin("https://a.com") true when env has "https://a.com/" ---
  clearOriginsCache();
  process.env.CORS_ORIGINS = 'https://a.com/';
  process.env.NODE_ENV = 'production';
  const origins2 = loadOrigins();
  assert(origins2.isAllowedOrigin('https://a.com') === true, 'isAllowedOrigin("https://a.com") is true');
  console.log('PASS: isAllowedOrigin("https://a.com") true when env includes "https://a.com/"');
  restoreEnv();
  clearOriginsCache();

  // --- 3) isAllowedOrigin("https://a.com/") also true (request origin normalized) ---
  clearOriginsCache();
  process.env.CORS_ORIGINS = 'https://a.com';
  process.env.NODE_ENV = 'production';
  const origins3 = loadOrigins();
  assert(origins3.isAllowedOrigin('https://a.com/') === true, 'isAllowedOrigin("https://a.com/") is true');
  console.log('PASS: isAllowedOrigin("https://a.com/") true (request origin normalized)');
  restoreEnv();
  clearOriginsCache();

  // --- 4) Negative: validateOriginFormat rejects path, query, non-http ---
  clearOriginsCache();
  const origins4 = loadOrigins();
  assert(origins4.validateOriginFormat('https://a.com/path') === false, 'path rejected');
  assert(origins4.validateOriginFormat('https://a.com?x=1') === false, 'query rejected');
  assert(origins4.validateOriginFormat('https://a.com#x') === false, 'hash rejected');
  assert(origins4.validateOriginFormat('ftp://a.com') === false, 'ftp rejected');
  console.log('PASS: validateOriginFormat rejects path, query, hash, non-http(s)');
  restoreEnv();
  clearOriginsCache();

  // --- 5) Startup validation fails: CORS_ORIGINS with path -> exit(1) ---
  const childEnv = {
    ...process.env,
    NODE_ENV: 'production',
    PORT: '3000',
    JWT_SECRET: 'test-secret-min-32-chars-for-validation',
    DB_URI: 'mongodb+srv://x:x@x.mongodb.net/x',
    COOKIE_DOMAIN: '.example.com',
    WS_PATH: '/ws',
    REFRESH_PEPPER: 'test-refresh-pepper-min-32-chars',
    CORS_ORIGINS: 'https://a.com/path',
    METRICS_MODE: 'secret',
    METRICS_SECRET: 'dummy-metrics-secret',
  };
  const { code: codePath } = await runEnvValidateWithEnv(childEnv);
  assert(codePath === 1, 'env.validate exits 1 when CORS_ORIGINS has path');

  childEnv.CORS_ORIGINS = 'https://a.com?x=1';
  const { code: codeQuery } = await runEnvValidateWithEnv(childEnv);
  assert(codeQuery === 1, 'env.validate exits 1 when CORS_ORIGINS has query');

  childEnv.CORS_ORIGINS = 'ftp://a.com';
  const { code: codeFtp } = await runEnvValidateWithEnv(childEnv);
  assert(codeFtp === 1, 'env.validate exits 1 when CORS_ORIGINS is ftp');
  console.log('PASS: Startup validation fails for path, query, ftp');

  // --- 6) Referer-derived origin: POST with Referer "https://a.com/some/page" -> allowed when "https://a.com" in list ---
  clearOriginsCache();
  process.env.CORS_ORIGINS = 'https://a.com';
  process.env.NODE_ENV = 'production';
  const express = require('express');
  const { originGuard } = require(path.join(backendRoot, 'http', 'middleware', 'originGuard.middleware.js'));
  const app = express();
  app.use(express.json());
  app.use(originGuard);
  app.post('/api/test-origin', (req, res) => res.status(200).json({ ok: true }));

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  const res = await new Promise((resolve, reject) => {
    const opts = {
      hostname: '127.0.0.1',
      port,
      path: '/api/test-origin',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Referer: 'https://a.com/some/page',
      },
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.write('{}');
    req.end();
  });

  server.close();
  restoreEnv();
  clearOriginsCache();

  assert(res.status !== 403, 'Referer-derived origin "https://a.com" must not be blocked (status !== 403)');
  assert(res.status === 200, 'Expect 200 from test route');
  console.log('PASS: Referer "https://a.com/some/page" -> derived origin "https://a.com" allowed');

  console.log('\nAll origins tests passed.');
  process.exit(0);
}

main().catch((err) => {
  console.error('FAIL:', err.message);
  restoreEnv();
  clearOriginsCache();
  process.exit(1);
});
