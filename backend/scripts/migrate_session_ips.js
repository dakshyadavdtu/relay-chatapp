#!/usr/bin/env node
'use strict';

/**
 * One-time migration: normalize session IPs in the database.
 * Updates sessions where ip starts with "::", contains "::ffff:", or matches ipv4:port.
 * Does NOT run automatically — run manually when needed:
 *
 *   node scripts/migrate_session_ips.js
 *
 * Requires: DB_URI (and optionally DB_NAME) in env.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const mongoClient = require('../storage/mongo.client');
const { normalizeIp } = require('../utils/ip');

const COLLECTION = 'sessions';

function needsNormalization(ip) {
  if (ip == null || typeof ip !== 'string') return false;
  const s = ip.trim();
  if (!s) return false;
  if (s.startsWith('::')) return true;
  if (s.includes('::ffff:')) return true;
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d+$/.test(s)) return true;
  if (s === '::1') return true;
  return false;
}

async function main() {
  const db = await mongoClient.getDb();
  const cursor = db.collection(COLLECTION).find({});
  let updated = 0;
  let skipped = 0;

  for await (const doc of cursor) {
    const raw = doc.ip;
    if (!needsNormalization(raw)) {
      skipped++;
      continue;
    }
    const normalized = normalizeIp(raw);
    if (normalized === null || normalized === raw) {
      skipped++;
      continue;
    }
    await db.collection(COLLECTION).updateOne(
      { sessionId: doc.sessionId },
      { $set: { ip: normalized } }
    );
    updated++;
    console.log('Updated', doc.sessionId, ':', JSON.stringify(raw), '->', JSON.stringify(normalized));
  }

  console.log('Done. Updated:', updated, 'Skipped:', skipped);
  await mongoClient.closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
