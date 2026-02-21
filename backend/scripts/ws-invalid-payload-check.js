'use strict';

/**
 * WebSocket invalid payload verification script.
 * Connects with cookie auth, sends malformed payloads, asserts MESSAGE_ERROR INVALID_PAYLOAD.
 *
 * Prerequisites: Backend running (JWT_SECRET=test).
 * Run: node scripts/ws-invalid-payload-check.js
 *
 * Expects: All malformed payloads return MESSAGE_ERROR with code INVALID_PAYLOAD (server does not crash).
 */

const http = require('http');
const WebSocket = require('ws');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3001';
const WS_URL = (process.env.WS_URL || 'ws://localhost:3001/ws').replace(/^http/, 'ws');
const TEST_USER = 'invalid-payload-test-user';

function fail(msg) {
  console.error('FAIL:', msg);
  process.exit(1);
}

function pass(msg) {
  console.log('PASS:', msg);
}

function login() {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE_URL);
    const opts = {
      hostname: url.hostname,
      port: url.port || 3001,
      path: '/api/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    };
    const req = http.request(opts, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        const cookie = res.headers['set-cookie'];
        if (!cookie) return reject(new Error('No Set-Cookie in login response'));
        resolve(cookie);
      });
    });
    req.on('error', reject);
    req.write(JSON.stringify({ userId: TEST_USER }));
    req.end();
  });
}

function sendAndWaitResponse(ws, payload, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.removeListener('message', handler);
      resolve(null);
    }, timeoutMs);
    const handler = (data) => {
      clearTimeout(timer);
      ws.removeListener('message', handler);
      try {
        const msg = JSON.parse(data.toString());
        resolve(msg);
      } catch {
        resolve(null);
      }
    };
    ws.on('message', handler);
    ws.send(JSON.stringify(payload), (err) => {
      if (err) {
        clearTimeout(timer);
        ws.removeListener('message', handler);
        reject(err);
      }
    });
  });
}

async function run() {
  let cookie;
  try {
    cookie = await login();
  } catch (e) {
    fail(`Login failed: ${e.message}. Is backend running? (JWT_SECRET=test node server.js)`);
  }
  pass('Login OK');

  const ws = new WebSocket(WS_URL, {
    headers: { Cookie: Array.isArray(cookie) ? cookie[0] : cookie },
  });

  await new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });
  pass('WebSocket connected');

  // Drain initial messages (CONNECTION_ESTABLISHED, SYSTEM_CAPABILITIES)
  await new Promise((r) => setTimeout(r, 300));

  // HELLO first (required) — drain until HELLO_ACK
  ws.send(JSON.stringify({ type: 'HELLO', version: 1 }));
  const helloResp = await new Promise((resolve, reject) => {
    const handler = (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'HELLO_ACK') {
          ws.removeListener('message', handler);
          clearTimeout(timer);
          resolve(msg);
        }
      } catch (_) {}
    };
    const timer = setTimeout(() => {
      ws.removeListener('message', handler);
      resolve(null);
    }, 3000);
    ws.on('message', handler);
  });
  if (!helloResp) {
    fail('HELLO failed: no HELLO_ACK within timeout');
  }
  pass('HELLO OK');

  const malformedPayloads = [
    { name: 'MESSAGE_SEND missing recipientId', payload: { type: 'MESSAGE_SEND', content: 'hi' } },
    { name: 'MESSAGE_SEND missing content', payload: { type: 'MESSAGE_SEND', recipientId: 'u2' } },
    { name: 'MESSAGE_SEND content empty string', payload: { type: 'MESSAGE_SEND', recipientId: 'u2', content: '' } },
    { name: 'MESSAGE_SEND content too long', payload: { type: 'MESSAGE_SEND', recipientId: 'u2', content: 'x'.repeat(10001) } },
    { name: 'MESSAGE_READ missing messageId', payload: { type: 'MESSAGE_READ' } },
    { name: 'MESSAGE_DELIVERED_CONFIRM missing messageId', payload: { type: 'MESSAGE_DELIVERED_CONFIRM' } },
    { name: 'HELLO version wrong type', payload: { type: 'HELLO', version: '1' } },
    { name: 'ROOM_CREATE missing roomId', payload: { type: 'ROOM_CREATE' } },
    { name: 'ROOM_MESSAGE missing roomId', payload: { type: 'ROOM_MESSAGE', content: 'hi' } },
    { name: 'PRESENCE_PING invalid status', payload: { type: 'PRESENCE_PING', status: 'invalid' } },
    { name: 'CLIENT_ACK missing messageId', payload: { type: 'CLIENT_ACK' } },
    { name: 'No type field', payload: { recipientId: 'u2', content: 'hi' } },
    { name: 'Empty object', payload: {} },
  ];

  let passed = 0;
  for (const { name, payload } of malformedPayloads) {
    const resp = await sendAndWaitResponse(ws, payload);
    if (!resp) {
      fail(`${name}: No response from server`);
    }
    if (resp.type !== 'MESSAGE_ERROR') {
      fail(`${name}: Expected MESSAGE_ERROR, got type=${resp.type} ${JSON.stringify(resp)}`);
    }
    if (resp.code !== 'INVALID_PAYLOAD') {
      fail(`${name}: Expected code INVALID_PAYLOAD, got ${resp.code}`);
    }
    pass(`${name}: MESSAGE_ERROR INVALID_PAYLOAD`);
    passed++;
  }

  ws.close();
  console.log(`\n✅ All ${passed} malformed payloads returned MESSAGE_ERROR INVALID_PAYLOAD (server did not crash)`);
  process.exit(0);
}

run().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
