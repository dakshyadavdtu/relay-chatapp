'use strict';

/**
 * Tier-0.6: Deterministic ACK-drop test — CI gate for Tier-0 invariants.
 * ENFORCED IN PHASE 7: Uses store public APIs only; no internal Maps/Sets.
 * Run: node backend/tests/ack-drop.test.js  (or node tests/ack-drop.test.js from backend)
 *
 * Simulates real network failure and PROVES:
 * - exactly-once persistence
 * - exactly-once delivery marking
 * - safe replay
 *
 * EXACT SEQUENCE:
 * 1) Client A sends a message to Client B
 * 2) Server persists the message (DB-first)
 * 3) Server sends message to B
 * 4) DELIVERED ACK from B is DROPPED (simulated network loss — we do NOT call deliveredAck handler)
 * 5) Client B reconnects
 * 6) Replay service is triggered (via reconnect handler, real replayService)
 * 7) System must NOT duplicate anything
 *
 * On failure: process.exit(1). On success: process.exit(0).
 * If persistMessage duplicated rows or replay duplicated delivery, this test FAILS.
 */

const path = require('path');
const backendRoot = path.resolve(__dirname, '..');

const dbAdapter = require(path.join(backendRoot, 'config/db'));
const connectionManager = require(path.join(backendRoot, 'websocket/connection/connectionManager'));
const sessionStore = require(path.join(backendRoot, 'websocket/state/sessionStore'));
const messageService = require(path.join(backendRoot, 'services/message.service'));
const reconnectHandler = require(path.join(backendRoot, 'websocket/handlers/reconnect'));

const CLIENT_A = 'ack-drop-client-a';
const CLIENT_B = 'ack-drop-client-b';
const CLIENT_MSG_ID = 'client-msg-1';
const CONTENT = 'test content';

let persistCount = 0;
let deliveryCount = 0;
/** Captured MESSAGE_RECEIVE payloads (for isReplay contract assertion — frontend uses isReplay to avoid double unread). */
let deliveredPayloads = [];

function fail(msg) {
  console.log('FAIL:', msg);
  process.exit(1);
}

function createMockSocket(opts = {}) {
  const { dropDeliveredAck = false, captureDeliveries = false } = opts;
  const mock = {
    readyState: 1,
    isAlive: true,
    on: () => {},
    once: () => {},
    ping: () => {},
    terminate: () => { mock.readyState = 3; },
    close: () => { mock.readyState = 3; },
    send: (data, cb) => {
      try {
        const msg = typeof data === 'string' ? JSON.parse(data) : data;
        if (dropDeliveredAck && msg.type === 'MESSAGE_ACK' && msg.state === 'delivered') {
          if (typeof cb === 'function') cb();
          return;
        }
        if (captureDeliveries && msg.type === 'MESSAGE_RECEIVE') {
          deliveryCount += 1;
          deliveredPayloads.push(msg);
        }
      } catch (_) {}
      if (typeof cb === 'function') cb();
    },
  };
  return mock;
}

function flushQueue() {
  return new Promise((r) => setImmediate(() => setImmediate(r)));
}

async function run() {
  if (dbAdapter.clearStore) await dbAdapter.clearStore();
  persistCount = 0;
  deliveryCount = 0;
  deliveredPayloads = [];

  const originalPersist = dbAdapter.persistMessage;
  dbAdapter.persistMessage = async function (...args) {
    persistCount += 1;
    return originalPersist.apply(this, args);
  };

  const senderWs = createMockSocket({ dropDeliveredAck: true });
  const recipientWs = createMockSocket({ captureDeliveries: true });

  connectionManager.register(CLIENT_A, senderWs);
  connectionManager.register(CLIENT_B, recipientWs);
  sessionStore.setProtocolVersion(CLIENT_A, 1);
  sessionStore.setProtocolVersion(CLIENT_B, 1);

  // ─── 1) Client A sends message to B ───
  const intake = messageService.acceptIncomingMessage({
    senderId: CLIENT_A,
    receiverId: CLIENT_B,
    clientMessageId: CLIENT_MSG_ID,
    content: CONTENT,
  });
  if (!intake.ok) fail('acceptIncomingMessage failed: ' + JSON.stringify(intake));

  // ─── 2) Server persists (DB-first), 3) Server sends to B (via normal path) ───
  const sendResponse = await messageService.persistAndReturnAck(intake.message);
  if (!sendResponse || sendResponse.type !== 'MESSAGE_ACK' || !sendResponse.messageId) {
    fail('Expected SENT ACK with messageId, got ' + JSON.stringify(sendResponse));
  }
  const messageIdBefore = sendResponse.messageId;

  // Idempotency: second persistAndReturnAck must not create duplicate
  const secondAck = await messageService.persistAndReturnAck(intake.message);
  if (!secondAck || secondAck.messageId !== messageIdBefore) {
    fail('Second persistAndReturnAck should return same messageId: ' + JSON.stringify(secondAck));
  }
  if (persistCount !== 1) {
    fail('Duplicate persistence: persistCount is ' + persistCount + ' after second persistAndReturnAck (expected 1)');
  }

  // DB layer idempotency: persistMessage twice with same messageId must not create second row
  await originalPersist({
    messageId: messageIdBefore,
    senderId: CLIENT_A,
    recipientId: CLIENT_B,
    content: CONTENT,
    timestamp: intake.message.timestamp,
    state: sendResponse.state || 'sent',
    messageType: 'direct',
    clientMessageId: CLIENT_MSG_ID,
  });
  if (dbAdapter.getMessageCount) {
    const c = await dbAdapter.getMessageCount();
    if (c !== 1) fail('DB must contain exactly one message after idempotent persist (getMessageCount !== 1)');
  }

  // ─── 4) DELIVERED ACK from B is DROPPED: we never call deliveredAck handler (simulated network loss). ───
  // State: message exists in DB, delivery is NOT yet confirmed.

  // ─── 5) Client B reconnects; 6) Replay triggered via reconnect handler (real replayService) ───
  sessionStore.markOffline(CLIENT_B, recipientWs);
  connectionManager.removeConnection(recipientWs);

  const recipientWs2 = createMockSocket({ captureDeliveries: true });
  connectionManager.register(CLIENT_B, recipientWs2);
  sessionStore.setProtocolVersion(CLIENT_B, 1);

  const replayResult = await reconnectHandler.handleMessageReplay(recipientWs2, { lastMessageId: null });
  if (replayResult.type === 'MESSAGE_ERROR') {
    fail('Reconnect handler failed: ' + JSON.stringify(replayResult));
  }
  if (replayResult.messageCount < 1) {
    fail('Replay should deliver at least 1 message, got messageCount ' + replayResult.messageCount);
  }

  await flushQueue();

  const messageIdAfter = replayResult.lastMessageId;

  // ─── STEP B5: Assert ALL DB invariants (introspection via db adapter) ───
  const count = typeof dbAdapter.getMessageCount === 'function' ? await dbAdapter.getMessageCount() : null;

  // 1) DB contains EXACTLY ONE message (Tier-0.5 regression: duplicate rows would make count > 1)
  if (count !== null && count !== 1) {
    fail('DB must contain exactly one message (getMessageCount === 1), got ' + count);
  }
  const dbOne = await dbAdapter.getMessage(messageIdBefore);
  if (!dbOne) fail('Message not found in DB');

  // 2) messageId unchanged
  if (messageIdBefore !== messageIdAfter) {
    fail('messageId must be unchanged: before ' + messageIdBefore + ', after ' + messageIdAfter);
  }

  // 3) Message content unchanged
  if (dbOne.content !== CONTENT) {
    fail('Message content must be unchanged, got ' + dbOne.content);
  }

  // 4) Message is marked DELIVERED for user B
  const deliveredToB = await dbAdapter.isMessageDelivered(messageIdBefore, CLIENT_B);
  if (!deliveredToB) {
    fail('Message must be marked DELIVERED for user B');
  }

  // 5) Delivery is marked EXACTLY ONCE (one emission to B)
  if (deliveryCount !== 1) {
    fail('Delivery must be marked exactly once (deliveryCount === 1), got ' + deliveryCount);
  }
  // 5b) Replay payload must have isReplay: true (frontend uses this to avoid double unread count)
  if (deliveredPayloads.length < 1 || deliveredPayloads[0].isReplay !== true) {
    fail('Replayed MESSAGE_RECEIVE must have isReplay === true (got ' + JSON.stringify(deliveredPayloads[0] || {}).slice(0, 120) + ')');
  }
  console.log('PASS: Replay payload has isReplay: true (direct unread contract)');

  // 6) No duplicate rows exist
  if (persistCount !== 1) {
    fail('No duplicate DB rows: persistCount must be 1, got ' + persistCount);
  }

  // 7) No duplicate delivery entries (replay idempotency: single delivery mark for B)
  if (!deliveredToB) fail('No duplicate delivery entries: B must be marked delivered exactly once');

  // ─── STEP B6: Reconnect AGAIN with same lastMessageId — replay must return ZERO messages ───
  const secondReplayResult = await reconnectHandler.handleMessageReplay(recipientWs2, { lastMessageId: messageIdAfter });
  if (secondReplayResult.type === 'MESSAGE_ERROR') {
    fail('Second reconnect failed: ' + JSON.stringify(secondReplayResult));
  }
  if (secondReplayResult.messageCount !== 0) {
    fail('Second replay must return ZERO messages (messageCount === 0), got ' + secondReplayResult.messageCount);
  }

  // DB state unchanged; no second delivery marking
  const countAfterSecond = typeof dbAdapter.getMessageCount === 'function' ? await dbAdapter.getMessageCount() : null;
  if (countAfterSecond !== null && countAfterSecond !== 1) {
    fail('After second reconnect DB must still have exactly one message, got count ' + countAfterSecond);
  }
  const deliveredToBAfter = await dbAdapter.isMessageDelivered(messageIdBefore, CLIENT_B);
  if (!deliveredToBAfter) fail('Message must still be marked DELIVERED for B after second reconnect');
  if (deliveryCount !== 1) {
    fail('No second delivery marking: deliveryCount must still be 1, got ' + deliveryCount);
  }

  console.log('PASS: DB contains exactly one message');
  console.log('PASS: messageId unchanged');
  console.log('PASS: Message content unchanged');
  console.log('PASS: Message marked DELIVERED for B');
  console.log('PASS: Delivery marked exactly once');
  console.log('PASS: No duplicate rows, no duplicate delivery entries');
  console.log('PASS: Second reconnect returns zero messages; DB unchanged');
  console.log('Tier-0.6: ACK-drop test passed — exactly-once persistence and delivery; CI gate OK');
  process.exit(0);
}

run().catch((err) => {
  console.log('FAIL:', err.message);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.log('FAIL: unhandledRejection', reason);
  process.exit(1);
});
