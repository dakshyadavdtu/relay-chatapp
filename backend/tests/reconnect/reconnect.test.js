'use strict';

/**
 * Reconnect and session continuity tests.
 * Run: node tests/reconnect/reconnect.test.js (from backend)
 *
 * 1. Reconnect restores session
 * 2. Replay works after reconnect
 * 3. No duplicate sessions created
 * 4. Old socket cleaned safely (stale + delayed close)
 * 5. Auth failure emits diagnostic event
 */

const path = require('path');
const backendRoot = path.resolve(__dirname, '..', '..');

const connectionManager = require(path.join(backendRoot, 'websocket/connection/connectionManager'));
const sessionStore = require(path.join(backendRoot, 'websocket/state/sessionStore'));
const reconnectHandler = require(path.join(backendRoot, 'websocket/handlers/reconnect'));
const eventBus = require(path.join(backendRoot, 'diagnostics/eventBus'));

const TEST_USER = 'reconnect-test-user';

function fail(msg) {
  console.error('FAIL:', msg);
  process.exit(1);
}

function createMockSocket(opts = {}) {
  const mock = {
    readyState: 1,
    isAlive: true,
    on: () => mock,
    once: () => mock,
    ping: () => {},
    terminate: () => { mock.readyState = 3; },
    close: () => { mock.readyState = 3; },
    send: (_data, cb) => { if (typeof cb === 'function') cb(); },
  };
  return mock;
}

function clearStores() {
  if (connectionManager.clear) connectionManager.clear();
}

async function run() {
  clearStores();

  // ─── 1. Reconnect restores session ───
  const ws1 = createMockSocket();
  connectionManager.register(TEST_USER, ws1);
  let session = sessionStore.getSession(TEST_USER);
  if (!session || (session.primary !== ws1 && !(session.sockets && session.sockets.has(ws1)))) fail('Session should exist with ws1 after register');

  sessionStore.markOffline(TEST_USER, ws1);
  connectionManager.removeConnection(ws1);
  const ws2 = createMockSocket();
  connectionManager.register(TEST_USER, ws2);

  session = sessionStore.getSession(TEST_USER);
  if (!session) fail('Session should exist after reconnect');
  if (session.primary !== ws2 && !(session.sockets && session.sockets.has(ws2))) fail('Session socket should be ws2 after reconnect');
  if (connectionManager.getUserId(ws2) !== TEST_USER) fail('getUserId(ws2) should return TEST_USER');
  console.log('PASS: Reconnect restores session');

  clearStores();

  // ─── 2. Replay works after reconnect ───
  const dbAdapter = require(path.join(backendRoot, 'config/db'));
  const messageService = require(path.join(backendRoot, 'services/message.service'));
  const SENDER = 'replay-sender';
  const RECIPIENT = 'replay-recipient';
  if (dbAdapter.clearStore) await dbAdapter.clearStore();

  const senderWs = createMockSocket();
  const recipientWs1 = createMockSocket();
  connectionManager.register(SENDER, senderWs);
  connectionManager.register(RECIPIENT, recipientWs1);
  if (sessionStore.setProtocolVersion) {
    sessionStore.setProtocolVersion(SENDER, 1);
    sessionStore.setProtocolVersion(RECIPIENT, 1);
  }

  const intake = messageService.acceptIncomingMessage({
    senderId: SENDER,
    receiverId: RECIPIENT,
    clientMessageId: 'c1',
    content: 'hi',
  });
  if (!intake.ok) fail('acceptIncomingMessage failed');
  await messageService.persistAndReturnAck(intake.message);

  sessionStore.markOffline(RECIPIENT, recipientWs1);
  connectionManager.removeConnection(recipientWs1);
  const recipientWs2 = createMockSocket();
  connectionManager.register(RECIPIENT, recipientWs2);
  if (sessionStore.setProtocolVersion) sessionStore.setProtocolVersion(RECIPIENT, 1);

  const result = await reconnectHandler.handleMessageReplay(recipientWs2, { lastMessageId: null });
  if (result.type === 'MESSAGE_ERROR') fail('Replay should not return MESSAGE_ERROR: ' + JSON.stringify(result));
  if (result.messageCount < 1) fail('Replay should return at least 1 message, got ' + result.messageCount);
  console.log('PASS: Replay works after reconnect');

  clearStores();

  // ─── 3. No duplicate sessions created ───
  const wsA = createMockSocket();
  const wsB = createMockSocket();
  connectionManager.register(TEST_USER, wsA);
  connectionManager.register(TEST_USER, wsB);

  const userIdsAfter = sessionStore.getUserIds ? sessionStore.getUserIds() : [];
  const count = userIdsAfter.filter((id) => id === TEST_USER).length;
  if (count !== 1) fail('Expected exactly one session for user, got ' + count);

  session = sessionStore.getSession(TEST_USER);
  if (!session || (session.primary !== wsB && !(session.sockets && session.sockets.has(wsB)))) fail('Session should point to new socket wsB');
  console.log('PASS: No duplicate sessions created');

  clearStores();

  // ─── 4. Old socket evicted when over MAX_SOCKETS_PER_SESSION ───
  const config = require(path.join(backendRoot, 'config/constants'));
  const maxSockets = config.MAX_SOCKETS_PER_SESSION || 3;
  const sockets = [];
  for (let i = 0; i < maxSockets + 1; i++) sockets.push(createMockSocket());
  let closeCalled = false;
  sockets[0].close = (...args) => {
    closeCalled = true;
    sockets[0].readyState = 3;
  };
  for (let i = 0; i < maxSockets + 1; i++) connectionManager.register(TEST_USER, sockets[i]);
  if (!closeCalled) fail('Old socket should be evicted and closed when over MAX_SOCKETS_PER_SESSION');
  console.log('PASS: Old socket cleaned safely');

  clearStores();

  // ─── 5. Auth failure emits diagnostic event ───
  await new Promise((resolve) => {
    eventBus.once('reconnect_auth_failed', (payload) => {
      if (!payload || typeof payload.reason !== 'string') fail('Payload should have reason');
      if (payload.timestamp == null) fail('Payload should have timestamp');
      console.log('PASS: Auth failure emits diagnostic event');
      resolve();
    });
    eventBus.emitReconnectAuthFailed({
      reason: 'invalid_or_expired_token',
      socketId: 'test-socket-id',
      timestamp: Date.now(),
    });
  });

  console.log('All reconnect tests passed');
  process.exit(0);
}

run().catch((err) => {
  console.error('FAIL:', err.message);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('FAIL: unhandledRejection', reason);
  process.exit(1);
});
