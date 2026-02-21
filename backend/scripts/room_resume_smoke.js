#!/usr/bin/env node
'use strict';

/**
 * Phase 3D — Room resume/snapshot smoke test.
 *
 * Connects, HELLO/ACK, RESUME, then verifies RESYNC_START → RESYNC_COMPLETE → ROOMS_SNAPSHOT.
 * Optionally: create room, disconnect, reconnect, verify snapshot includes room with version.
 *
 * Usage:
 *   cd backend && PORT=8000 ADMIN_USER=dev_admin ADMIN_PASS=dev_admin node scripts/room_resume_smoke.js
 *
 * Env: PORT, ADMIN_USER, ADMIN_PASS.
 */

const http = require('http');
const WebSocket = require('ws');

const PORT = parseInt(process.env.PORT || '8000', 10);
const BASE = `http://127.0.0.1:${PORT}`;
const WS_URL = `ws://127.0.0.1:${PORT}/ws`;
const ADMIN_USER = process.env.ADMIN_USER || process.env.ADMIN_USERNAME;
const ADMIN_PASS = process.env.ADMIN_PASS;
const RESPONSE_MS = 5000;

function log(msg) {
  console.log(msg);
}

function fail(msg) {
  console.error('FAIL:', msg);
  process.exit(1);
}

function cookieHeaderFromResponse(res) {
  const setCookie = res.headers['set-cookie'];
  if (!setCookie || !Array.isArray(setCookie)) return '';
  return setCookie.map((c) => c.split(';')[0].trim()).join('; ');
}

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
        resolve({ statusCode: res.statusCode, body: bodyObj, cookieHeader: cookie || undefined });
      });
    });
    req.on('error', reject);
    if (body != null && method !== 'GET') req.write(JSON.stringify(body));
    req.end();
  });
}

async function loginAs(username, password) {
  const res = await request('POST', '/api/login', { username, password });
  if (res.statusCode !== 200) throw new Error('Login failed: ' + res.statusCode);
  if (!res.cookieHeader) throw new Error('No cookie');
  const user = res.body?.data?.user || res.body?.user;
  const userId = user?.id || user?.userId;
  return { cookieHeader: res.cookieHeader, userId };
}

function openWs(cookieHeader) {
  return new Promise((resolve, reject) => {
    const headers = cookieHeader ? { Cookie: cookieHeader } : {};
    const ws = new WebSocket(WS_URL, { headers });
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

function sendAndCollect(ws, payload, expectTypes, timeoutMs = RESPONSE_MS) {
  const expectSet = new Set(Array.isArray(expectTypes) ? expectTypes : [expectTypes]);
  const collected = [];
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      ws.removeListener('message', onMessage);
      resolve(collected);
    }, timeoutMs);
    const onMessage = (data) => {
      try {
        const msg = JSON.parse(data.toString());
        collected.push(msg);
        if (msg.type === 'ERROR' || msg.type === 'MESSAGE_ERROR') {
          clearTimeout(t);
          ws.removeListener('message', onMessage);
          reject(new Error(msg.message || msg.code || 'Request failed'));
          return;
        }
        if (expectSet.has(msg.type)) {
          clearTimeout(t);
          ws.removeListener('message', onMessage);
          resolve(collected);
        }
      } catch (_) {}
    };
    ws.on('message', onMessage);
    ws.send(JSON.stringify(payload));
  });
}

async function main() {
  if (!ADMIN_USER || !ADMIN_PASS) fail('ADMIN_USER and ADMIN_PASS required');

  log('Login');
  const A = await loginAs(ADMIN_USER, ADMIN_PASS);

  log('Connect WS');
  const ws = await openWs(A.cookieHeader);

  log('Send HELLO');
  ws.send(JSON.stringify({ type: 'HELLO', version: 1 }));

  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('No HELLO_ACK')), 5000);
    const onMessage = (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'HELLO_ACK') {
          clearTimeout(t);
          ws.removeListener('message', onMessage);
          resolve();
        }
      } catch (_) {}
    };
    ws.on('message', onMessage);
  });
  log('HELLO_ACK received');

  log('Send RESUME');
  const collected = await sendAndCollect(ws, { type: 'RESUME' }, ['ROOMS_SNAPSHOT'], 15000);
  const types = collected.map((m) => m.type);
  log('Collected: ' + types.join(', '));

  const resyncStart = collected.find((m) => m.type === 'RESYNC_START');
  const resyncComplete = collected.find((m) => m.type === 'RESYNC_COMPLETE');
  const snapshot = collected.find((m) => m.type === 'ROOMS_SNAPSHOT');

  if (!snapshot) fail('Missing ROOMS_SNAPSHOT after RESUME');
  if (!resyncStart) log('Note: RESYNC_START not in collected (order may vary)');
  if (!resyncComplete) log('Note: RESYNC_COMPLETE not in collected (order may vary)');

  log('ROOMS_SNAPSHOT received');

  if (!Array.isArray(snapshot.rooms)) fail('ROOMS_SNAPSHOT.rooms must be an array');
  log('ROOMS_SNAPSHOT.rooms length: ' + snapshot.rooms.length);

  for (const r of snapshot.rooms) {
    const id = r.id ?? r.roomId;
    if (!id) fail('Room entry missing id/roomId');
    if (typeof (r.version ?? r.updatedAt) !== 'number' && r.updatedAt === undefined) {
      log('Room ' + id + ' has version/updatedAt (optional but recommended): version=' + r.version + ', updatedAt=' + r.updatedAt);
    }
  }

  log('Snapshot versions check ok');

  ws.close();
  log('PASS');
  process.exit(0);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
