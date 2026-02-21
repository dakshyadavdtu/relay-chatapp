#!/usr/bin/env node
'use strict';

/**
 * Password reset (OTP) flow smoke test.
 * 1) Register user with email
 * 2) Create OTP for that email (simulates forgot)
 * 3) POST /api/password/verify
 * 4) POST /api/password/reset
 * 5) Login with new password succeeds
 *
 * Run from backend: node tests/passwordReset.smoke.js
 */

const http = require('http');
const path = require('path');
const backendRoot = path.resolve(__dirname, '..');

// Load app and store after env is loaded
require(path.join(backendRoot, 'config/env'));
const app = require(path.join(backendRoot, 'app'));
const passwordResetStore = require(path.join(backendRoot, 'auth/passwordResetStore'));

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
    if (body !== undefined && body !== null) {
      opts.headers['Content-Length'] = Buffer.byteLength(JSON.stringify(body));
    }
    const req = http.request(opts, (res) => {
      const setCookie = res.headers['set-cookie'];
      if (setCookie) {
        cookieJar.cookie = setCookie.map((c) => c.split(';')[0]).join('; ');
      }
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
    req.write(body !== undefined && body !== null ? JSON.stringify(body) : '');
    req.end();
  });
}

let server;

function fail(msg) {
  console.error('FAIL:', msg);
  process.exit(1);
}

async function run() {
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  const uniq = 'pw_' + Date.now();
  const username = 'user_' + uniq;
  const email = 'test_' + uniq + '@example.com';
  const initialPassword = 'oldPass123';
  const newPassword = 'newPass456';

  // 1) Register user with email
  const reg = await request('POST', '/api/register', {
    username,
    password: initialPassword,
    email,
  });
  if (reg.status !== 201 || !reg.body.success) {
    fail('Register with email: expected 201, got ' + reg.status + ' ' + JSON.stringify(reg.body));
  }
  console.log('PASS: Register with email → 201');
  cookieJar.cookie = null;

  // 2) Create OTP for email (simulates what /password/forgot does)
  const { otp } = passwordResetStore.createOTPForEmail(email);
  if (!otp || otp.length < 4) fail('createOTPForEmail should return otp');
  console.log('PASS: OTP created for email');

  // 3) POST /api/password/verify
  const verifyRes = await request('POST', '/api/password/verify', { email, otp }, false);
  if (verifyRes.status !== 200 || !verifyRes.body.success) {
    fail('Verify OTP: expected 200, got ' + verifyRes.status + ' ' + JSON.stringify(verifyRes.body));
  }
  console.log('PASS: POST /api/password/verify → 200');

  // 4) POST /api/password/reset
  const resetRes = await request('POST', '/api/password/reset', {
    email,
    otp,
    newPassword,
  }, false);
  if (resetRes.status !== 200 || !resetRes.body.success) {
    fail('Reset password: expected 200, got ' + resetRes.status + ' ' + JSON.stringify(resetRes.body));
  }
  console.log('PASS: POST /api/password/reset → 200');

  // 5) Login with new password succeeds
  const loginRes = await request('POST', '/api/login', { username, password: newPassword }, false);
  if (loginRes.status !== 200 || !loginRes.body.success || !loginRes.body.data?.user) {
    fail('Login with new password: expected 200 + user, got ' + loginRes.status + ' ' + JSON.stringify(loginRes.body));
  }
  console.log('PASS: Login with new password → 200');

  // Optional: login with old password fails
  const oldLogin = await request('POST', '/api/login', { username, password: initialPassword }, false);
  if (oldLogin.status === 200 && oldLogin.body.success) {
    fail('Login with old password should fail');
  }
  console.log('PASS: Login with old password fails');

  server.close();
  console.log('All password reset smoke tests passed.');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
