#!/usr/bin/env node
'use strict';

/**
 * Print read cursor doc for (userId, chatId) from chat_read_cursors.
 * Use for terminal verification of persistent read cursor.
 *
 * Usage (from backend dir):
 *   node scripts/print_read_cursor.js --userId <id> --chatId <chatId>
 *
 * Example chatId: direct:user-uuid-1:user-uuid-2
 * Requires: DB_URI (and optionally DB_NAME) in env.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const readCursorStore = require('../chat/readCursorStore.mongo');

function parseArgs() {
  const args = process.argv.slice(2);
  let userId = null;
  let chatId = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--userId' && args[i + 1]) {
      userId = args[i + 1].trim();
      i++;
    } else if (args[i] === '--chatId' && args[i + 1]) {
      chatId = args[i + 1].trim();
      i++;
    }
  }
  return { userId, chatId };
}

async function main() {
  const { userId, chatId } = parseArgs();
  if (!userId || !chatId) {
    console.error('Usage: node scripts/print_read_cursor.js --userId <id> --chatId <chatId>');
    console.error('Example: node scripts/print_read_cursor.js --userId abc-123 --chatId direct:abc-123:def-456');
    process.exit(1);
  }

  const cursor = await readCursorStore.getCursor(userId, chatId);
  if (!cursor) {
    console.log('No cursor found for userId:', userId, 'chatId:', chatId);
    process.exit(0);
  }

  console.log('userId:', userId);
  console.log('chatId:', chatId);
  console.log('lastReadMessageId:', cursor.lastReadMessageId ?? '(null)');
  console.log('lastReadAt:', cursor.lastReadAt ?? '(null)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
