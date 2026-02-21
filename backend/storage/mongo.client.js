'use strict';

/**
 * Central MongoDB connection for the process. All stores that need MongoDB MUST use
 * this client (getDb) so a single MongoClient is reused. Index creation stays in
 * each store; this module only exposes connection lifecycle.
 *
 * Env: DB_URI (required, validated at startup), DB_NAME default 'mychat'.
 */

const { MongoClient } = require('mongodb');

let client = null;
let db = null;

async function getDb() {
  if (db) return db;
  const uri = process.env.DB_URI;
  const name = process.env.DB_NAME || 'mychat';
  if (!uri || typeof uri !== 'string' || !uri.trim()) {
    throw new Error('DB_URI is required for MongoDB');
  }
  client = new MongoClient(uri.trim());
  await client.connect();
  db = client.db(name);
  return db;
}

async function closeDb() {
  if (client) {
    await client.close();
    client = null;
    db = null;
  }
}

module.exports = {
  getDb,
  closeDb,
};
