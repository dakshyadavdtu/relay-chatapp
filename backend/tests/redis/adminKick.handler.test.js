'use strict';

/**
 * Unit tests for admin.kick Redis bus subscriber handler.
 * Uses Node.js built-in test runner (node:test).
 * Run: node --test tests/redis/adminKick.handler.test.js
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { createOnAdminKick } = require('../../services/redisBusHandlers');

describe('admin.kick handler', () => {
  test('ignores self-origin', () => {
    const instanceId = 'A';
    const mockConnectionManager = {
      getSockets: () => {
        throw new Error('getSockets should not be called for self-origin');
      },
      remove: () => {
        throw new Error('remove should not be called for self-origin');
      },
      removeSession: () => {
        throw new Error('removeSession should not be called for self-origin');
      },
    };
    const mockLogger = {
      warn: () => {},
      info: () => {},
      error: () => {},
    };

    const handler = createOnAdminKick({
      instanceId,
      connectionManager: mockConnectionManager,
      logger: mockLogger,
    });

    const event = {
      type: 'admin.kick',
      originInstanceId: 'A',
      action: 'BAN',
      targetUserId: 'user-1',
      ts: Date.now(),
    };

    handler(event);
    assert.ok(true, 'handler returned without calling connectionManager methods');
  });

  test('BAN behavior matches local semantics', () => {
    const instanceId = 'A';
    const mockWs = {
      readyState: 1,
      send: () => {},
      close: () => {},
    };
    let sendCalled = false;
    let sendPayload = null;
    let closeCalled = false;
    let closeCode = null;
    let closeReason = null;
    let removeCalled = false;
    let removeUserId = null;

    mockWs.send = (payload) => {
      sendCalled = true;
      sendPayload = payload;
    };
    mockWs.close = (code, reason) => {
      closeCalled = true;
      closeCode = code;
      closeReason = reason;
    };

    const mockConnectionManager = {
      getSockets: (userId) => {
        assert.strictEqual(userId, 'user-1');
        return [mockWs];
      },
      remove: (userId) => {
        removeCalled = true;
        removeUserId = userId;
      },
    };
    const mockConfig = {
      PROTOCOL_VERSION: '1.0.0',
    };
    const mockLogger = {
      warn: () => {},
      info: () => {},
      error: () => {},
    };

    const handler = createOnAdminKick({
      instanceId,
      connectionManager: mockConnectionManager,
      config: mockConfig,
      logger: mockLogger,
    });

    const event = {
      type: 'admin.kick',
      originInstanceId: 'B',
      action: 'BAN',
      targetUserId: 'user-1',
      ts: Date.now(),
    };

    handler(event);

    assert.ok(sendCalled, 'send should be called');
    const parsedPayload = JSON.parse(sendPayload);
    assert.strictEqual(parsedPayload.type, 'ERROR');
    assert.strictEqual(parsedPayload.code, 'ACCOUNT_SUSPENDED');
    assert.strictEqual(parsedPayload.message, 'Account suspended');
    assert.strictEqual(parsedPayload.version, '1.0.0');

    assert.ok(closeCalled, 'close should be called');
    assert.strictEqual(closeCode, 4003);
    assert.strictEqual(closeReason, 'ACCOUNT_SUSPENDED');

    assert.ok(removeCalled, 'remove should be called');
    assert.strictEqual(removeUserId, 'user-1');
  });

  test('BAN skips send/close if socket not OPEN', () => {
    const instanceId = 'A';
    const mockWs = {
      readyState: 0,
      send: () => {
        throw new Error('send should not be called when readyState != OPEN');
      },
      close: () => {
        throw new Error('close should not be called when readyState != OPEN');
      },
    };
    let removeCalled = false;

    const mockConnectionManager = {
      getSockets: () => [mockWs],
      remove: () => {
        removeCalled = true;
      },
    };
    const mockConfig = { PROTOCOL_VERSION: '1.0.0' };
    const mockLogger = {
      warn: () => {},
      info: () => {},
      error: () => {},
    };

    const handler = createOnAdminKick({
      instanceId,
      connectionManager: mockConnectionManager,
      config: mockConfig,
      logger: mockLogger,
    });

    handler({
      type: 'admin.kick',
      originInstanceId: 'B',
      action: 'BAN',
      targetUserId: 'user-1',
      ts: Date.now(),
    });

    assert.ok(removeCalled, 'remove should still be called even if socket not OPEN');
  });

  test('REVOKE_ALL calls connectionManager.remove only (not removeSession)', () => {
    const instanceId = 'A';
    let removeCalled = false;
    let removeUserId = null;
    let removeSessionCalled = false;

    const mockConnectionManager = {
      remove: (userId) => {
        removeCalled = true;
        removeUserId = userId;
      },
      removeSession: () => {
        removeSessionCalled = true;
      },
    };
    const mockLogger = {
      warn: () => {},
      info: () => {},
      error: () => {},
    };

    const handler = createOnAdminKick({
      instanceId,
      connectionManager: mockConnectionManager,
      logger: mockLogger,
    });

    handler({
      type: 'admin.kick',
      originInstanceId: 'B',
      action: 'REVOKE_ALL',
      targetUserId: 'user-1',
      ts: Date.now(),
    });

    assert.ok(removeCalled, 'remove should be called');
    assert.strictEqual(removeUserId, 'user-1');
    assert.ok(!removeSessionCalled, 'removeSession should not be called for REVOKE_ALL');
  });

  test('REVOKE_ONE calls connectionManager.removeSession', () => {
    const instanceId = 'A';
    let removeSessionCalled = false;
    let removeSessionId = null;

    const mockConnectionManager = {
      removeSession: (sessionId) => {
        removeSessionCalled = true;
        removeSessionId = sessionId;
      },
    };
    const mockLogger = {
      warn: () => {},
      info: () => {},
      error: () => {},
    };

    const handler = createOnAdminKick({
      instanceId,
      connectionManager: mockConnectionManager,
      logger: mockLogger,
    });

    handler({
      type: 'admin.kick',
      originInstanceId: 'B',
      action: 'REVOKE_ONE',
      targetUserId: 'user-1',
      targetSessionId: 'session-123',
      ts: Date.now(),
    });

    assert.ok(removeSessionCalled, 'removeSession should be called');
    assert.strictEqual(removeSessionId, 'session-123');
  });

  test('REVOKE_ONE without targetSessionId does nothing', () => {
    const instanceId = 'A';
    const mockConnectionManager = {
      removeSession: () => {
        throw new Error('removeSession should not be called when targetSessionId missing');
      },
    };
    let warnCalled = false;
    const mockLogger = {
      warn: () => {
        warnCalled = true;
      },
      info: () => {},
      error: () => {},
    };

    const handler = createOnAdminKick({
      instanceId,
      connectionManager: mockConnectionManager,
      logger: mockLogger,
    });

    handler({
      type: 'admin.kick',
      originInstanceId: 'B',
      action: 'REVOKE_ONE',
      targetUserId: 'user-1',
      ts: Date.now(),
    });

    assert.ok(warnCalled, 'warn should be called for invalid REVOKE_ONE');
  });
});
