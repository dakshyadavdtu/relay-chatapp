#!/usr/bin/env node
'use strict';

/**
 * One-off migration: read backend/storage/_data/*.json (users, rooms) if present
 * and upsert into Atlas collections. Idempotent (upsert by id). Does NOT run on boot.
 * Run manually: node backend/scripts/migrate-local-json-to-atlas.js
 *
 * Reports and warnings were in-memory only in file stores; no JSON files to migrate.
 */

const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '..', 'storage', '_data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const ROOMS_FILE = path.join(DATA_DIR, 'rooms.json');

async function main() {
  require('../config/env');
  const mongoClient = require('../storage/mongo.client');
  const db = await mongoClient.getDb();
  const usersCol = db.collection('users');
  const roomsCol = db.collection('rooms');

  let migrated = 0;

  if (fs.existsSync(USERS_FILE)) {
    const raw = fs.readFileSync(USERS_FILE, 'utf8');
    let list;
    try {
      list = JSON.parse(raw);
    } catch (e) {
      console.error('Failed to parse users.json:', e.message);
      process.exit(1);
    }
    if (Array.isArray(list)) {
      for (const record of list) {
        if (!record || !record.id) continue;
        const usernameLower = (record.username || '').toLowerCase();
        const email = (record.email || '').trim();
        const emailLower = email ? email.toLowerCase() : null;
        const doc = {
          id: record.id,
          username: record.username,
          usernameLower,
          email: record.email ?? null,
          emailLower,
          passwordHash: record.passwordHash,
          role: record.role || 'USER',
          createdAt: record.createdAt,
          updatedAt: record.updatedAt ?? record.createdAt,
          bannedAt: record.bannedAt ?? null,
          displayName: record.displayName ?? null,
          avatarUrl: record.avatarUrl ?? null,
        };
        await usersCol.updateOne({ id: record.id }, { $set: doc }, { upsert: true });
        migrated++;
      }
      console.log('Migrated', list.length, 'users');
    }
  } else {
    console.log('No users.json found, skipping users');
  }

  if (fs.existsSync(ROOMS_FILE)) {
    const raw = fs.readFileSync(ROOMS_FILE, 'utf8');
    let list;
    try {
      list = JSON.parse(raw);
    } catch (e) {
      console.error('Failed to parse rooms.json:', e.message);
      process.exit(1);
    }
    if (Array.isArray(list)) {
      for (const record of list) {
        if (!record || !record.id) continue;
        const doc = {
          id: record.id,
          meta: record.meta ?? { name: '', thumbnailUrl: null, createdAt: 0, createdBy: '' },
          members: Array.isArray(record.members) ? record.members : [],
          roles: record.roles && typeof record.roles === 'object' ? record.roles : {},
          joinedAtByUser: record.joinedAtByUser && typeof record.joinedAtByUser === 'object' ? record.joinedAtByUser : {},
          version: typeof record.version === 'number' ? record.version : 1,
          updatedAt: typeof record.updatedAt === 'number' ? record.updatedAt : Date.now(),
        };
        await roomsCol.updateOne({ id: record.id }, { $set: doc }, { upsert: true });
        migrated++;
      }
      console.log('Migrated', list.length, 'rooms');
    }
  } else {
    console.log('No rooms.json found, skipping rooms');
  }

  await mongoClient.closeDb();
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
