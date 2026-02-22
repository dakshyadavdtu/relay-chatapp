'use strict';

/**
 * Router mutual-exclusivity: MESSAGE_SEND must not include room keys;
 * ROOM_MESSAGE must not include DM user keys. No Redis or server required.
 */

const path = require('path');
const backendRoot = path.resolve(__dirname, '..');
const { test, describe } = require('node:test');
const assert = require('node:assert');

const router = require(path.join(backendRoot, 'websocket/router'));
const connectionManager = require(path.join(backendRoot, 'websocket/connection/connectionManager'));

const TEST_USER = 'router-dm-room-reject-user';

function createMockSocket() {
  return {
    readyState: 1,
    isAlive: true,
    _socket: { remoteAddress: '127.0.0.1', remotePort: 54321 },
    on: () => {},
    once: () => {},
    ping: () => {},
    send: () => {},
  };
}

function noopSendResponse() {
  return () => {};
}

describe('router DM/ROOM mutual exclusivity', () => {
  test('MESSAGE_SEND with roomId is rejected with INVALID_PAYLOAD', async () => {
    const ws = createMockSocket();
    connectionManager.register(TEST_USER, ws);

    const result = await router.handleIncoming(ws, JSON.stringify({
      type: 'MESSAGE_SEND',
      recipientId: 'user-b',
      content: 'hi',
      roomId: 'room_1',
    }), noopSendResponse());

    connectionManager.removeConnection(ws);

    assert.strictEqual(result.policy, 'FAIL');
    assert.ok(result.response);
    assert.strictEqual(result.response.type, 'MESSAGE_ERROR');
    assert.strictEqual(result.response.code, 'INVALID_PAYLOAD');
  });

  test('ROOM_MESSAGE with recipientId is rejected with INVALID_PAYLOAD', async () => {
    const ws = createMockSocket();
    connectionManager.register(TEST_USER, ws);

    const result = await router.handleIncoming(ws, JSON.stringify({
      type: 'ROOM_MESSAGE',
      roomId: 'room_1',
      content: 'hi',
      recipientId: 'user-b',
    }), noopSendResponse());

    connectionManager.removeConnection(ws);

    assert.strictEqual(result.policy, 'FAIL');
    assert.ok(result.response);
    assert.strictEqual(result.response.type, 'MESSAGE_ERROR');
    assert.strictEqual(result.response.code, 'INVALID_PAYLOAD');
  });
});
