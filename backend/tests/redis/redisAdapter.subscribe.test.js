'use strict';

/**
 * Tests Redis adapter subscribe wiring: enforces node-redis v4 callback style.
 * MUST FAIL if adapter uses legacy .on('message') or wrong subscribe contract.
 * No real Redis required.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const redisAdapter = require('../../services/redisAdapter');

function createFakeSubClient() {
  const subscribeCalls = [];
  const channelCallbacks = new Map();

  const sub = {
    subscribe(channel, callback) {
      subscribeCalls.push({ channel, callback });
      channelCallbacks.set(channel, callback);
      return Promise.resolve();
    },
    unsubscribe(channel) {
      channelCallbacks.delete(channel);
      return Promise.resolve();
    },
    connect() {
      return Promise.resolve();
    },
    quit() {
      return Promise.resolve();
    },
  };
  sub.on = function () {
    throw new Error('Legacy .on() is not supported; use v4 subscribe(channel, callback)');
  };
  return { sub, subscribeCalls, channelCallbacks };
}

function createFakePubClient() {
  return {
    publish: () => Promise.resolve(1),
    connect: () => Promise.resolve(),
    quit: () => Promise.resolve(),
  };
}

describe('redisAdapter subscribe (v4 callback)', () => {
  test('subscribe uses v4 callback and delivers parsed message', async () => {
    redisAdapter.resetForTest();
    const { sub: fakeSub, subscribeCalls, channelCallbacks } = createFakeSubClient();
    let callCount = 0;
    const createClientOverride = () => {
      callCount++;
      return callCount === 1 ? createFakePubClient() : fakeSub;
    };

    await redisAdapter.initialize({ createClientOverride });
    const received = [];
    const handlerFn = (obj) => {
      received.push(obj);
    };
    await redisAdapter.subscribe('chat.message', handlerFn);

    assert.strictEqual(subscribeCalls.length, 1);
    assert.strictEqual(subscribeCalls[0].channel, 'chat.message');
    assert.strictEqual(typeof subscribeCalls[0].callback, 'function');

    const storedCb = channelCallbacks.get('chat.message');
    assert.ok(storedCb, 'listener should be stored per channel');

    storedCb('{"hello":"world"}', 'chat.message');
    assert.strictEqual(received.length, 1);
    assert.deepStrictEqual(received[0], { hello: 'world' });

    await redisAdapter.close().catch(() => {});
    redisAdapter.resetForTest();
  });

  test('invalid JSON does not call handler and does not throw', async () => {
    redisAdapter.resetForTest();
    const { sub: fakeSub, channelCallbacks } = createFakeSubClient();
    let callCount = 0;
    const createClientOverride = () => {
      callCount++;
      return callCount === 1 ? createFakePubClient() : fakeSub;
    };

    await redisAdapter.initialize({ createClientOverride });
    const received = [];
    const handlerFn = () => {
      received.push(1);
    };
    await redisAdapter.subscribe('chat.message', handlerFn);

    const storedCb = channelCallbacks.get('chat.message');
    assert.ok(storedCb);
    storedCb('{', 'chat.message');
    assert.strictEqual(received.length, 0);

    await redisAdapter.close().catch(() => {});
    redisAdapter.resetForTest();
  });
});
