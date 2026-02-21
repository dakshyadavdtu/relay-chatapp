'use strict';

/**
 * Room delivery aggregate: completion only when all OTHER members marked delivered; sender excluded from totalCount.
 */

const path = require('path');
const backendRoot = path.resolve(__dirname, '../..');
const roomDeliveryStore = require(path.join(backendRoot, 'websocket/state/roomDeliveryStore'));

function fail(msg) {
  console.error('FAIL:', msg);
  process.exit(1);
}

function run() {
  const roomMessageId = 'rm_test_aggregate_1';
  const roomId = 'room-1';
  const senderId = 'user-sender';
  const memberA = 'user-a';
  const memberB = 'user-b';

  // totalCount = 2 (members excluding sender)
  const totalRecipients = 2;
  roomDeliveryStore.setTotal(roomMessageId, roomId, senderId, totalRecipients);

  let r = roomDeliveryStore.recordDelivery(roomMessageId, roomId, senderId, memberA);
  if (r.complete) fail('Expected not complete after only memberA delivered');
  if (r.deliveredCount !== 1 || r.totalCount !== 2) fail('Expected deliveredCount=1 totalCount=2, got ' + r.deliveredCount + '/' + r.totalCount);

  r = roomDeliveryStore.recordDelivery(roomMessageId, roomId, senderId, memberB);
  if (!r.complete) fail('Expected complete after both memberA and memberB delivered');
  if (r.deliveredCount !== 2 || r.totalCount !== 2) fail('Expected deliveredCount=2 totalCount=2, got ' + r.deliveredCount + '/' + r.totalCount);

  // Sender excluded: recording sender as "delivered" must not change deliveredCount
  r = roomDeliveryStore.recordDelivery(roomMessageId, roomId, senderId, senderId);
  if (r.deliveredCount !== 2) fail('Sender must be excluded: deliveredCount should still be 2, got ' + r.deliveredCount);

  // Idempotent: record memberA again
  r = roomDeliveryStore.recordDelivery(roomMessageId, roomId, senderId, memberA);
  if (r.deliveredCount !== 2 || !r.complete) fail('Idempotent record should not change count');

  console.log('PASS: Room delivery aggregate — completion only after all other members; sender excluded');
  process.exit(0);
}

run();
