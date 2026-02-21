'use strict';

/**
 * Presence refresh-race tests: grace-window OFFLINE, reconnect cancels.
 * Run: node -r dotenv/config tests/presence/presence-refresh-race.test.js (from backend)
 *
 * Uses PRESENCE_OFFLINE_GRACE_MS=150 so timers are short.
 *
 * 1. Two sockets same user: close one => no offline (other still open)
 * 2. Refresh race: close old, register new within grace => no offline
 * 3. Final disconnect: close last socket => exactly one offline after grace
 */

process.env.PRESENCE_OFFLINE_GRACE_MS = '150';

const path = require('path');
const backendRoot = path.resolve(__dirname, '..', '..');

// Load connectionManager first so lifecycle/presence are fully initialized (avoid circular-dep)
const connectionManager = require(path.join(backendRoot, 'websocket/connection/connectionManager'));
const presence = require(path.join(backendRoot, 'websocket/connection/presence'));

const TEST_USER = 'presence-refresh-race-user';

let nextPort = 50000;

function fail(msg) {
  console.error('FAIL:', msg);
  process.exit(1);
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Mock socket that stores close handlers so we can fire close and drive
 * connectionManager's _attachCloseAndHeartbeat logic.
 */
function createSocket() {
  const handlers = { close: [] };
  const port = nextPort++;
  const ws = {
    readyState: 1,
    isAlive: true,
    _socket: { remoteAddress: '127.0.0.1', remotePort: port },
    once: (evt, cb) => {
      if (evt === 'close') handlers.close.push(cb);
    },
    on: () => {},
    ping: () => {},
    terminate: () => {
      ws.readyState = 3;
      for (const cb of handlers.close) cb(1001, Buffer.from(''));
    },
    close: (code = 1000, reason = '') => {
      ws.readyState = 3;
      const buf = Buffer.isBuffer(reason) ? reason : Buffer.from(String(reason));
      for (const cb of handlers.close) cb(code, buf);
    },
    send: (_d, cb) => { if (typeof cb === 'function') cb(); },
    __fireClose: (code = 1000, reason = '') => {
      for (const cb of handlers.close) cb(code, Buffer.from(String(reason)));
    },
  };
  return ws;
}

async function run() {
  const originalNotify = presence.notifyPresenceChange;
  const events = [];

  try {
    presence.notifyPresenceChange = (userId, newStatus, previousStatus) => {
      events.push({ userId, newStatus, previousStatus });
    };

    connectionManager.clear();

    // ─── TEST 1: Two sockets same user; close one => no offline ───
    const ws1 = createSocket();
    const ws2 = createSocket();
    connectionManager.register(TEST_USER, ws1);
    connectionManager.register(TEST_USER, ws2);

    events.length = 0;
    ws1.close(1000, '');
    await delay(250);

    const offline1 = events.filter((e) => e.newStatus === 'offline');
    if (offline1.length > 0) {
      fail('TEST 1: expected no offline event after closing one of two sockets, got ' + offline1.length);
    }
    console.log('PASS: Two sockets same user — close one, no offline');

    connectionManager.clear();
    events.length = 0;

    // ─── TEST 2: Refresh race — close old, register new within grace ───
    const oldWs = createSocket();
    connectionManager.register(TEST_USER, oldWs);
    events.length = 0;

    oldWs.close(1001, '');
    await delay(50);
    const newWs = createSocket();
    connectionManager.register(TEST_USER, newWs);
    await delay(250);

    const offline2 = events.filter((e) => e.newStatus === 'offline');
    if (offline2.length > 0) {
      fail('TEST 2: refresh race — expected no offline (reconnect within grace), got ' + offline2.length);
    }
    console.log('PASS: Refresh race — close old, register new within grace, no offline');

    // ─── TEST 3: Final disconnect — close last socket => one offline after grace ───
    events.length = 0;
    newWs.close(1000, '');
    await delay(250);

    const offline3 = events.filter((e) => e.newStatus === 'offline');
    if (offline3.length !== 1) {
      fail('TEST 3: expected exactly one offline after final disconnect, got ' + offline3.length);
    }
    console.log('PASS: Final disconnect — exactly one offline after grace');

    console.log('All presence-refresh-race tests passed');
    process.exit(0);
  } finally {
    presence.notifyPresenceChange = originalNotify;
    connectionManager.clear();
  }
}

run().catch((err) => {
  console.error('FAIL:', err.message);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('FAIL: unhandledRejection', reason);
  process.exit(1);
});
