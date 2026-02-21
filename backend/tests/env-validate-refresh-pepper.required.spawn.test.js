#!/usr/bin/env node
'use strict';

/**
 * Regression test: production env validation must fail-fast when REFRESH_PEPPER
 * is missing or empty. Ensures REFRESH_PEPPER stays in the prod required list.
 *
 * Run: node tests/env-validate-refresh-pepper.required.spawn.test.js (from backend)
 * Or: npm test (included in main test script)
 *
 * Does not log or assert any pepper value; only checks exit code and stderr message.
 */

const path = require('path');
const { spawn } = require('child_process');

const backendRoot = path.resolve(__dirname, '..');
const envValidatePath = path.join(backendRoot, 'config', 'env.validate.js');

const EXPECTED_STDERR_SUBSTRING = 'Missing required environment variable for production: REFRESH_PEPPER';

function runValidationWithEnv(env) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['-e', 'require(process.argv[1])();', envValidatePath],
      {
        cwd: backendRoot,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code, signal) => resolve({ code, signal, stderr }));
    child.on('error', reject);
  });
}

async function main() {
  // Production-like env with all required vars EXCEPT REFRESH_PEPPER.
  // REFRESH_PEPPER is omitted so validation must exit(1) with the expected message.
  const childEnv = {
    ...process.env,
    NODE_ENV: 'production',
    PORT: '3000',
    JWT_SECRET: 'test-secret-min-32-chars-for-validation',
    DB_URI: 'mongodb+srv://x:x@x.mongodb.net/x',
    COOKIE_DOMAIN: '.example.com',
    WS_PATH: '/ws',
    CORS_ORIGIN: 'http://localhost:3000',
    METRICS_MODE: 'secret',
    METRICS_SECRET: 'dummy-metrics-secret',
  };
  // Explicitly omit REFRESH_PEPPER (do not set it).
  delete childEnv.REFRESH_PEPPER;

  const { code, stderr } = await runValidationWithEnv(childEnv);

  if (code !== 1) {
    console.error('FAIL: Expected exit code 1 when REFRESH_PEPPER is missing; got', code);
    process.exit(1);
  }
  if (!stderr.includes(EXPECTED_STDERR_SUBSTRING)) {
    console.error('FAIL: stderr should contain:', EXPECTED_STDERR_SUBSTRING);
    console.error('stderr was:', stderr.slice(0, 500));
    process.exit(1);
  }

  console.log('PASS: Production env validation fails with correct message when REFRESH_PEPPER is missing');
  process.exit(0);
}

main().catch((err) => {
  console.error('FAIL:', err.message);
  process.exit(1);
});
