#!/usr/bin/env node
'use strict';

/**
 * Phase 2 — Session revoke smoke test.
 *
 * Proves end-to-end:
 * 1) Revoke ONE session kicks only that device's WebSocket.
 * 2) Revoked device cannot reconnect (WS upgrade blocked).
 * 3) Revoke ALL sessions drops all devices; reconnect blocked until new login.
 *
 * Usage:
 *   cd backend && PORT=8000 ADMIN_USER=dev_admin ADMIN_PASS=dev_admin node scripts/session_revoke_smoke.js
 *
 * Env:
 *   PORT (default 8000)
 *   ADMIN_USER, ADMIN_PASS — required; admin credentials for revoke endpoints (and target user if USER_* not set)
 *   USER_USERNAME, USER_PASS — optional; target user for two sessions (default: use ADMIN_USER/ADMIN_PASS)
 *   WS_DEBUG=1 — print WS events
 */

const http = require('http');
const WebSocket = require('ws');

const PORT = parseInt(process.env.PORT || '8000', 10);
const BASE = `http://127.0.0.1:${PORT}`;
const WS_URL = `ws://127.0.0.1:${PORT}/ws`;
const ADMIN_USER = process.env.ADMIN_USER || process.env.ADMIN_USERNAME;
const ADMIN_PASS = process.env.ADMIN_PASS;
const USER_USERNAME = process.env.USER_USERNAME || process.env.USER_EMAIL;
const USER_PASS = process.env.USER_PASS;
const WS_DEBUG = process.env.WS_DEBUG === '1' || process.env.WS_DEBUG === 'true';

const HELLO_ACK_TIMEOUT_MS = 2000;
const CLOSE_TIMEOUT_MS = 2000;
const REVOKE_POLL_MS = 100;

function log(msg) {
  console.log(msg);
}

function fail(msg) {
  console.error('FAIL:', msg);
  process.exit(1);
}

/** Parse Set-Cookie headers into a single Cookie header value. */
function cookieHeaderFromResponse(res) {
  const setCookie = res.headers['set-cookie'];
  if (!setCookie || !Array.isArray(setCookie)) return '';
  return setCookie.map((c) => c.split(';')[0].trim()).join('; ');
}

/** Decode JWT payload without verification (for smoke: extract sid and userId). */
function decodeJwtPayload(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = Buffer.from(parts[1], 'base64url').toString('utf8');
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

/** Get sessionId (sid) and userId from cookie string (assumes first cookie is JWT). */
function getSessionFromCookieHeader(cookieHeader, jwtCookieName = 'token') {
  if (!cookieHeader) return null;
  const pairs = cookieHeader.split(';').map((s) => s.trim());
  for (const p of pairs) {
    const eq = p.indexOf('=');
    if (eq === -1) continue;
    const name = p.slice(0, eq).trim();
    const value = p.slice(eq + 1).trim();
    if (name === jwtCookieName && value) {
      const payload = decodeJwtPayload(value);
      if (payload && (payload.sid || payload.sessionId)) {
        return {
          sessionId: payload.sid || payload.sessionId,
          userId: payload.userId || payload.sub || payload.id,
        };
      }
      return null;
    }
  }
  return null;
}

/** HTTP request helper; returns { statusCode, body, cookieHeader }. */
function request(method, path, body, cookieHeader = '') {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const opts = {
      hostname: url.hostname,
      port: url.port || PORT,
      path: url.pathname + url.search,
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (cookieHeader) opts.headers['Cookie'] = cookieHeader;
    if (body != null && method !== 'GET') {
      const data = JSON.stringify(body);
      opts.headers['Content-Length'] = Buffer.byteLength(data);
    }
    const req = http.request(opts, (res) => {
      const cookie = cookieHeaderFromResponse(res);
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        let bodyObj = {};
        try {
          if (data) bodyObj = JSON.parse(data);
        } catch (_) {}
        resolve({
          statusCode: res.statusCode,
          body: bodyObj,
          cookieHeader: cookie || undefined,
        });
      });
    });
    req.on('error', reject);
    if (body != null && method !== 'GET') req.write(JSON.stringify(body));
    req.end();
  });
}

/** Login and return { cookieHeader, userId, sessionId } from JWT. */
async function loginAs(username, password) {
  const res = await request('POST', '/api/login', { username, password });
  if (res.statusCode !== 200) {
    throw new Error(`Login failed: ${res.statusCode} ${JSON.stringify(res.body)}`);
  }
  const cookie = res.cookieHeader;
  if (!cookie) throw new Error('Login did not set cookies');
  const session = getSessionFromCookieHeader(cookie);
  if (!session || !session.sessionId) throw new Error('Could not get sessionId from JWT');
  const user = res.body?.data?.user || res.body?.user;
  const userId = session.userId || user?.id || user?.userId;
  return { cookieHeader: cookie, userId, sessionId: session.sessionId };
}

/** Open WebSocket with cookie, send HELLO, wait for HELLO_ACK. Returns { ws, gotHello }. */
function openWsAndHello(cookieHeader, label) {
  return new Promise((resolve, reject) => {
    const headers = cookieHeader ? { Cookie: cookieHeader } : {};
    const ws = new WebSocket(WS_URL, { headers });
    let resolved = false;
    const timeout = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      try { ws.close(); } catch (_) {}
      reject(new Error(`${label}: no HELLO_ACK within ${HELLO_ACK_TIMEOUT_MS}ms`));
    }, HELLO_ACK_TIMEOUT_MS);

    ws.on('open', () => {
      if (WS_DEBUG) log(`  [${label}] ws open`);
      ws.send(JSON.stringify({ type: 'HELLO', version: 1 }));
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'HELLO_ACK' && !resolved) {
          resolved = true;
          clearTimeout(timeout);
          resolve({ ws, gotHello: true });
        }
      } catch (_) {}
    });

    ws.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        reject(err);
      }
    });

    ws.on('close', (code, reason) => {
      if (WS_DEBUG) log(`  [${label}] ws close code=${code} reason=${reason}`);
    });
  });
}

/** Wait until socket is closed or timeout. Returns true if closed. */
function waitClosed(ws, timeoutMs) {
  return new Promise((resolve) => {
    if (ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
      resolve(true);
      return;
    }
    const t = setTimeout(() => resolve(false), timeoutMs);
    ws.once('close', () => {
      clearTimeout(t);
      resolve(true);
    });
  });
}

async function main() {
  if (!ADMIN_USER || !ADMIN_PASS) {
    fail('ADMIN_USER and ADMIN_PASS are required');
  }
  const targetUser = USER_USERNAME || ADMIN_USER;
  const targetPass = USER_PASS || ADMIN_PASS;
  if (!targetUser || !targetPass) {
    fail('USER_USERNAME/USER_PASS or ADMIN_USER/ADMIN_PASS required for target user');
  }

  log('login A ok');
  const sessionA = await loginAs(targetUser, targetPass);
  const jarA = sessionA.cookieHeader;
  const userId = sessionA.userId;
  const sessionIdA = sessionA.sessionId;
  if (!userId) fail('Could not determine userId from login A');

  log('login B ok');
  const sessionB = await loginAs(targetUser, targetPass);
  const jarB = sessionB.cookieHeader;
  const sessionIdB = sessionB.sessionId;
  if (sessionIdA === sessionIdB) fail('Two logins must yield two different session IDs');

  log(`ws A connected (sessionId=${sessionIdA})`);
  const { ws: wsA } = await openWsAndHello(jarA, 'A');
  log(`ws B connected (sessionId=${sessionIdB})`);
  const { ws: wsB } = await openWsAndHello(jarB, 'B');

  const adminLogin = await loginAs(ADMIN_USER, ADMIN_PASS);
  const adminCookie = adminLogin.cookieHeader;

  // Revoke only session A
  const revokeOneRes = await request(
    'POST',
    `/api/admin/users/${userId}/sessions/${sessionIdA}/revoke`,
    null,
    adminCookie
  );
  if (revokeOneRes.statusCode !== 200) {
    fail(`revoke one session: ${revokeOneRes.statusCode} ${JSON.stringify(revokeOneRes.body)}`);
  }
  log('revoke session A ok');

  const closedA = await waitClosed(wsA, CLOSE_TIMEOUT_MS);
  if (!closedA) fail('ws A should close within timeout after revoke');
  log('ws A closed ✅');

  const stillOpen = wsB.readyState === WebSocket.OPEN;
  if (!stillOpen) fail('ws B should remain open after revoking only session A');
  log('ws B still open ✅');

  // Reconnect with jarA must fail (no HELLO_ACK or connection rejected)
  try {
    const { ws: wsA2, gotHello } = await Promise.race([
      openWsAndHello(jarA, 'A-reconnect'),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 2500)),
    ]);
    try { wsA2.close(); } catch (_) {}
    if (gotHello) fail('reconnect A with revoked session must not receive HELLO_ACK');
  } catch (e) {
    if (e.message && e.message.includes('HELLO_ACK')) {
      // Expected: no HELLO_ACK
    } else if (e.message === 'timeout') {
      // Connection might have hung or closed without HELLO_ACK — acceptable
    } else {
      // Connection error / 401 — acceptable
    }
  }
  log('reconnect A blocked ✅');

  // Revoke all sessions for user
  const revokeAllRes = await request(
    'POST',
    `/api/admin/users/${userId}/revoke-sessions`,
    null,
    adminCookie
  );
  if (revokeAllRes.statusCode !== 200) {
    fail(`revoke all sessions: ${revokeAllRes.statusCode} ${JSON.stringify(revokeAllRes.body)}`);
  }
  log('revoke all ok');

  const closedB = await waitClosed(wsB, CLOSE_TIMEOUT_MS);
  if (!closedB) fail('ws B should close within timeout after revoke all');
  log('ws B closed ✅');

  try {
    const { ws: wsB2, gotHello } = await Promise.race([
      openWsAndHello(jarB, 'B-reconnect'),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 2500)),
    ]);
    try { wsB2.close(); } catch (_) {}
    if (gotHello) fail('reconnect B with revoked session must not receive HELLO_ACK');
  } catch (e) {
    // Expected: timeout or no HELLO_ACK or connection error
  }
  log('reconnect B blocked ✅');

  log('PASS');
  process.exit(0);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
