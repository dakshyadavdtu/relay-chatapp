'use strict';

/**
 * Unit tests for chat.message Redis bus subscriber handler.
 * Uses Node.js built-in test runner (node:test).
 * Run: node --test tests/redis/chatMessage.handler.test.js
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { createOnChatMessage, createDedupe } = require('../../services/redisBusHandlers');

describe('chat.message handler', () => {
  test('ignores self-origin', async () => {
    const instanceId = 'A';
    const mockConnectionManager = {
      getSockets: () => {
        throw new Error('getSockets should not be called for self-origin');
      },
    };
    const mockWsMessageService = {
      attemptDelivery: () => {
        throw new Error('attemptDelivery should not be called for self-origin');
      },
    };
    const mockLogger = {
      warn: () => {},
      info: () => {},
      error: () => {},
    };

    const handler = createOnChatMessage({
      instanceId,
      connectionManager: mockConnectionManager,
      wsMessageService: mockWsMessageService,
      logger: mockLogger,
    });

    const event = {
      type: 'chat.message',
      originInstanceId: 'A',
      messageId: 'msg-1',
      recipientId: 'user-b',
      senderId: 'user-a',
      ts: Date.now(),
      receivePayload: { type: 'MESSAGE_RECEIVE', messageId: 'msg-1', content: 'test' },
    };

    await handler(event);
    assert.ok(true, 'handler returned without calling getSockets or attemptDelivery');
  });

  test('drops malformed payload safely', async () => {
    const instanceId = 'A';
    let warnCalled = false;
    const mockLogger = {
      warn: () => {
        warnCalled = true;
      },
      info: () => {},
      error: () => {},
    };
    const mockConnectionManager = {
      getSockets: () => {
        throw new Error('getSockets should not be called for invalid payload');
      },
    };
    const mockWsMessageService = {
      attemptDelivery: () => {
        throw new Error('attemptDelivery should not be called for invalid payload');
      },
    };

    const handler = createOnChatMessage({
      instanceId,
      connectionManager: mockConnectionManager,
      wsMessageService: mockWsMessageService,
      logger: mockLogger,
    });

    const invalidEvents = [
      null,
      {},
      { originInstanceId: 'B' },
      { originInstanceId: 'B', messageId: 'msg-1' },
      { originInstanceId: 'B', messageId: 'msg-1', recipientId: 'user-b' },
      { originInstanceId: 'B', messageId: 'msg-1', recipientId: 'user-b', receivePayload: null },
    ];

    for (const invalidEvent of invalidEvents) {
      warnCalled = false;
      await handler(invalidEvent);
      assert.ok(warnCalled, `warn should be called for invalid event: ${JSON.stringify(invalidEvent)}`);
    }
  });

  test('no local sockets => no delivery', async () => {
    const instanceId = 'A';
    let getSocketsCalled = false;
    const mockConnectionManager = {
      getSockets: (userId) => {
        getSocketsCalled = true;
        assert.strictEqual(userId, 'user-b');
        return [];
      },
    };
    const mockWsMessageService = {
      attemptDelivery: () => {
        throw new Error('attemptDelivery should not be called when no sockets');
      },
    };
    const mockLogger = {
      warn: () => {},
      info: () => {},
      error: () => {},
    };

    const handler = createOnChatMessage({
      instanceId,
      connectionManager: mockConnectionManager,
      wsMessageService: mockWsMessageService,
      logger: mockLogger,
      dedupe: createDedupe(),
    });

    const event = {
      type: 'chat.message',
      originInstanceId: 'B',
      messageId: 'msg-1',
      recipientId: 'user-b',
      senderId: 'user-a',
      ts: Date.now(),
      receivePayload: {
        type: 'MESSAGE_RECEIVE',
        messageId: 'msg-1',
        senderId: 'user-a',
        recipientId: 'user-b',
        content: 'test',
        timestamp: Date.now(),
        state: 'sent',
      },
    };

    await handler(event);
    assert.ok(getSocketsCalled, 'getSockets should be called');
  });

  test('local sockets exist => attemptDelivery called once', async () => {
    const instanceId = 'A';
    const mockWs1 = { readyState: 1 };
    const mockWs2 = { readyState: 1 };
    const mockConnectionManager = {
      getSockets: (userId) => {
        assert.strictEqual(userId, 'user-b');
        return [mockWs1, mockWs2];
      },
    };
    let attemptDeliveryCalled = false;
    let attemptDeliveryArgs = null;
    const mockWsMessageService = {
      attemptDelivery: async (messageId, receivePayload, context) => {
        attemptDeliveryCalled = true;
        attemptDeliveryArgs = { messageId, receivePayload, context };
      },
    };
    const mockLogger = {
      warn: () => {},
      info: () => {},
      error: () => {},
    };

    const handler = createOnChatMessage({
      instanceId,
      connectionManager: mockConnectionManager,
      wsMessageService: mockWsMessageService,
      logger: mockLogger,
      dedupe: createDedupe(),
    });

    const receivePayload = {
      type: 'MESSAGE_RECEIVE',
      messageId: 'msg-1',
      senderId: 'user-a',
      recipientId: 'user-b',
      content: 'test',
      timestamp: Date.now(),
      state: 'sent',
    };
    const event = {
      type: 'chat.message',
      originInstanceId: 'B',
      messageId: 'msg-1',
      recipientId: 'user-b',
      senderId: 'user-a',
      ts: Date.now(),
      receivePayload,
    };

    await handler(event);
    assert.ok(attemptDeliveryCalled, 'attemptDelivery should be called');
    assert.strictEqual(attemptDeliveryArgs.messageId, 'msg-1');
    assert.strictEqual(attemptDeliveryArgs.receivePayload.type, 'MESSAGE_RECEIVE', 'receivePayload shape must not change');
    assert.deepStrictEqual(attemptDeliveryArgs.receivePayload, receivePayload);
    assert.ok(attemptDeliveryArgs.context.correlationId.startsWith('redis:'), 'correlationId should start with redis:');
  });

  test('dedupe prevents duplicate processing', async () => {
    const instanceId = 'A';
    const mockConnectionManager = {
      getSockets: () => [{}],
    };
    let attemptDeliveryCallCount = 0;
    const mockWsMessageService = {
      attemptDelivery: async () => {
        attemptDeliveryCallCount++;
      },
    };
    const mockLogger = {
      warn: () => {},
      info: () => {},
      error: () => {},
    };
    const dedupe = createDedupe();

    const handler = createOnChatMessage({
      instanceId,
      connectionManager: mockConnectionManager,
      wsMessageService: mockWsMessageService,
      logger: mockLogger,
      dedupe,
    });

    const event = {
      type: 'chat.message',
      originInstanceId: 'B',
      messageId: 'msg-dedup-1',
      recipientId: 'user-b',
      senderId: 'user-a',
      ts: Date.now(),
      receivePayload: {
        type: 'MESSAGE_RECEIVE',
        messageId: 'msg-dedup-1',
        senderId: 'user-a',
        recipientId: 'user-b',
        content: 'test',
        timestamp: Date.now(),
        state: 'sent',
      },
    };

    await handler(event);
    assert.strictEqual(attemptDeliveryCallCount, 1, 'first call should deliver');

    await handler(event);
    assert.strictEqual(attemptDeliveryCallCount, 1, 'second call with same messageId should be deduped');
  });
});
