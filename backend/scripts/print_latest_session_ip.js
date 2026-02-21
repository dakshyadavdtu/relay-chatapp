#!/usr/bin/env node
'use strict';

/**
 * Print raw and normalized IP for the latest session of a user.
 * Use for terminal verification that session IP is stored/returned normalized.
 *
 * Usage (from backend dir):
 *   node scripts/print_latest_session_ip.js --userId <userId>
 *   node scripts/print_latest_session_ip.js --email <email>
 *
 * Requires: DB_URI (and optionally DB_NAME) in env.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const mongoClient = require('../storage/mongo.client');
const { normalizeIp } = require('../utils/ip');

const COLLECTION = 'sessions';

function parseArgs() {
  const args = process.argv.slice(2);
  let userId = null;
  let email = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--userId' && args[i + 1]) {
      userId = args[i + 1].trim();
      i++;
    } else if (args[i] === '--email' && args[i + 1]) {
      email = args[i + 1].trim();
      i++;
    }
  }
  return { userId, email };
}

async function main() {
  const { userId: argUserId, email: argEmail } = parseArgs();
  let userId = argUserId;

  if (argEmail && !userId) {
    const userStore = require('../storage/user.store');
    const user = await userStore.findByEmail(argEmail);
    if (!user || !user.id) {
      console.error('No user found for email:', argEmail);
      process.exit(1);
    }
    userId = user.id;
    console.log('Resolved email to userId:', userId);
  }

  if (!userId) {
    console.error('Usage: node scripts/print_latest_session_ip.js --userId <id>');
    console.error('   or: node scripts/print_latest_session_ip.js --email <email>');
    process.exit(1);
  }

  const db = await mongoClient.getDb();
  const doc = await db.collection(COLLECTION)
    .findOne(
      { userId },
      { sort: { lastSeenAt: -1 }, projection: { sessionId: 1, ip: 1, lastSeenAt: 1 } }
    );

  if (!doc) {
    console.log('No session found for userId:', userId);
    await mongoClient.closeDb();
    process.exit(0);
  }

  const raw = doc.ip;
  const normalized = normalizeIp(raw);
  console.log('sessionId:', doc.sessionId);
  console.log('lastSeenAt:', doc.lastSeenAt);
  console.log('raw doc.ip:', raw === undefined ? '(undefined)' : JSON.stringify(raw));
  console.log('normalized:', normalized === null ? '(null)' : JSON.stringify(normalized));

  await mongoClient.closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
