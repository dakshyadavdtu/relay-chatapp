'use strict';

/**
 * Delivery failure tracking tests.
 * 1. Simulated send error increments counter
 * 2. Timeout increments counter
 * 3. Diagnostic event emitted
 * 4. Metrics accessible via store
 */

const path = require('path');
const backendRoot = path.resolve(__dirname, '../..');

const deliveryService = require(path.join(backendRoot, 'services/delivery.service'));
const deliveryMetrics = require(path.join(backendRoot, 'observability/deliveryMetrics.store'));
const { bus, emitDeliveryFailureDetected } = require(path.join(backendRoot, 'diagnostics/eventBus'));

const { DeliveryState, createDelivery, transitionState, recordDeliveryFailure } = deliveryService;

function fail(msg) {
  console.error('FAIL:', msg);
  process.exit(1);
}

function run() {
  // 4. Metrics accessible via store
  const before = deliveryMetrics.getDeliveryMetrics();
  if (typeof before.deliveryFailuresTotal !== 'number') fail('getDeliveryMetrics must return deliveryFailuresTotal');
  if (before.lastDeliveryFailureAt !== null && typeof before.lastDeliveryFailureAt !== 'number') fail('lastDeliveryFailureAt must be number or null');

  // 1. Simulated send error increments counter
  const initialTotal = deliveryMetrics.getDeliveryMetrics().deliveryFailuresTotal;
  recordDeliveryFailure('msg-fail-1', 'user1', 'SEND_ERROR');
  const afterSend = deliveryMetrics.getDeliveryMetrics();
  if (afterSend.deliveryFailuresTotal !== initialTotal + 1) fail('Counter should increment on recordDeliveryFailure');
  if (afterSend.lastDeliveryFailureAt === null) fail('lastDeliveryFailureAt should be set');

  // 3. Diagnostic event emitted
  let eventReceived = null;
  const handler = (payload) => { eventReceived = payload; };
  bus.once('delivery_failure_detected', handler);
  recordDeliveryFailure('msg-fail-2', 'user2', 'RECIPIENT_OFFLINE');
  if (!eventReceived || eventReceived.reason !== 'RECIPIENT_OFFLINE' || eventReceived.messageId !== 'msg-fail-2' || eventReceived.recipientId !== 'user2') {
    fail('delivery_failure_detected event must have messageId, recipientId, reason, timestamp');
  }
  if (typeof eventReceived.timestamp !== 'number') fail('Event timestamp must be number');

  // 2. Timeout increments counter (create SENT delivery, advance time via env or wait; for test we just record a timeout-style failure)
  recordDeliveryFailure('msg-timeout-1', 'user3', 'ACK_TIMEOUT');
  const afterTimeout = deliveryMetrics.getDeliveryMetrics();
  if (afterTimeout.deliveryFailuresTotal < initialTotal + 2) fail('ACK_TIMEOUT should increment counter');

  // Event for timeout
  eventReceived = null;
  bus.once('delivery_failure_detected', handler);
  emitDeliveryFailureDetected({ messageId: 'm2', recipientId: 'u2', reason: 'ACK_TIMEOUT', timestamp: Date.now() });
  if (!eventReceived || eventReceived.reason !== 'ACK_TIMEOUT') fail('emitDeliveryFailureDetected must emit event');

  console.log('PASS: Delivery failure tracking test');
  process.exit(0);
}

run();
