#!/usr/bin/env node
'use strict';

/**
 * Production regression tests for /metrics protection.
 * Ensures /metrics is not re-exposed by default in production.
 *
 * Run: node tests/metrics/metrics.protection.test.js (from backend)
 * Does not require config/env (app is required with env set so middleware sees prod defaults).
 */

const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const backendRoot = path.resolve(__dirname, '..', '..');

const KEYS = ['NODE_ENV', 'METRICS_MODE', 'METRICS_SECRET', 'ALLOW_PUBLIC_METRICS_IN_PROD', 'REFRESH_PEPPER'];

function saveEnv() {
  const saved = {};
  for (const k of KEYS) {
    if (process.env[k] !== undefined) saved[k] = process.env[k];
  }
  return saved;
}

function restoreEnv(saved) {
  for (const k of KEYS) {
    if (saved[k] !== undefined) {
      process.env[k] = saved[k];
    } else {
      delete process.env[k];
    }
  }
}

function setProductionSecret() {
  process.env.NODE_ENV = 'production';
  delete process.env.METRICS_MODE;
  process.env.METRICS_SECRET = 's3cr3t';
  process.env.ALLOW_PUBLIC_METRICS_IN_PROD = 'false';
  process.env.REFRESH_PEPPER = process.env.REFRESH_PEPPER || 'test-pepper-metrics-protection';
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'test-jwt-secret-min-32-chars-metrics';
}

function fail(msg) {
  console.error('FAIL:', msg);
  process.exit(1);
}

function request(port, pathname, headers = {}) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: '127.0.0.1',
      port,
      path: pathname,
      method: 'GET',
      headers: { ...headers },
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: data ? JSON.parse(data) : {} });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function bootApp() {
  const app = require(path.join(backendRoot, 'app'));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, port: server.address().port };
}

async function run() {
  const savedEnv = saveEnv();

  try {
    // ─── A) Production default = secret ───
    setProductionSecret();
    const { server: serverA, port: portA } = await bootApp();

    let res = await request(portA, '/metrics');
    if (res.status !== 401 || res.body.code !== 'METRICS_UNAUTHORIZED') {
      fail('A: GET /metrics (no header) expected 401 METRICS_UNAUTHORIZED, got ' + res.status + ' ' + (res.body.code || res.body));
    }
    console.log('PASS: A) GET /metrics with no header → 401 METRICS_UNAUTHORIZED');

    res = await request(portA, '/metrics', { 'x-metrics-key': 'wrong' });
    if (res.status !== 401) {
      fail('A: GET /metrics (wrong key) expected 401, got ' + res.status);
    }
    console.log('PASS: A) GET /metrics with wrong x-metrics-key → 401');

    res = await request(portA, '/metrics', { 'x-metrics-key': 's3cr3t' });
    if (res.status !== 200) {
      fail('A: GET /metrics (correct key) expected 200, got ' + res.status);
    }
    if (!res.body || typeof res.body.counters !== 'object' || typeof res.body.timestamp !== 'number') {
      fail('A: GET /metrics (correct key) expected { counters, timestamp }, got ' + JSON.stringify(res.body).slice(0, 120));
    }
    console.log('PASS: A) GET /metrics with x-metrics-key: s3cr3t → 200 and { counters, timestamp }');

    serverA.close();

    // ─── B) Disabled hides endpoint ───
    process.env.NODE_ENV = 'production';
    process.env.METRICS_MODE = 'disabled';
    process.env.METRICS_SECRET = 'any';
    process.env.ALLOW_PUBLIC_METRICS_IN_PROD = 'false';
    if (!process.env.REFRESH_PEPPER) process.env.REFRESH_PEPPER = 'test-pepper-metrics-protection';

    const { server: serverB, port: portB } = await bootApp();
    res = await request(portB, '/metrics');
    if (res.status !== 404 || res.body.code !== 'METRICS_DISABLED') {
      fail('B: GET /metrics (disabled) expected 404 METRICS_DISABLED, got ' + res.status + ' ' + (res.body.code || res.body));
    }
    console.log('PASS: B) METRICS_MODE=disabled → 404 METRICS_DISABLED');
    serverB.close();

    // ─── C) Open in production blocked by validation ───
    // Run only env.validate (not config/env) so .env does not override; child gets our env only.
    const envValidatePath = path.join(backendRoot, 'config', 'env.validate.js');
    const childEnv = {
      ...process.env,
      NODE_ENV: 'production',
      METRICS_MODE: 'open',
      ALLOW_PUBLIC_METRICS_IN_PROD: 'false',
      METRICS_SECRET: 'dummy',
      PORT: '3000',
      JWT_SECRET: process.env.JWT_SECRET || 'test-secret-min-32-chars-long',
      REFRESH_PEPPER: process.env.REFRESH_PEPPER || 'test-pepper',
      DB_URI: process.env.DB_URI || 'mongodb+srv://x:x@x.mongodb.net/x',
      COOKIE_DOMAIN: '.x',
      CORS_ORIGIN: 'http://x',
      WS_PATH: '/ws',
    };
    const exitCode = await new Promise((resolve) => {
      const child = spawn(process.execPath, ['-e', "require(process.argv[1])();", envValidatePath], {
        cwd: backendRoot,
        env: childEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      child.on('close', (code) => resolve(code));
    });
    if (exitCode !== 1) {
      fail('C: Env validation with NODE_ENV=production, METRICS_MODE=open, ALLOW_PUBLIC_METRICS_IN_PROD=false should exit(1), got ' + exitCode);
    }
    console.log('PASS: C) Open in production without escape hatch → validation exits 1');
  } finally {
    restoreEnv(savedEnv);
  }

  console.log('All metrics protection tests passed');
  process.exit(0);
}

run().catch((err) => {
  console.error('FAIL:', err.message);
  process.exit(1);
});
