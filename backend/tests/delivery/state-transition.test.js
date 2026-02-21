'use strict';

/**
 * Delivery state machine tests.
 * Valid transitions: PERSISTED → SENT, SENT → DELIVERED, DELIVERED → READ.
 * Invalid transitions must be rejected.
 */

const path = require('path');
const backendRoot = path.resolve(__dirname, '../..');
const deliveryService = require(path.join(backendRoot, 'services/delivery.service'));

const { DeliveryState, validateTransition, createDelivery, transitionState } = deliveryService;

function fail(msg) {
  console.error('FAIL:', msg);
  process.exit(1);
}

function run() {
  // Valid transitions (validator only)
  try {
    validateTransition(DeliveryState.PERSISTED, DeliveryState.SENT);
    validateTransition(DeliveryState.SENT, DeliveryState.DELIVERED);
    validateTransition(DeliveryState.DELIVERED, DeliveryState.READ);
  } catch (e) {
    fail('Valid transitions should not throw: ' + e.message);
  }

  // Invalid: skip state
  try {
    validateTransition(DeliveryState.PERSISTED, DeliveryState.DELIVERED);
    fail('PERSISTED → DELIVERED (skip) should throw');
  } catch (e) {
    if (e.code !== 'INVALID_DELIVERY_TRANSITION') fail('Expected INVALID_DELIVERY_TRANSITION: ' + e.code);
  }

  // Invalid: backward
  try {
    validateTransition(DeliveryState.DELIVERED, DeliveryState.SENT);
    fail('DELIVERED → SENT (backward) should throw');
  } catch (e) {
    if (e.code !== 'INVALID_DELIVERY_TRANSITION') fail('Expected INVALID_DELIVERY_TRANSITION: ' + e.code);
  }

  // Invalid: duplicate (READ → READ not allowed)
  try {
    validateTransition(DeliveryState.READ, DeliveryState.READ);
    fail('READ → READ should throw');
  } catch (e) {
    if (e.code !== 'INVALID_DELIVERY_TRANSITION') fail('Expected INVALID_DELIVERY_TRANSITION: ' + e.code);
  }

  // Create record and transition PERSISTED → SENT → DELIVERED → READ
  createDelivery('msg1', 'user1');
  let r = transitionState('msg1', 'user1', DeliveryState.SENT);
  if (!r.ok || r.record.state !== DeliveryState.SENT) fail('PERSISTED → SENT failed');
  r = transitionState('msg1', 'user1', DeliveryState.DELIVERED);
  if (!r.ok || r.record.state !== DeliveryState.DELIVERED) fail('SENT → DELIVERED failed');
  r = transitionState('msg1', 'user1', DeliveryState.READ);
  if (!r.ok || r.record.state !== DeliveryState.READ) fail('DELIVERED → READ failed');

  // Duplicate transition (READ → READ) via transitionState returns error
  r = transitionState('msg1', 'user1', DeliveryState.READ);
  if (r.ok) fail('Duplicate READ transition should return ok: false');
  if (r.code !== 'INVALID_DELIVERY_TRANSITION') fail('Expected INVALID_DELIVERY_TRANSITION: ' + r.code);

  console.log('PASS: Delivery state transition test');
  process.exit(0);
}

run();
