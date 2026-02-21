#!/usr/bin/env node
'use strict';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * DO NOT RUN IN PROD; FOR LOCAL REPRO ONLY
 * ═══════════════════════════════════════════════════════════════════════════════
 * This script mutates process.env and is for reproducing the historical
 * trailing-slash origin mismatch. Use only in local/dev environments.
 *
 * Deterministic repro for OriginGuard 403 (CSRF_BLOCKED) when CORS_ORIGINS
 * contained a trailing slash but the browser sent Origin without one (now fixed
 * by canonical origin normalization).
 *
 * Run from repo root: node backend/scripts/repro-origin-403.js
 * Or from backend: node scripts/repro-origin-403.js
 */

// Set env BEFORE requiring origins so parse() sees these values
process.env.CORS_ORIGINS = 'https://myapp.onrender.com/';
process.env.NODE_ENV = 'production';

const path = require('path');
const backendDir = path.resolve(__dirname, '..');
const originsPath = path.join(backendDir, 'config', 'origins.js');
// Ensure fresh load with our env (clear cache in case this process already required origins)
delete require.cache[require.resolve(originsPath)];
const { getAllowedOrigins, isAllowedOrigin } = require(originsPath);

const allowed = getAllowedOrigins().allowedOrigins;
const requestOrigin = 'https://myapp.onrender.com'; // no trailing slash (what browsers send)
const matched = isAllowedOrigin(requestOrigin);

console.log('CORS_ORIGINS (env):', process.env.CORS_ORIGINS);
console.log('allowedOrigins:', allowed);
console.log('Request Origin (no slash):', requestOrigin);
console.log('isAllowedOrigin:', matched);
console.log('');

if (allowed.includes(requestOrigin)) {
  console.error('FAIL: allowedOrigins should NOT contain request origin (exact match with slash in list only).');
  process.exit(1);
}
if (matched) {
  console.error('FAIL: isAllowedOrigin should be false so that OriginGuard returns 403.');
  process.exit(1);
}

console.log('OK: Origin would be BLOCKED (403 CSRF_BLOCKED). Trailing-slash mismatch reproduced.');
console.log('');
console.log('Live server repro (with backend running):');
console.log('  1. Start backend with: CORS_ORIGINS="https://myapp.onrender.com/" (trailing slash)');
console.log('  2. curl -X POST http://localhost:PORT/api/login -H "Origin: https://myapp.onrender.com" -H "Content-Type: application/json" -d "{}"');
console.log('  3. Expect 403 and body code CSRF_BLOCKED.');
process.exit(0);
