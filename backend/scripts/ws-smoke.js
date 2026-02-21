#!/usr/bin/env node
'use strict';

/**
 * B1 smoke: login then connect to /ws with cookie, send HELLO, expect HELLO_ACK.
 * Requires backend running and a user (e.g. dev_admin when DEV_SEED_ADMIN=true).
 *
 * Run: cd backend && PORT=8000 node scripts/ws-smoke.js
 * Or: PORT=8000 node scripts/ws-smoke.js
 */

const http = require('http');
const WebSocket = require('ws');

const PORT = process.env.PORT || '8000';
const BASE = `http://localhost:${PORT}`;
const WS_URL = `ws://localhost:${PORT}/ws`;
const HELLO_ACK_TIMEOUT_MS = 3000;

function fail(msg) {
  console.error('FAIL:', msg);
  process.exit(1);
}

function login() {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ username: 'dev_admin', password: 'dev_admin' });
    const req = http.request(
      BASE + '/api/login',
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': body.length } },
      (res) => {
        const setCookie = res.headers['set-cookie'];
        const cookie = setCookie ? setCookie.map((c) => c.split(';')[0]).join('; ') : '';
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          if (res.statusCode !== 200) reject(new Error('Login failed: ' + (data || res.statusCode)));
          else resolve(cookie);
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
    .then((cookie) => {
      if (!cookie) return fail('No cookie from login');
      console.log('Connecting to', WS_URL, 'with session cookie...');
      const ws = new WebSocket(WS_URL, { headers: { Cookie: cookie } });
      let timeout = null;

      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'HELLO', version: 1 }));
        timeout = setTimeout(() => {
          if (ws.readyState !== WebSocket.CLOSED) ws.close();
          fail(`No HELLO_ACK within ${HELLO_ACK_TIMEOUT_MS}ms.`);
        }, HELLO_ACK_TIMEOUT_MS);
      });

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'HELLO_ACK') {
            if (timeout) clearTimeout(timeout);
            ws.close();
            console.log('HELLO_ACK received. B1 smoke OK.');
            process.exit(0);
          }
        } catch (_) {}
      });

      ws.on('error', (err) => {
        if (timeout) clearTimeout(timeout);
        fail(`WebSocket error: ${err && err.message ? err.message : err}. Check PORT=${PORT} and backend.`);
      });

      ws.on('close', (code, reason) => {
        if (timeout) clearTimeout(timeout);
        if (code !== 1000 && code !== 1005) fail(`WebSocket closed code=${code} reason=${reason || 'none'}`);
      });
    })
    .catch((err) => fail(err.message || err));
}

main();
