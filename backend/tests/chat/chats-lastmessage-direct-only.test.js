#!/usr/bin/env node
'use strict';

/**
 * GET /api/chats: direct chat lastMessage must be from direct messages only.
 * Room/group messages must NOT be used as lastMessage for a direct chat.
 *
 * Flow:
 * 1. Register user A and user B.
 * 2. As B: send a DM to A (so direct chat A-B exists).
 * 3. Insert a room message (A -> B) with newer timestamp into the message store.
 * 4. As B: GET /api/chats.
 * 5. Assert: direct chat with A has lastMessage.content !== room message content.
 *
 * Run: node -r dotenv/config tests/chat/chats-lastmessage-direct-only.test.js (from backend)
 * Requires: MongoDB (DB_URI or MONGODB_URI).
 */

const http = require('http');
const path = require('path');
const backendRoot = path.resolve(__dirname, '..', '..');

const app = require(path.join(backendRoot, 'app'));
const dbAdapter = require(path.join(backendRoot, 'config/db'));

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
        const parsed = data ? JSON.parse(data) : {};
        resolve({ status: res.statusCode, body: parsed });
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
  if (server) server.close();
  process.exit(1);
}

function directChatId(idA, idB) {
  const [min, max] = [idA, idB].sort();
  return `direct:${min}:${max}`;
}

async function run() {
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  const ts = Date.now();
  const userA = `chats_dm_a_${ts}`;
  const userB = `chats_dm_b_${ts}`;
  const password = 'pass1234';

  // 1. Register A and B
  const regA = await request('POST', '/api/register', { username: userA, password });
  if (regA.status !== 201) fail(`Register A: expected 201, got ${regA.status} ${JSON.stringify(regA.body)}`);
  const idA = regA.body?.data?.user?.id;
  if (!idA) fail('Register A: missing data.user.id');
  cookieJar.cookie = null;

  const regB = await request('POST', '/api/register', { username: userB, password });
  if (regB.status !== 201) fail(`Register B: expected 201, got ${regB.status}`);
  const idB = regB.body?.data?.user?.id;
  if (!idB) fail('Register B: missing data.user.id');
  cookieJar.cookie = null;

  // 2. As B: send DM to A
  const loginB = await request('POST', '/api/login', { username: userB, password });
  if (loginB.status !== 200) fail(`Login B: expected 200, got ${loginB.status}`);
  const dmContent = 'Direct from B to A';
  const sendRes = await request('POST', '/api/chat/send', {
    recipientId: idA,
    content: dmContent,
  });
  if (sendRes.status !== 201) fail(`Send DM: expected 201, got ${sendRes.status} ${JSON.stringify(sendRes.body)}`);
  cookieJar.cookie = null;

  // 3. Insert a room message (A -> B) with newer timestamp so it would win without direct-only filter
  const roomMsgContent = 'Room message must not appear as DM preview';
  const roomMsgTs = Date.now() + 10000;
  await dbAdapter.persistMessage({
    messageId: `chats-room-msg-${ts}`,
    senderId: idA,
    recipientId: idB,
    content: roomMsgContent,
    timestamp: roomMsgTs,
    state: 'sent',
    messageType: 'room',
    roomId: 'room_test_1',
    roomMessageId: 'rm_1',
    chatId: 'room:room_test_1',
  });

  // 4. GET /api/chats as B
  const loginB2 = await request('POST', '/api/login', { username: userB, password });
  if (loginB2.status !== 200) fail(`Login B (2): expected 200, got ${loginB2.status}`);
  const getChats = await request('GET', '/api/chats');
  if (getChats.status !== 200) fail(`GET /api/chats: expected 200, got ${getChats.status}`);
  const chats = getChats.body?.data?.chats || [];
  const directWithA = chats.find((c) => c.chatId === directChatId(idA, idB));
  if (!directWithA) fail('GET /api/chats: expected direct chat with A');

  // 5. Direct chat lastMessage must NOT be the room message
  const lastContent = directWithA.lastMessage?.content;
  if (lastContent === roomMsgContent) {
    fail(`GET /api/chats: direct chat with A must not have lastMessage.content === room message; got "${lastContent}"`);
  }
  if (lastContent !== dmContent) {
    fail(`GET /api/chats: direct chat with A expected lastMessage.content "${dmContent}", got "${lastContent}"`);
  }

  console.log('PASS: GET /api/chats direct chat lastMessage is from direct messages only');
  server.close();
  process.exit(0);
}

run().catch((err) => {
  console.error('FAIL:', err.message);
  if (server) server.close();
  process.exit(1);
});
