#!/usr/bin/env node
'use strict';

/**
 * Edit/delete propagation smoke: two WS clients (A = sender, B = recipient).
 * A sends message -> A gets MESSAGE_ACK (messageId) -> A edits -> B receives MESSAGE_MUTATION edit
 * -> A deletes -> B receives MESSAGE_MUTATION delete.
 *
 * Env: SENDER_USER, SENDER_PASS, RECIPIENT_USER, RECIPIENT_PASS (or defaults).
 * Run: cd backend && PORT=8000 node scripts/ws-edit-delete-smoke.js
 */

const http = require('http');
const WebSocket = require('ws');

const PORT = process.env.PORT || '8000';
const BASE = `http://localhost:${PORT}`;
const WS_URL = `ws://localhost:${PORT}/ws`;
const HELLO_ACK_MS = 2000;
const STEP_MS = 3000;

const SENDER_USER = process.env.SENDER_USER || process.env.WS_SMOKE_USER || 'dev_admin';
const SENDER_PASS = process.env.SENDER_PASS || process.env.WS_SMOKE_PASS || 'dev_admin';
const RECIPIENT_USER = process.env.RECIPIENT_USER || 'dev_user';
const RECIPIENT_PASS = process.env.RECIPIENT_PASS || 'dev_user';

function fail(msg) {
  console.error('FAIL:', msg);
  process.exit(1);
}

function login(username, password) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ username, password });
    const req = http.request(
      BASE + '/api/login',
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': body.length } },
      (res) => {
        const setCookie = res.headers['set-cookie'];
        const cookie = setCookie ? setCookie.map((c) => c.split(';')[0]).join('; ') : '';
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(new Error('Login failed: ' + (data || res.statusCode)));
            return;
          }
          let parsed;
          try {
            parsed = JSON.parse(data);
          } catch (_) {
            reject(new Error('Login response not JSON'));
            return;
          }
          const user = parsed?.data?.user || parsed?.user;
          const userId = user?.id || user?.userId;
          resolve({ cookie, userId });
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function main() {
  Promise.all([
    login(SENDER_USER, SENDER_PASS),
    login(RECIPIENT_USER, RECIPIENT_PASS),
  ])
    .then(([sender, recipient]) => {
      if (!sender.cookie || !recipient.cookie) return fail('Missing cookie from login');
      if (!recipient.userId) return fail('Recipient login did not return userId');
      const recipientId = recipient.userId;
      console.log('Sender and recipient logged in. Recipient id:', recipientId);
      let senderWs;
      let recipientWs;
      let messageId = null;
      let editReceived = false;
      let deleteReceived = false;
      let completed = false;
      const done = (code) => {
        if (completed) return;
        completed = true;
        if (senderWs && senderWs.readyState === WebSocket.OPEN) senderWs.close();
        if (recipientWs && recipientWs.readyState === WebSocket.OPEN) recipientWs.close();
        process.exit(code);
      };

      const runSender = () => {
        senderWs = new WebSocket(WS_URL, { headers: { Cookie: sender.cookie } });
        senderWs.on('open', () => {
          senderWs.send(JSON.stringify({ type: 'HELLO', version: 1 }));
        });
        senderWs.on('message', (data) => {
          try {
            const msg = JSON.parse(data.toString());
            if (msg.type === 'HELLO_ACK') {
              senderReady = true;
              console.log('Sender HELLO_ACK.');
              const clientMsgId = `smoke_edit_${Date.now()}`;
              senderWs.send(JSON.stringify({
                type: 'MESSAGE_SEND',
                recipientId,
                content: 'ws-edit-delete-smoke original',
                clientMessageId: clientMsgId,
              }));
              return;
            }
            if (msg.type === 'MESSAGE_ACK' && msg.messageId) {
              messageId = msg.messageId;
              console.log('Sender MESSAGE_ACK messageId:', messageId);
              setTimeout(() => {
                senderWs.send(JSON.stringify({ type: 'MESSAGE_EDIT', messageId, content: 'ws-edit-delete-smoke edited' }));
              }, 200);
              return;
            }
            if (msg.type === 'MESSAGE_MUTATION_ACK' && msg.success === true && msg.action === 'edit') {
              setTimeout(() => {
                senderWs.send(JSON.stringify({ type: 'MESSAGE_DELETE', messageId }));
              }, 200);
              return;
            }
            if (msg.type === 'MESSAGE_MUTATION_ACK' && msg.success === true && msg.action === 'delete') {
              console.log('Sender received delete ACK.');
            }
          } catch (_) {}
        });
        senderWs.on('error', (err) => fail('Sender WS error: ' + (err && err.message)));
      };

      const runRecipient = () => {
        recipientWs = new WebSocket(WS_URL, { headers: { Cookie: recipient.cookie } });
        recipientWs.on('open', () => {
          recipientWs.send(JSON.stringify({ type: 'HELLO', version: 1 }));
        });
        recipientWs.on('message', (data) => {
          try {
            const msg = JSON.parse(data.toString());
            if (msg.type === 'HELLO_ACK') {
              recipientReady = true;
              console.log('Recipient HELLO_ACK.');
              return;
            }
            if (msg.type === 'MESSAGE_RECEIVE') {
              console.log('Recipient MESSAGE_RECEIVE.');
              return;
            }
            if (msg.type === 'MESSAGE_MUTATION' && msg.action === 'edit' && msg.messageId) {
              editReceived = true;
              console.log('Recipient MESSAGE_MUTATION edit received, messageId:', msg.messageId);
              if (msg.content !== 'ws-edit-delete-smoke edited') {
                fail('Edit mutation content mismatch: ' + msg.content);
              }
              return;
            }
            if (msg.type === 'MESSAGE_MUTATION' && msg.action === 'delete' && msg.messageId) {
              deleteReceived = true;
              console.log('Recipient MESSAGE_MUTATION delete received.');
              return;
            }
          } catch (_) {}
        });
        recipientWs.on('error', (err) => fail('Recipient WS error: ' + (err && err.message)));
      }

      runRecipient();
      setTimeout(runSender, 500);

      setTimeout(() => {
        if (completed) return;
        if (!messageId) fail('No MESSAGE_ACK messageId');
        if (!editReceived) fail('Recipient did not receive MESSAGE_MUTATION edit');
        if (!deleteReceived) fail('Recipient did not receive MESSAGE_MUTATION delete');
        console.log('Smoke OK: edit and delete propagated to B.');
        done(0);
      }, STEP_MS * 4);
    })
    .catch((err) => fail(err.message || err));
}

main();
