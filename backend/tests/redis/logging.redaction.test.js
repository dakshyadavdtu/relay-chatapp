'use strict';

/**
 * Negative assurance: ensure logs do not include message content.
 * Uses Node.js built-in test runner (node:test).
 * Run: node --test tests/redis/logging.redaction.test.js
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { createOnChatMessage, createDedupe } = require('../../services/redisBusHandlers');

describe('logging redaction', () => {
  test('chat.message handler logs only IDs, never content', async () => {
    const instanceId = 'A';
    const loggedData = [];
    const mockLogger = {
      warn: (component, event, data) => {
        loggedData.push({ component, event, data });
      },
      info: (component, event, data) => {
        loggedData.push({ component, event, data });
      },
      error: (component, event, data) => {
        loggedData.push({ component, event, data });
      },
    };
    const mockConnectionManager = {
      getSockets: () => [{}],
    };
    const mockWsMessageService = {
      attemptDelivery: async () => {},
    };

    const handler = createOnChatMessage({
      instanceId,
      connectionManager: mockConnectionManager,
      wsMessageService: mockWsMessageService,
      logger: mockLogger,
      dedupe: createDedupe(),
    });

    const sensitiveContent = 'SECRET_MESSAGE_CONTENT_12345';
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
        content: sensitiveContent,
        timestamp: Date.now(),
        state: 'sent',
      },
    };

    await handler(event);

    const allLoggedStrings = JSON.stringify(loggedData);
    assert.ok(
      !allLoggedStrings.includes(sensitiveContent),
      `Logs should not contain message content. Found: ${sensitiveContent}`
    );
    assert.ok(
      allLoggedStrings.includes('msg-1'),
      'Logs should contain messageId'
    );
    assert.ok(
      allLoggedStrings.includes('user-b'),
      'Logs should contain recipientId'
    );
    assert.ok(
      allLoggedStrings.includes('B'),
      'Logs should contain originInstanceId'
    );
  });
});
