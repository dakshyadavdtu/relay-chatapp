#!/usr/bin/env node
'use strict';

/**
 * WS-4 verification smoke: login → WS with cookie → HELLO → HELLO_ACK within 2s.
 * Optional: if RECIPIENT_ID is set, send one MESSAGE_SEND and expect MESSAGE_ACK.
 *
 * Run: cd backend && PORT=8000 node scripts/ws_smoke.js
 * With message test: RECIPIENT_ID=<user-uuid> PORT=8000 node scripts/ws_smoke.js
 */

const http = require('http');
const WebSocket = require('ws');

const PORT = process.env.PORT || '8000';
const BASE = `http://localhost:${PORT}`;
const WS_URL = `ws://localhost:${PORT}/ws`;
const HELLO_ACK_TIMEOUT_MS = 2000;
const MESSAGE_ACK_TIMEOUT_MS = 2000;
const RECIPIENT_ID = process.env.RECIPIENT_ID || null;
const WS_SMOKE_USER = process.env.WS_SMOKE_USER || 'dev_admin';
const WS_SMOKE_PASS = process.env.WS_SMOKE_PASS || 'dev_admin';

function fail(msg) {
  console.error('FAIL:', msg);
  process.exit(1);
}

function login() {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ username: WS_SMOKE_USER, password: WS_SMOKE_PASS });
    const req = http.request(
      BASE + '/api/login',
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': body.length } },
      (res) => {
        const setCookie = res.headers['set-cookie'];
        const cookie = setCookie ? setCookie.map((c) => c.split(';')[0]).join('; ') : '';
        const cookiePathIsRoot = setCookie && setCookie.length > 0 && setCookie.every((c) => c.includes('Path=/'));
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          if (res.statusCode !== 200) reject(new Error('Login failed: ' + (data || res.statusCode)));
          else resolve({ cookie, data, cookiePathIsRoot });
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function main() {
  login()
    .then(({ cookie, cookiePathIsRoot }) => {
      if (!cookie) return fail('No cookie from login');
      console.log('Cookie Path in Set-Cookie:', cookiePathIsRoot ? '/' : 'not / (WS may fail without Path=/)');
      console.log('Connecting to', WS_URL, 'with session cookie...');
      const ws = new WebSocket(WS_URL, { headers: { Cookie: cookie } });
      let helloTimeout = null;
      let messageTimeout = null;
      let helloAckReceived = false;
      let messageAckReceived = false;

      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'HELLO', version: 1 }));
        helloTimeout = setTimeout(() => {
          if (ws.readyState !== WebSocket.CLOSED) ws.close();
          fail(`No HELLO_ACK within ${HELLO_ACK_TIMEOUT_MS}ms.`);
        }, HELLO_ACK_TIMEOUT_MS);
      });

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'HELLO_ACK') {
            if (helloTimeout) clearTimeout(helloTimeout);
            helloTimeout = null;
            helloAckReceived = true;
            console.log('HELLO_ACK received. WS smoke OK.');
            if (!RECIPIENT_ID) {
              ws.close();
              process.exit(0);
            }
            const clientMessageId = `smoke_${Date.now()}`;
            ws.send(JSON.stringify({
              type: 'MESSAGE_SEND',
              recipientId: RECIPIENT_ID,
              content: 'ws_smoke test',
              clientMessageId,
            }));
            messageTimeout = setTimeout(() => {
              if (ws.readyState !== WebSocket.CLOSED) ws.close();
              fail(`No MESSAGE_ACK within ${MESSAGE_ACK_TIMEOUT_MS}ms.`);
            }, MESSAGE_ACK_TIMEOUT_MS);
            return;
          }
          if (msg.type === 'MESSAGE_ACK' && messageTimeout) {
            clearTimeout(messageTimeout);
            messageTimeout = null;
            messageAckReceived = true;
            console.log('MESSAGE_ACK received. Send smoke OK.');
            ws.close();
            process.exit(0);
          }
        } catch (_) {}
      });

      ws.on('error', (err) => {
        if (helloTimeout) clearTimeout(helloTimeout);
        if (messageTimeout) clearTimeout(messageTimeout);
        fail(`WebSocket error: ${err && err.message ? err.message : err}. Check PORT=${PORT} and backend.`);
      });

      ws.on('close', (code, reason) => {
        if (helloTimeout) clearTimeout(helloTimeout);
        if (messageTimeout) clearTimeout(messageTimeout);
        if (helloAckReceived && !RECIPIENT_ID) return;
        if (helloAckReceived && RECIPIENT_ID && messageAckReceived) return;
        if (code !== 1000 && code !== 1005) fail(`WebSocket closed code=${code} reason=${reason || 'none'}`);
      });
    })
    .catch((err) => fail(err.message || err));
}

main();
