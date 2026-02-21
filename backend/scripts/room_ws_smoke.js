#!/usr/bin/env node
'use strict';

/**
 * Phase 3B — Room WS protocol smoke test.
 *
 * Covers: create room, update meta, add members, set role, remove member,
 * leave, delete; verifies ERROR on forbidden action (e.g. non-owner delete).
 *
 * Usage:
 *   cd backend && PORT=8000 ADMIN_USER=dev_admin ADMIN_PASS=dev_admin node scripts/room_ws_smoke.js
 *
 * Env: PORT, ADMIN_USER, ADMIN_PASS (second user = same if not set).
 */

const http = require('http');
const WebSocket = require('ws');

const PORT = parseInt(process.env.PORT || '8000', 10);
const BASE = `http://127.0.0.1:${PORT}`;
const WS_URL = `ws://127.0.0.1:${PORT}/ws`;
const ADMIN_USER = process.env.ADMIN_USER || process.env.ADMIN_USERNAME;
const ADMIN_PASS = process.env.ADMIN_PASS;
const USER_B = process.env.USER_USERNAME || process.env.USER_EMAIL;
const USER_B_PASS = process.env.USER_PASS;
const WS_DEBUG = process.env.WS_DEBUG === '1' || process.env.WS_DEBUG === 'true';

const HELLO_ACK_MS = 2000;
const RESPONSE_MS = 3000;

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

function openWsAndHello(cookieHeader) {
  return new Promise((resolve, reject) => {
    const headers = cookieHeader ? { Cookie: cookieHeader } : {};
    const ws = new WebSocket(WS_URL, { headers });
    const t = setTimeout(() => {
      try { ws.close(); } catch (_) {}
      reject(new Error('No HELLO_ACK within ' + HELLO_ACK_MS + 'ms'));
    }, HELLO_ACK_MS);
    ws.on('open', () => ws.send(JSON.stringify({ type: 'HELLO', version: 1 })));
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'HELLO_ACK') {
          clearTimeout(t);
          resolve(ws);
        }
      } catch (_) {}
    });
    ws.on('error', (err) => {
      clearTimeout(t);
      reject(err);
    });
  });
}

function sendAndWait(ws, payload, expectTypeOrTypes, timeoutMs = RESPONSE_MS) {
  const expectSet = Array.isArray(expectTypeOrTypes) ? new Set(expectTypeOrTypes) : new Set([expectTypeOrTypes]);
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Timeout waiting for ' + Array.from(expectSet).join('|'))), timeoutMs);
    const onMessage = (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (expectSet.has(msg.type) || msg.type === 'ERROR' || msg.type === 'MESSAGE_ERROR') {
          clearTimeout(t);
          ws.removeListener('message', onMessage);
          resolve(msg);
        }
      } catch (_) {}
    };
    ws.on('message', onMessage);
    ws.send(JSON.stringify(payload));
  });
}

async function main() {
  if (!ADMIN_USER || !ADMIN_PASS) fail('ADMIN_USER and ADMIN_PASS required');
  const userB = USER_B || ADMIN_USER;
  const userBPass = USER_B_PASS || ADMIN_PASS;

  log('login A');
  const A = await loginAs(ADMIN_USER, ADMIN_PASS);
  log('login B');
  const B = await loginAs(userB, userBPass);
  const memberIdsForCreate = B.userId ? [B.userId] : [];

  log('ws A connect');
  const wsA = await openWsAndHello(A.cookieHeader);

  const cid = 'smoke-' + Date.now();

  log('ROOM_CREATE');
  const createPayload = { type: 'ROOM_CREATE', correlationId: cid, name: 'Smoke Room', memberIds: memberIdsForCreate };
  const created = await sendAndWait(wsA, createPayload, ['ROOM_CREATED', 'ROOM_CREATE_RESPONSE'], 5000);
  if (created.type === 'ERROR' || created.type === 'MESSAGE_ERROR') {
    fail('ROOM_CREATE: ' + (created.code || created.error) + ' - ' + (created.message || created.details));
  }
  const roomId = created.room?.id ?? created.roomId;
  if (!roomId) fail('ROOM_CREATE response missing room.id/roomId: ' + JSON.stringify(created));

  log('ROOM_UPDATE_META');
  const updated = await sendAndWait(wsA, { type: 'ROOM_UPDATE_META', correlationId: cid + '-meta', roomId, patch: { name: 'Smoke Room Renamed' } }, 'ROOM_UPDATED');
  if (updated.type === 'ERROR') fail('ROOM_UPDATE_META: ' + updated.code);

  log('ROOM_ADD_MEMBERS');
  const addResp = await sendAndWait(wsA, { type: 'ROOM_ADD_MEMBERS', correlationId: cid + '-add', roomId, userIds: [B.userId] }, 'ROOM_MEMBERS_UPDATED');
  if (addResp.type === 'ERROR') fail('ROOM_ADD_MEMBERS: ' + addResp.code);

  log('ROOM_SET_ROLE');
  const roleResp = await sendAndWait(wsA, { type: 'ROOM_SET_ROLE', correlationId: cid + '-role', roomId, userId: B.userId, role: 'ADMIN' }, 'ROOM_MEMBERS_UPDATED');
  if (roleResp.type === 'ERROR') fail('ROOM_SET_ROLE: ' + roleResp.code);

  log('ROOM_REMOVE_MEMBER');
  const removeResp = await sendAndWait(wsA, { type: 'ROOM_REMOVE_MEMBER', correlationId: cid + '-rem', roomId, userId: B.userId }, 'ROOM_MEMBERS_UPDATED');
  if (removeResp.type === 'ERROR') fail('ROOM_REMOVE_MEMBER: ' + removeResp.code);

  log('ROOM_ADD_MEMBERS (re-add B)');
  await sendAndWait(wsA, { type: 'ROOM_ADD_MEMBERS', roomId, userIds: [B.userId] }, 'ROOM_MEMBERS_UPDATED');

  log('ws B connect');
  const wsB = await openWsAndHello(B.cookieHeader);
  const joinResp = await sendAndWait(wsB, { type: 'ROOM_JOIN', roomId }, 'ROOM_JOIN_RESPONSE');
  if (joinResp.type === 'ERROR' || !joinResp.success) fail('ROOM_JOIN: ' + (joinResp.error || joinResp.code));

  log('B tries ROOM_DELETE (expect FORBIDDEN)');
  const delAsB = await sendAndWait(wsB, { type: 'ROOM_DELETE', correlationId: cid + '-delb', roomId }, 'ERROR');
  if (delAsB.type !== 'ERROR' || delAsB.code !== 'FORBIDDEN') {
    fail('Expected ERROR FORBIDDEN when non-owner deletes, got: ' + (delAsB.type || '') + ' ' + (delAsB.code || ''));
  }
  log('FORBIDDEN on B delete ok');

  wsB.close();

  log('ROOM_DELETE (as owner A)');
  const delResp = await sendAndWait(wsA, { type: 'ROOM_DELETE', correlationId: cid + '-del', roomId }, 'ROOM_DELETED');
  if (delResp.type === 'ERROR') fail('ROOM_DELETE: ' + delResp.code);
  if (delResp.type !== 'ROOM_DELETED') fail('Expected ROOM_DELETED');

  wsA.close();
  log('PASS');
  process.exit(0);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
