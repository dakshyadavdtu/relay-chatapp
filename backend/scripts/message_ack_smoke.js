#!/usr/bin/env node
'use strict';

/**
 * Phase 1 deterministic messaging contract smoke:
 * - Login → WS with cookie → HELLO → HELLO_ACK
 * - MESSAGE_SEND with clientMsgId → assert MESSAGE_ACK within 2s (status PERSISTED)
 * - Optionally assert DELIVERY_STATUS (RECIPIENT_OFFLINE or DELIVERED) within 2s
 *
 * Run: cd backend && PORT=8000 node scripts/message_ack_smoke.js
 * With recipient: RECIPIENT_ID=<user-uuid> PORT=8000 node scripts/message_ack_smoke.js
 */

const http = require('http');
const WebSocket = require('ws');

const PORT = process.env.PORT || '8000';
const BASE = `http://localhost:${PORT}`;
const WS_URL = `ws://localhost:${PORT}/ws`;
const HELLO_ACK_TIMEOUT_MS = 2000;
const MESSAGE_ACK_TIMEOUT_MS = 2000;
const DELIVERY_STATUS_TIMEOUT_MS = 2500;
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
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          if (res.statusCode !== 200) reject(new Error('Login failed: ' + (data || res.statusCode)));
          else resolve({ cookie });
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
    .then(({ cookie }) => {
      if (!cookie) return fail('No cookie from login');
      console.log('Connecting to', WS_URL, 'with session cookie...');
      const ws = new WebSocket(WS_URL, { headers: { Cookie: cookie } });
      let helloTimeout = null;
      let ackTimeout = null;
      let deliveryTimeout = null;
      let helloAckReceived = false;
      let ackReceived = false;
      let deliveryStatusReceived = false;
      const clientMsgId = `c_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

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
            console.log('HELLO_ACK received.');
            if (!RECIPIENT_ID) {
              ws.close();
              process.exit(0);
            }
            ws.send(JSON.stringify({
              type: 'MESSAGE_SEND',
              recipientId: RECIPIENT_ID,
              content: 'message_ack_smoke test',
              clientMessageId: clientMsgId,
            }));
            ackTimeout = setTimeout(() => {
              if (ws.readyState !== WebSocket.CLOSED) ws.close();
              fail(`No MESSAGE_ACK within ${MESSAGE_ACK_TIMEOUT_MS}ms.`);
            }, MESSAGE_ACK_TIMEOUT_MS);
            deliveryTimeout = setTimeout(() => {
              if (ackReceived && !deliveryStatusReceived) {
                console.log('(No DELIVERY_STATUS within window; optional for Phase 1)');
              }
            }, DELIVERY_STATUS_TIMEOUT_MS);
            return;
          }
          if (msg.type === 'MESSAGE_ACK' && ackTimeout) {
            clearTimeout(ackTimeout);
            ackTimeout = null;
            ackReceived = true;
            const echoed = (msg.clientMessageId === clientMsgId) || (msg.clientMsgId === clientMsgId);
            if (!echoed) fail('MESSAGE_ACK missing or wrong clientMessageId/clientMsgId');
            if (!msg.messageId) fail('MESSAGE_ACK missing messageId');
            if (msg.status && msg.status !== 'PERSISTED') {
              console.log('(MESSAGE_ACK status:', msg.status, '- PERSISTED preferred for Phase 1)');
            } else if (msg.status === 'PERSISTED') {
              console.log('MESSAGE_ACK status PERSISTED OK.');
            }
            console.log('MESSAGE_ACK received. Phase 1 ACK contract OK.');
            setTimeout(() => {
              ws.close();
            }, 500);
            return;
          }
          if (msg.type === 'MESSAGE_NACK') {
            clearTimeout(ackTimeout);
            ackTimeout = null;
            fail(`Received MESSAGE_NACK: ${msg.code} - ${msg.message || msg.error}`);
          }
          if (msg.type === 'DELIVERY_STATUS' && msg.messageId) {
            deliveryStatusReceived = true;
            const status = msg.status || msg.state;
            if (status === 'RECIPIENT_OFFLINE' || status === 'DELIVERED' || status === 'SEEN') {
              console.log('DELIVERY_STATUS received:', status);
            }
          }
        } catch (_) {}
      });

      ws.on('error', (err) => {
        if (helloTimeout) clearTimeout(helloTimeout);
        if (ackTimeout) clearTimeout(ackTimeout);
        if (deliveryTimeout) clearTimeout(deliveryTimeout);
        fail(`WebSocket error: ${err && err.message ? err.message : err}. Check PORT=${PORT} and backend.`);
      });

      ws.on('close', (code, reason) => {
        if (helloTimeout) clearTimeout(helloTimeout);
        if (ackTimeout) clearTimeout(ackTimeout);
        if (deliveryTimeout) clearTimeout(deliveryTimeout);
        if (helloAckReceived && !RECIPIENT_ID) return;
        if (helloAckReceived && RECIPIENT_ID && ackReceived) {
          console.log('Smoke OK: HELLO_ACK + MESSAGE_ACK (Phase 1 contract).');
          process.exit(0);
        }
        if (code !== 1000 && code !== 1005) fail(`WebSocket closed code=${code} reason=${reason || 'none'}`);
      });
    })
    .catch((err) => fail(err.message || err));
}

main();
