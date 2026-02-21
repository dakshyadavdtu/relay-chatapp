'use strict';

/**
 * Delivered state persistence test: state stored correctly after update.
 */

const path = require('path');
const backendRoot = path.resolve(__dirname, '../..');
const deliveryService = require(path.join(backendRoot, 'services/delivery.service'));

const { createDelivery, transitionState, getDelivery, getDeliveryState, DeliveryState } = deliveryService;

function fail(msg) {
  console.error('FAIL:', msg);
  process.exit(1);
}

function run() {
  createDelivery('msg-persist', 'recipient1');
  const r = transitionState('msg-persist', 'recipient1', DeliveryState.SENT);
  if (!r.ok) fail('SENT transition failed');

  const state = getDeliveryState('msg-persist', 'recipient1');
  if (state !== DeliveryState.SENT) fail('State should be SENT, got ' + state);

  const record = getDelivery('msg-persist', 'recipient1');
  if (!record) fail('Record not found');
  if (record.state !== DeliveryState.SENT) fail('Record.state should be SENT');
  if (!record.sentAt || typeof record.sentAt !== 'number') fail('sentAt should be set');

  transitionState('msg-persist', 'recipient1', DeliveryState.DELIVERED);
  const record2 = getDelivery('msg-persist', 'recipient1');
  if (record2.state !== DeliveryState.DELIVERED) fail('State should be DELIVERED after transition');
  if (!record2.deliveredAt) fail('deliveredAt should be set');

  console.log('PASS: Delivered state persistence test');
  process.exit(0);
}

run();
