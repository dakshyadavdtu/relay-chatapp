#!/usr/bin/env node
'use strict';

/**
 * Read cursor persistence regression test.
 *
 * Ensures that after POST /api/chats/:chatId/read, GET /api/chats returns unreadCount = 0
 * for that chat (cursor is persisted; unread badge stays correct after refresh).
 *
 * Flow:
 * 1. Register user A and user B.
 * 2. As B: send a message to A → capture messageId.
 * 3. As A: GET /api/chats → expect one chat with unreadCount > 0.
 * 4. As A: POST /api/chats/:chatId/read with lastReadMessageId.
 * 5. As A: GET /api/chats again → same chat must have unreadCount === 0.
 *
 * Run: node -r dotenv/config tests/chat/read-cursor-persistence.test.js (from backend)
 * Requires: MongoDB (DB_URI or MONGODB_URI), same as other integration tests.
 *
 * Regression: If POST /read is never called (e.g. frontend omitted markChatRead), step 5
 * would see unreadCount >= 1 and this test would fail. So the test fails on old behavior
 * and passes when the read cursor is persisted.
 */

const http = require('http');
const path = require('path');
const backendRoot = path.resolve(__dirname, '..', '..');

const app = require(path.join(backendRoot, 'app'));

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

async function run() {
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  const ts = Date.now();
  const userA = `readcur_a_${ts}`;
  const userB = `readcur_b_${ts}`;
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

  // 2. Login as B, send message to A
  const loginB = await request('POST', '/api/login', { username: userB, password });
  if (loginB.status !== 200) fail(`Login B: expected 200, got ${loginB.status}`);
  const sendRes = await request('POST', '/api/chat/send', {
    recipientId: idA,
    content: 'Hi A, unread test',
  });
  if (sendRes.status !== 201) fail(`Send message: expected 201, got ${sendRes.status} ${JSON.stringify(sendRes.body)}`);
  const messageId = sendRes.body?.data?.message?.id || sendRes.body?.data?.message?.messageId;
  if (!messageId) fail('Send response missing message id');
  cookieJar.cookie = null;

  // 3. Login as A, GET /api/chats → expect unreadCount > 0
  const loginA = await request('POST', '/api/login', { username: userA, password });
  if (loginA.status !== 200) fail(`Login A: expected 200, got ${loginA.status}`);
  const getChats1 = await request('GET', '/api/chats');
  if (getChats1.status !== 200) fail(`GET /api/chats: expected 200, got ${getChats1.status}`);
  const chats1 = getChats1.body?.data?.chats || [];
  const dmChat = chats1.find((c) => c.chatId && c.chatId.startsWith('direct:'));
  if (!dmChat) fail('GET /api/chats: expected at least one direct chat');
  if (typeof dmChat.unreadCount !== 'number' || dmChat.unreadCount < 1) {
    fail(`GET /api/chats: expected unreadCount >= 1 for DM, got ${dmChat.unreadCount}`);
  }
  const chatId = dmChat.chatId;

  // 4. POST /api/chats/:chatId/read
  const readPath = `/api/chats/${encodeURIComponent(chatId)}/read`;
  const postRead = await request('POST', readPath, { lastReadMessageId: messageId });
  if (postRead.status !== 200) {
    fail(`POST ${readPath}: expected 200, got ${postRead.status} ${JSON.stringify(postRead.body)}`);
  }
  if (postRead.body?.data?.ok !== true) {
    fail(`POST /read: expected data.ok === true, got ${JSON.stringify(postRead.body?.data)}`);
  }

  // 5. GET /api/chats again → same chat must have unreadCount === 0 (simulates refresh)
  const getChats2 = await request('GET', '/api/chats');
  if (getChats2.status !== 200) fail(`GET /api/chats (after read): expected 200, got ${getChats2.status}`);
  const chats2 = getChats2.body?.data?.chats || [];
  const dmChat2 = chats2.find((c) => c.chatId === chatId);
  if (!dmChat2) fail('GET /api/chats (after read): expected same direct chat');
  if (dmChat2.unreadCount !== 0) {
    fail(`GET /api/chats (after read): expected unreadCount === 0 (cursor persisted), got ${dmChat2.unreadCount}`);
  }

  console.log('PASS: Read cursor persistence — POST /read then GET /api/chats returns unreadCount 0');
  server.close();
  process.exit(0);
}

run().catch((err) => {
  console.error('FAIL:', err.message);
  if (server) server.close();
  process.exit(1);
});
