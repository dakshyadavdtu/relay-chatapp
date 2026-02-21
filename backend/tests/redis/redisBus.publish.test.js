'use strict';

/**
 * Unit tests for redisBus publish wrappers (no real Redis).
 * Uses Node.js built-in test runner (node:test).
 * Run: node --test tests/redis/redisBus.publish.test.js
 *
 * Verifies: validation, channel names (chat.message / admin.kick), disabled/not-connected returns false.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const redisBus = require('../../services/redisBus');

function validChatMessageEvent() {
  return {
    type: 'chat.message',
    originInstanceId: 'A',
    messageId: 'msg-1',
    recipientId: 'user-b',
    senderId: 'user-a',
    ts: Date.now(),
    receivePayload: { type: 'MESSAGE_RECEIVE', messageId: 'msg-1' },
  };
}

function validAdminKickEvent(action = 'BAN', targetSessionId = undefined) {
  const e = {
    type: 'admin.kick',
    originInstanceId: 'A',
    action,
    targetUserId: 'user-1',
    ts: Date.now(),
  };
  if (targetSessionId != null) e.targetSessionId = targetSessionId;
  return e;
}

describe('redisBus publish wrappers', () => {
  test('publishChatMessage returns false for invalid event', async () => {
    const invalidEvents = [
      null,
      {},
      { type: 'wrong' },
      { type: 'chat.message' },
      { type: 'chat.message', originInstanceId: 'A' },
    ];

    for (const invalidEvent of invalidEvents) {
      const result = await redisBus.publishChatMessage(invalidEvent);
      assert.strictEqual(result, false, `should return false for invalid event: ${JSON.stringify(invalidEvent)}`);
    }
  });

  test('publishAdminKick returns false for invalid event', async () => {
    const invalidEvents = [
      null,
      {},
      { type: 'admin.kick' },
      { type: 'admin.kick', action: 'INVALID' },
      { type: 'admin.kick', action: 'REVOKE_ONE' },
    ];

    for (const invalidEvent of invalidEvents) {
      const result = await redisBus.publishAdminKick(invalidEvent);
      assert.strictEqual(result, false, `should return false for invalid event: ${JSON.stringify(invalidEvent)}`);
    }
  });

  test('publishChatMessage validates required fields', async () => {
    const validEvent = {
      type: 'chat.message',
      originInstanceId: 'A',
      messageId: 'msg-1',
      recipientId: 'user-b',
      senderId: 'user-a',
      ts: Date.now(),
      receivePayload: { type: 'MESSAGE_RECEIVE', messageId: 'msg-1' },
    };

    const result = await redisBus.publishChatMessage(validEvent);
    assert.ok(typeof result === 'boolean', 'should return boolean (false if bus disabled, true if published)');
  });

  test('publishAdminKick validates required fields', async () => {
    const validEvent = validAdminKickEvent();

    const result = await redisBus.publishAdminKick(validEvent);
    assert.ok(typeof result === 'boolean', 'should return boolean (false if bus disabled, true if published)');
  });

  test('publishChatMessage publishes to chat.message when connected', async () => {
    const publishCalls = [];
    const mockAdapter = {
      isConnected: () => true,
      publish: async (channel, payload) => {
        publishCalls.push({ channel, payload });
        return true;
      },
    };
    redisBus.__testables.setAdapter(mockAdapter);
    try {
      const event = validChatMessageEvent();
      const result = await redisBus.publishChatMessage(event);
      assert.strictEqual(result, true);
      assert.strictEqual(publishCalls.length, 1);
      assert.strictEqual(publishCalls[0].channel, 'chat.message');
      assert.strictEqual(publishCalls[0].payload, event);
    } finally {
      redisBus.__testables.resetAdapter();
    }
  });

  test('publishAdminKick publishes to admin.kick when connected', async () => {
    const publishCalls = [];
    const mockAdapter = {
      isConnected: () => true,
      publish: async (channel, payload) => {
        publishCalls.push({ channel, payload });
        return true;
      },
    };
    redisBus.__testables.setAdapter(mockAdapter);
    try {
      const event = validAdminKickEvent('REVOKE_ALL');
      const result = await redisBus.publishAdminKick(event);
      assert.strictEqual(result, true);
      assert.strictEqual(publishCalls.length, 1);
      assert.strictEqual(publishCalls[0].channel, 'admin.kick');
      assert.strictEqual(publishCalls[0].payload, event);
    } finally {
      redisBus.__testables.resetAdapter();
    }
  });

  test('when not connected, publish returns false and does not throw', async () => {
    const publishCalls = [];
    const mockAdapter = {
      isConnected: () => false,
      publish: async () => {
        publishCalls.push(1);
        return true;
      },
    };
    redisBus.__testables.setAdapter(mockAdapter);
    try {
      const resultChat = await redisBus.publishChatMessage(validChatMessageEvent());
      const resultKick = await redisBus.publishAdminKick(validAdminKickEvent());
      assert.strictEqual(resultChat, false);
      assert.strictEqual(resultKick, false);
      assert.strictEqual(publishCalls.length, 0);
    } finally {
      redisBus.__testables.resetAdapter();
    }
  });
});
