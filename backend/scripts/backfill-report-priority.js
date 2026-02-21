#!/usr/bin/env node
'use strict';

/**
 * One-time backfill: set priority = "normal" for all reports that have missing or invalid priority.
 * Run manually when needed:
 *
 *   node scripts/backfill-report-priority.js
 *
 * Requires: DB_URI (and optionally DB_NAME) in env.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const mongoClient = require('../storage/mongo.client');

const COLLECTION = 'reports';
const PRIORITY_DEFAULT = 'normal';
const VALID_PRIORITIES = ['low', 'normal', 'high'];

function needsBackfill(doc) {
  const p = doc.priority;
  if (p == null || typeof p !== 'string') return true;
  const v = p.trim().toLowerCase();
  return !VALID_PRIORITIES.includes(v);
}

async function main() {
  const db = await mongoClient.getDb();
  const cursor = db.collection(COLLECTION).find({});
  let updated = 0;
  let skipped = 0;

  for await (const doc of cursor) {
    if (!needsBackfill(doc)) {
      skipped++;
      continue;
    }
    await db.collection(COLLECTION).updateOne(
      { id: doc.id },
      { $set: { priority: PRIORITY_DEFAULT } }
    );
    updated++;
  }

  console.log(`Backfill report priority: updated ${updated}, skipped ${skipped}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
