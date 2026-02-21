'use strict';

/**
 * Presence / connection-manager invariants: two tabs, reconnect race.
 * Run: node tests/presence/connectionManager.presence.test.js (from backend)
 *
 * - Two tabs: conn1 + conn2 => online; close conn1 => still online; close conn2 => offline.
 * - Reconnect race: conn1, conn2 (reconnect), close conn1 => must stay online.
 */

const path = require('path');
const backendRoot = path.resolve(__dirname, '..', '..');

const connectionManager = require(path.join(backendRoot, 'websocket/connection/connectionManager'));
const sessionStore = require(path.join(backendRoot, 'websocket/state/sessionStore'));

const OPEN = 1;
const CLOSED = 3;
const TEST_USER = 'presence-test-user';
const SESSION_ID = 'sess-presence-1';

function fail(msg) {
  console.error('FAIL:', msg);
  process.exit(1);
}

function createMockSocket() {
  const listeners = {};
  const mock = {
    readyState: OPEN,
    _connectionKey: null,
    isAlive: true,
    on: (ev, fn) => { mock['on_' + ev] = fn; return mock; },
    once: (ev, fn) => { listeners[ev] = fn; return mock; },
    ping: () => {},
    terminate: () => { mock.readyState = CLOSED; },
    close: () => { mock.readyState = CLOSED; },
    send: (_data, cb) => { if (typeof cb === 'function') cb(); },
    emitClose: (code, reason) => {
      mock.readyState = CLOSED;
      if (listeners.close) listeners.close(code || 1005, reason || '');
    },
  };
  return mock;
}

function clearStores() {
  if (connectionManager.clear) connectionManager.clear();
}

async function run() {
  clearStores();

  // ─── Two tabs: open conn1, conn2 => online; close conn1 => still online; close conn2 => offline ───
  const ws1 = createMockSocket();
  const ws2 = createMockSocket();
  connectionManager.register(TEST_USER, ws1, SESSION_ID);
  connectionManager.register(TEST_USER, ws2, SESSION_ID);

  if (!connectionManager.isUserConnected(TEST_USER)) fail('Two tabs: should be online after open conn1+conn2');
  const count2 = connectionManager.getActiveConnectionCount(TEST_USER);
  if (count2 !== 2) fail('Two tabs: activeConnectionCount should be 2, got ' + count2);
  console.log('PASS: Two tabs — open conn1+conn2 => online, count=2');

  ws1.emitClose(1005, '');
  if (!connectionManager.isUserConnected(TEST_USER)) fail('Two tabs: should stay online after close conn1');
  const count1 = connectionManager.getActiveConnectionCount(TEST_USER);
  if (count1 !== 1) fail('Two tabs: after close conn1 activeConnectionCount should be 1, got ' + count1);
  console.log('PASS: Two tabs — close conn1 => still online, count=1');

  ws2.emitClose(1000, '');
  if (connectionManager.isUserConnected(TEST_USER)) fail('Two tabs: should be offline after close conn2');
  const count0 = connectionManager.getActiveConnectionCount(TEST_USER);
  if (count0 !== 0) fail('Two tabs: after close conn2 activeConnectionCount should be 0, got ' + count0);
  console.log('PASS: Two tabs — close conn2 => offline');

  clearStores();

  // ─── Reconnect race: conn1, conn2 (reconnect), close conn1 => must stay online ───
  const conn1 = createMockSocket();
  const conn2 = createMockSocket();
  connectionManager.register(TEST_USER, conn1, SESSION_ID);
  connectionManager.register(TEST_USER, conn2, SESSION_ID);

  conn1.emitClose(1005, '');
  if (!connectionManager.isUserConnected(TEST_USER)) fail('Reconnect race: must stay online after old socket (conn1) closes');
  const n = connectionManager.getActiveConnectionCount(TEST_USER);
  if (n !== 1) fail('Reconnect race: activeConnectionCount should be 1 after conn1 close, got ' + n);
  console.log('PASS: Reconnect race — close conn1 after conn2 open => stay online');

  clearStores();
  console.log('All presence/connectionManager tests passed.');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
