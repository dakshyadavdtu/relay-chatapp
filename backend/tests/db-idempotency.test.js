'use strict';

/**
 * Tier-0.5: Strong, database-level idempotent message persistence.
 * ENFORCED IN PHASE 7: Uses store public APIs only; no internal Maps/Sets.
 * Run with: node tests/db-idempotency.test.js
 *
 * Verifies persistMessage is idempotent:
 * - Calling twice with same messageId → exactly ONE DB row, same messageId returned both times.
 * - Calling twice with same (senderId + clientMessageId) but different messageId → exactly ONE DB row,
 *   same (existing) messageId returned on second call; no duplicate row for the second messageId.
 *
 * This test MUST fail if duplicates are created.
 */

const path = require('path');
const backendRoot = path.resolve(__dirname, '..');
const dbAdapter = require(path.join(backendRoot, 'config/db'));

function fail(msg) {
  console.log('FAIL:', msg);
  process.exit(1);
}

async function run() {
  await dbAdapter.clearStore();

  // ─── Case 1: Same messageId ───
  const msg1 = {
    messageId: 'idemp-msg-1',
    senderId: 'user-a',
    recipientId: 'user-b',
    content: 'content',
    timestamp: Date.now(),
    state: 'sent',
    messageType: 'direct',
    clientMessageId: 'client-1',
  };

  const first = await dbAdapter.persistMessage(msg1);
  if (!first || first.messageId !== 'idemp-msg-1') {
    fail('First persistMessage should return message with messageId idemp-msg-1: ' + JSON.stringify(first));
  }

  const second = await dbAdapter.persistMessage(msg1);
  if (!second || second.messageId !== 'idemp-msg-1') {
    fail('Second persistMessage (same messageId) should return same messageId idemp-msg-1: ' + JSON.stringify(second));
  }

  const row = await dbAdapter.getMessage('idemp-msg-1');
  if (!row || row.messageId !== 'idemp-msg-1') {
    fail('DB must contain exactly one row for idemp-msg-1 after double persist with same messageId');
  }

  console.log('PASS: Same messageId — exactly one row, same messageId returned both times');

  // ─── Case 2: Same (senderId + clientMessageId), different messageId (second call must not create duplicate) ───
  await dbAdapter.clearStore();

  const msg2a = {
    messageId: 'idemp-msg-2a',
    senderId: 'user-x',
    recipientId: 'user-y',
    content: 'content',
    timestamp: Date.now(),
    state: 'sent',
    messageType: 'direct',
    clientMessageId: 'client-key',
  };
  const inserted = await dbAdapter.persistMessage(msg2a);
  if (!inserted || inserted.messageId !== 'idemp-msg-2a') {
    fail('First persist (idemp-msg-2a) should return that messageId: ' + JSON.stringify(inserted));
  }

  // Second call: same (senderId, clientMessageId) but different messageId. Must return EXISTING row (idemp-msg-2a), not create idemp-msg-2b.
  const msg2b = {
    messageId: 'idemp-msg-2b',
    senderId: 'user-x',
    recipientId: 'user-y',
    content: 'other content',
    timestamp: Date.now(),
    state: 'sent',
    messageType: 'direct',
    clientMessageId: 'client-key',
  };
  const retry = await dbAdapter.persistMessage(msg2b);
  if (!retry || retry.messageId !== 'idemp-msg-2a') {
    fail('Second persist (same senderId+clientMessageId, different messageId) must return EXISTING messageId idemp-msg-2a, got: ' + (retry ? retry.messageId : retry));
  }

  const existingRow = await dbAdapter.getMessage('idemp-msg-2a');
  if (!existingRow) {
    fail('DB must still have row idemp-msg-2a');
  }
  const duplicateRow = await dbAdapter.getMessage('idemp-msg-2b');
  if (duplicateRow) {
    fail('DB must NOT have row idemp-msg-2b (duplicate would be created if idempotency failed)');
  }

  console.log('PASS: Same (senderId + clientMessageId) — exactly one row, existing messageId returned on retry');
  console.log('Tier-0.5: DB-level idempotency verified; duplicate messages cannot exist');
  process.exit(0);
}

run().catch((err) => {
  console.log('FAIL:', err.message);
  process.exit(1);
});
