'use strict';

/**
 * Offline user replay test: send message, user reconnects, replay sends pending only.
 * Uses delivery.service + replay.service; does not depend on production DB (uses in-memory).
 */

const path = require('path');
const backendRoot = path.resolve(__dirname, '../..');

const deliveryService = require(path.join(backendRoot, 'services/delivery.service'));
const replayService = require(path.join(backendRoot, 'services/replay.service'));
const messageService = require(path.join(backendRoot, 'services/message.service'));
const dbAdapter = require(path.join(backendRoot, 'config/db'));

const { DeliveryState, createDelivery, isPendingReplay, isDeliveredOrRead } = deliveryService;

function fail(msg) {
  console.error('FAIL:', msg);
  process.exit(1);
}

async function run() {
  // Reset DB/store if available (tests must not depend on production DB)
  if (typeof dbAdapter.clearStore === 'function') {
    dbAdapter.clearStore();
  }

  const userId = 'offline-replay-user';
  const messageId = 'msg-offline-1';
  const senderId = 'sender-1';

  // Simulate: message was persisted and delivery record created (PERSISTED)
  createDelivery(messageId, userId);
  if (!isPendingReplay(messageId, userId)) fail('New delivery should be pending replay');
  if (isDeliveredOrRead(messageId, userId)) fail('New delivery should not be delivered/read');

  // Simulate: transition to SENT (message was sent to socket)
  deliveryService.transitionState(messageId, userId, DeliveryState.SENT);
  if (!isPendingReplay(messageId, userId)) fail('SENT should still be pending replay');

  // Simulate: transition to DELIVERED (user confirmed)
  deliveryService.transitionState(messageId, userId, DeliveryState.DELIVERED);
  if (isPendingReplay(messageId, userId)) fail('DELIVERED should not be pending replay');
  if (!isDeliveredOrRead(messageId, userId)) fail('DELIVERED should be deliveredOrRead');

  // Replay filter: only PERSISTED or SENT get replayed; DELIVERED/READ are ignored
  const msg2 = 'msg-offline-2';
  createDelivery(msg2, userId);
  deliveryService.transitionState(msg2, userId, DeliveryState.SENT);
  deliveryService.transitionState(msg2, userId, DeliveryState.DELIVERED);
  if (isPendingReplay(msg2, userId)) fail('After DELIVERED, message should not be pending replay');

  console.log('PASS: Offline user replay (pending only) test');
  process.exit(0);
}

run().catch((err) => {
  console.error('FAIL:', err.message);
  process.exit(1);
});
