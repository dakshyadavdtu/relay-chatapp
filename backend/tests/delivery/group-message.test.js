'use strict';

/**
 * Group message test: message to N users creates N delivery records.
 */

const path = require('path');
const backendRoot = path.resolve(__dirname, '../..');
const deliveryService = require(path.join(backendRoot, 'services/delivery.service'));

const { createDeliveriesForRecipients, getDeliveriesForMessage, DeliveryState } = deliveryService;

function fail(msg) {
  console.error('FAIL:', msg);
  process.exit(1);
}

function run() {
  const messageId = 'msg-group-1';
  const recipientIds = ['user1', 'user2', 'user3'];

  const records = createDeliveriesForRecipients(messageId, recipientIds);
  if (records.length !== 3) fail('Expected 3 delivery records, got ' + records.length);

  for (const rec of records) {
    if (rec.messageId !== messageId) fail('record.messageId mismatch');
    if (!recipientIds.includes(rec.recipientId)) fail('record.recipientId not in list');
    if (rec.state !== DeliveryState.PERSISTED) fail('Initial state should be PERSISTED');
    if (!rec.persistedAt || typeof rec.persistedAt !== 'number') fail('persistedAt required');
  }

  const forMessage = getDeliveriesForMessage(messageId);
  if (forMessage.length !== 3) fail('getDeliveriesForMessage expected 3, got ' + forMessage.length);

  console.log('PASS: Group message delivery records test');
  process.exit(0);
}

run();
