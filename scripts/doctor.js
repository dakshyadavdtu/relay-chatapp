#!/usr/bin/env node
'use strict';

/**
 * Phase 0 — Doctor script: baseline environment and health check.
 * Run from integrated repo root (parent of backend/ and myfrontend/).
 *
 * - Prints Node and npm versions
 * - Installs deps in backend and myfrontend/frontend
 * - Optional: runs lint/test if --test (backend test only; stable subset if needed)
 * - Prints start commands and ports/URLs (does not daemonize servers)
 * - Runs a basic health check against backend (GET /api/health or /health)
 *
 * Usage:
 *   node scripts/doctor.js
 *   node scripts/doctor.js --test
 */

const path = require('path');
const fs = require('fs');
const { execSync, spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const BACKEND_DIR = path.join(REPO_ROOT, 'backend');
const FRONTEND_DIR = path.join(REPO_ROOT, 'myfrontend', 'frontend');

const DEFAULT_BACKEND_PORT = 8000;
const DEFAULT_FRONTEND_PORT = 5173;

function log(msg) {
  console.log(msg);
}

function run(cmd, cwd, optional) {
  try {
    execSync(cmd, { cwd: cwd || REPO_ROOT, stdio: 'inherit', shell: true });
    return true;
  } catch (e) {
    if (!optional) throw e;
    return false;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const runTests = args.includes('--test');

  log('--- Phase 0 Doctor ---\n');

  // 1) Node + npm versions
  log('1) Node and npm versions:');
  try {
    const nodeV = process.version;
    const npmV = execSync('npm -v', { encoding: 'utf8' }).trim();
    log(`   Node ${nodeV}, npm ${npmV}\n`);
  } catch (_) {
    log('   (could not read npm version)\n');
  }

  // 2) Install deps
  log('2) Installing dependencies...');
  if (!fs.existsSync(path.join(BACKEND_DIR, 'package.json'))) {
    log('   ERROR: backend/package.json not found. Run from repo root (parent of backend/ and myfrontend/).');
    process.exit(1);
  }
  run('npm install', BACKEND_DIR);
  log('   Backend OK.');

  if (!fs.existsSync(path.join(FRONTEND_DIR, 'package.json'))) {
    log('   ERROR: myfrontend/frontend/package.json not found.');
    process.exit(1);
  }
  run('npm install', FRONTEND_DIR);
  log('   Frontend OK.\n');

  // 3) Lint/test (only if --test and stable)
  if (runTests) {
    log('3) Running tests (--test)...');
    const backendTestOk = run('npm run test', BACKEND_DIR, true);
    if (!backendTestOk) {
      log('   Backend test failed or not run (see above). Continuing.\n');
    } else {
      log('   Backend test OK.\n');
    }
    // Frontend: only verify:contract if present and non-destructive
    const frontendVerifyOk = run('npm run verify:contract', FRONTEND_DIR, true);
    if (!frontendVerifyOk) {
      log('   Frontend verify:contract skipped or failed.\n');
    }
  } else {
    log('3) Skipping tests (use --test to run backend test + frontend verify:contract).\n');
  }

  // 4) Start commands and ports
  const backendPort = process.env.PORT || DEFAULT_BACKEND_PORT;
  const frontendPort = process.env.VITE_FRONTEND_PORT || DEFAULT_FRONTEND_PORT;
  log('4) Start commands (run in separate terminals):');
  log(`   Backend:  cd backend && npm run dev`);
  log(`            (listens on port ${backendPort}; set PORT to override)`);
  log(`   Frontend: cd myfrontend/frontend && npm run dev`);
  log(`            (Vite default port ${frontendPort}; proxy /api and /ws to http://localhost:${backendPort})`);
  log('');
  log('   URLs:');
  log(`   - Backend:  http://localhost:${backendPort}`);
  log(`   - Health:   http://localhost:${backendPort}/health  or  http://localhost:${backendPort}/api/health`);
  log(`   - Frontend: http://localhost:${frontendPort} (after npm run dev)`);
  log('');

  // 5) Health check
  log('5) Backend health check:');
  const healthUrl = `http://localhost:${backendPort}/api/health`;
  const healthOk = await healthCheck(healthUrl, backendPort);

  if (healthOk) {
    log(`   GET ${healthUrl} -> 200 OK`);
  } else {
    log(`   GET ${healthUrl} -> failed or non-200 (is the backend running on port ${backendPort}?)`);
    log('   Start backend with: cd backend && npm run dev');
  }

  log('\n--- Done ---');
}

function healthCheck(urlStr, port) {
  return new Promise((resolve) => {
    const http = require('http');
    let url;
    try {
      url = new URL(urlStr);
    } catch (_) {
      return resolve(false);
    }
    const req = http.get(
      {
        hostname: url.hostname,
        port: url.port || port || 8000,
        path: url.pathname,
        timeout: 3000,
      },
      (res) => resolve(res.statusCode === 200)
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

(async () => {
  try {
    await main();
  } catch (e) {
    console.error(e.message || e);
    process.exit(1);
  }
})();
