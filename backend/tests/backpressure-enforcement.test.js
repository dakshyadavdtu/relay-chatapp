'use strict';

/**
 * Tier-1.2: Backpressure enforcement test — CI gate for Tier-1.2.
 * ENFORCED IN PHASE 7: Uses store public APIs only; no internal Maps/Sets.
 * Run: node backend/tests/backpressure-enforcement.test.js  (or node tests/backpressure-enforcement.test.js from backend)
 *
 * PROVES:
 * - sendOrFail returns ok:false when backpressure detected
 * - ws.send is NOT called when backpressure detected
 * - Message state becomes FAILED when send fails (if messageId exists)
 * - canSend returns false when backpressure detected
 *
 * On failure: process.exit(1). On success: process.exit(0).
 */

const path = require('path');
const backendRoot = path.resolve(__dirname, '..');

const socketSafety = require(path.join(backendRoot, 'websocket/safety/socketSafety'));
const dbAdapter = require(path.join(backendRoot, 'config/db'));
const config = require(path.join(backendRoot, 'config/constants'));

const TEST_MESSAGE_ID = 'backpressure-test-msg-1';
const TEST_USER = 'backpressure-test-user';

let wsSendCallCount = 0;
let wsSendCalled = false;

function fail(msg) {
  console.log('FAIL:', msg);
  process.exit(1);
}

function pass(msg) {
  console.log('PASS:', msg);
}

function createMockSocket(opts = {}) {
  const { simulateBackpressure = false, readyState = 1 } = opts;
  
  // Simulate backpressure by setting bufferedAmount high
  const mock = {
    readyState,
    bufferedAmount: simulateBackpressure ? config.BACKPRESSURE.bufferedAmountThreshold + 1 : 0,
    isAlive: true,
    _socket: {
      remoteAddress: '127.0.0.1',
      remotePort: 12345,
    },
    on: () => {},
    once: () => {},
    ping: () => {},
    terminate: () => { mock.readyState = 3; },
    close: () => { mock.readyState = 3; },
    send: (data, cb) => {
      wsSendCallCount++;
      wsSendCalled = true;
      if (typeof cb === 'function') cb();
    },
  };
  return mock;
}

function getConnectionId(ws) {
  if (!ws || !ws._socket) return null;
  const addr = ws._socket.remoteAddress;
  const port = ws._socket.remotePort;
  return addr && port ? `${addr}:${port}` : null;
}

async function run() {
  // Clean up any existing state
  if (dbAdapter.clearStore) await dbAdapter.clearStore();
  wsSendCallCount = 0;
  wsSendCalled = false;

  // ─── Test 1: canSend returns false when socket is not open ───
  console.log('\n=== Test 1: canSend with closed socket ===');
  
  const closedWs = createMockSocket({ readyState: 3 }); // CLOSED
  socketSafety.initSocket(closedWs);
  
  if (socketSafety.canSend(closedWs) !== false) {
    fail('canSend should return false for closed socket');
  }
  pass('canSend returns false for closed socket');

  // ─── Test 2: canSend returns false when bufferedAmount exceeds threshold ───
  console.log('\n=== Test 2: canSend with high bufferedAmount ===');
  
  const backpressureWs = createMockSocket({ simulateBackpressure: true });
  socketSafety.initSocket(backpressureWs);
  
  if (socketSafety.canSend(backpressureWs) !== false) {
    fail('canSend should return false when bufferedAmount exceeds threshold');
  }
  pass('canSend returns false when bufferedAmount exceeds threshold');

  // ─── Test 3: sendOrFail returns ok:false and does NOT call ws.send when backpressure ───
  console.log('\n=== Test 3: sendOrFail with backpressure ===');
  
  wsSendCallCount = 0;
  wsSendCalled = false;
  
  const backpressureWs2 = createMockSocket({ simulateBackpressure: true });
  socketSafety.initSocket(backpressureWs2);
  
  // Fill up pending sends
  for (let i = 0; i < config.BACKPRESSURE.threshold; i++) {
    socketSafety.incrementPendingSend(backpressureWs2);
  }
  
  const payload = { type: 'TEST_MESSAGE', content: 'test' };
  const result = await socketSafety.sendOrFail(backpressureWs2, payload, {
    messageId: null, // No messageId - transient message
    userId: TEST_USER,
    connectionId: getConnectionId(backpressureWs2),
  });
  
  if (result.ok !== false) {
    fail(`sendOrFail should return ok:false when backpressure detected, got ok:${result.ok}`);
  }
  if (result.reason !== 'BACKPRESSURE') {
    fail(`sendOrFail should return reason:'BACKPRESSURE', got reason:'${result.reason}'`);
  }
  if (wsSendCalled) {
    fail('ws.send should NOT be called when backpressure detected');
  }
  pass('sendOrFail returns ok:false and does NOT call ws.send when backpressure detected');

  // ─── Test 4: sendOrFail marks message as FAILED when messageId exists ───
  console.log('\n=== Test 4: sendOrFail marks message as FAILED ===');
  
  // Create a persisted message in DB
  await dbAdapter.persistMessage({
    messageId: TEST_MESSAGE_ID,
    senderId: 'sender-user',
    recipientId: TEST_USER,
    content: 'test message',
    timestamp: Date.now(),
    state: 'sent',
    messageType: 'direct',
    clientMessageId: TEST_MESSAGE_ID,
  });
  
  // Verify message exists and is in SENT state
  const dbMessageBefore = await dbAdapter.getMessage(TEST_MESSAGE_ID);
  if (!dbMessageBefore) {
    fail('Test message should exist in DB');
  }
  if (dbMessageBefore.state !== 'sent') {
    fail(`Test message should be in 'sent' state, got '${dbMessageBefore.state}'`);
  }
  
  wsSendCallCount = 0;
  wsSendCalled = false;
  
  const backpressureWs3 = createMockSocket({ simulateBackpressure: true });
  socketSafety.initSocket(backpressureWs3);
  
  const payload2 = { type: 'MESSAGE_RECEIVE', messageId: TEST_MESSAGE_ID, content: 'test' };
  const result2 = await socketSafety.sendOrFail(backpressureWs3, payload2, {
    messageId: TEST_MESSAGE_ID,
    userId: TEST_USER,
    connectionId: getConnectionId(backpressureWs3),
  });
  
  if (result2.ok !== false) {
    fail(`sendOrFail should return ok:false, got ok:${result2.ok}`);
  }
  if (result2.reason !== 'BACKPRESSURE') {
    fail(`sendOrFail should return reason:'BACKPRESSURE', got reason:'${result2.reason}'`);
  }
  if (wsSendCalled) {
    fail('ws.send should NOT be called when backpressure detected');
  }
  
  // Verify message state is now FAILED
  const dbMessageAfter = await dbAdapter.getMessage(TEST_MESSAGE_ID);
  if (!dbMessageAfter) {
    fail('Test message should still exist in DB after sendOrFail');
  }
  if (dbMessageAfter.state !== 'FAILED') {
    fail(`Message state should be 'FAILED' after sendOrFail failure, got '${dbMessageAfter.state}'`);
  }
  pass('sendOrFail marks message as FAILED when messageId exists and backpressure detected');

  // ─── Test 5: sendOrFail succeeds and calls ws.send when no backpressure ───
  console.log('\n=== Test 5: sendOrFail succeeds when no backpressure ===');
  
  wsSendCallCount = 0;
  wsSendCalled = false;
  
  const normalWs = createMockSocket({ simulateBackpressure: false });
  socketSafety.initSocket(normalWs);
  
  const payload3 = { type: 'TEST_MESSAGE', content: 'test' };
  const result3 = await socketSafety.sendOrFail(normalWs, payload3, {
    messageId: null,
    userId: TEST_USER,
    connectionId: getConnectionId(normalWs),
  });
  
  if (result3.ok !== true) {
    fail(`sendOrFail should return ok:true when no backpressure, got ok:${result3.ok}`);
  }
  if (!wsSendCalled) {
    fail('ws.send should be called when no backpressure');
  }
  if (wsSendCallCount !== 1) {
    fail(`ws.send should be called exactly once, got ${wsSendCallCount} calls`);
  }
  pass('sendOrFail succeeds and calls ws.send when no backpressure');

  // ─── Test 6: sendOrFail handles send exception and marks as FAILED ───
  console.log('\n=== Test 6: sendOrFail handles send exception ===');
  
  // Create another test message (unique clientMessageId to avoid unique index collision)
  const TEST_MESSAGE_ID_2 = 'backpressure-test-msg-2';
  await dbAdapter.persistMessage({
    messageId: TEST_MESSAGE_ID_2,
    senderId: 'sender-user',
    recipientId: TEST_USER,
    content: 'test message 2',
    timestamp: Date.now(),
    state: 'sent',
    messageType: 'direct',
    clientMessageId: TEST_MESSAGE_ID_2,
  });
  
  const exceptionWs = createMockSocket({ simulateBackpressure: false });
  socketSafety.initSocket(exceptionWs);
  
  // Override send to throw exception
  let originalSend = exceptionWs.send;
  exceptionWs.send = function() {
    throw new Error('Simulated send exception');
  };
  
  const payload4 = { type: 'MESSAGE_RECEIVE', messageId: TEST_MESSAGE_ID_2, content: 'test' };
  const result4 = await socketSafety.sendOrFail(exceptionWs, payload4, {
    messageId: TEST_MESSAGE_ID_2,
    userId: TEST_USER,
    connectionId: getConnectionId(exceptionWs),
  });
  
  if (result4.ok !== false) {
    fail(`sendOrFail should return ok:false when send throws, got ok:${result4.ok}`);
  }
  if (result4.reason !== 'send_exception') {
    fail(`sendOrFail should return reason:'send_exception', got reason:'${result4.reason}'`);
  }
  
  // Verify message state is FAILED
  const dbMessageException = await dbAdapter.getMessage(TEST_MESSAGE_ID_2);
  if (!dbMessageException) {
    fail('Test message should still exist in DB after send exception');
  }
  if (dbMessageException.state !== 'FAILED') {
    fail(`Message state should be 'FAILED' after send exception, got '${dbMessageException.state}'`);
  }
  pass('sendOrFail handles send exception and marks message as FAILED');

  // Cleanup
  socketSafety.cleanupSocket(closedWs);
  socketSafety.cleanupSocket(backpressureWs);
  socketSafety.cleanupSocket(backpressureWs2);
  socketSafety.cleanupSocket(backpressureWs3);
  socketSafety.cleanupSocket(normalWs);
  socketSafety.cleanupSocket(exceptionWs);

  console.log('\n✅ All tests passed!');
  process.exit(0);
}

// Run test
run().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
