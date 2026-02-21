#!/usr/bin/env node
'use strict';

/**
 * Read-after-write search regression: send message then immediately search; assert found.
 * Run 50 times to catch replication/index lag flakes.
 *
 * Run: cd backend && node -r dotenv/config scripts/search-read-after-write.js
 * Requires: DB_URI (Mongo). Uses test users search_sender_A / search_sender_B.
 */

const path = require('path');
const backendRoot = path.resolve(__dirname, '..');

const dbAdapter = require(path.join(backendRoot, 'config/db'));
const messageService = require(path.join(backendRoot, 'services/message.service'));
const messageStore = require(path.join(backendRoot, 'services/message.store'));

const USER_A = 'search_sender_A';
const USER_B = 'search_sender_B';
const ITERATIONS = 50;

function fail(msg) {
  console.error('FAIL:', msg);
  process.exit(1);
}

function toDirectChatId(a, b) {
  const [x, y] = [String(a), String(b)].sort();
  return `direct:${x}:${y}`;
}

async function runOne(iter) {
  const ts = Date.now();
  const content = `zz_unique_${ts}_${iter}`;

  const intake = messageService.acceptIncomingMessage({
    senderId: USER_A,
    receiverId: USER_B,
    clientMessageId: `c_${ts}_${iter}`,
    content,
  });
  if (!intake.ok) fail(`acceptIncomingMessage failed: ${JSON.stringify(intake)}`);

  await messageService.persistAndReturnAck(intake.message, { correlationId: null });

  const chatId = toDirectChatId(USER_A, USER_B);
  const results = await messageStore.searchMessagesInChats([chatId], content, 20, {});

  const found = results && results.some((m) => m.messageId === intake.message.messageId || (m.preview && m.preview.includes(`zz_unique_${ts}`)));
  if (!found) {
    fail(`Iteration ${iter}: sent "${content}" but search returned ${results.length} results; messageId ${intake.message.messageId} not found.`);
  }
}

async function main() {
  console.log(`Running read-after-write search test ${ITERATIONS} times...`);
  for (let i = 0; i < ITERATIONS; i++) {
    await runOne(i);
    if ((i + 1) % 10 === 0) console.log(`  ${i + 1}/${ITERATIONS} OK`);
  }
  console.log(`PASS: Read-after-write search succeeded ${ITERATIONS} times.`);
  process.exit(0);
}

main().catch((err) => {
  console.error('FAIL:', err.message);
  process.exit(1);
});
