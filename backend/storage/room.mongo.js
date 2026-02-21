'use strict';

/**
 * Room storage layer — MongoDB. Same public API as room.store.js (async).
 * Collection: rooms.
 */

const mongoClient = require('./mongo.client');

const COLLECTION = 'rooms';
let indexesEnsured = false;

async function getDb() {
  const db = await mongoClient.getDb();
  if (!indexesEnsured) {
    const col = db.collection(COLLECTION);
    await col.createIndex({ id: 1 }, { unique: true });
    await col.createIndex({ updatedAt: -1 });
    indexesEnsured = true;
  }
  return db;
}

function docToRecord(doc) {
  if (!doc) return null;
  const { _id, ...rest } = doc;
  return { ...rest };
}

async function getRoom(roomId) {
  if (!roomId || typeof roomId !== 'string') return null;
  const db = await getDb();
  const doc = await db.collection(COLLECTION).findOne({ id: roomId.trim() });
  return doc ? docToRecord(doc) : null;
}

async function listRoomsForUser(userId) {
  if (!userId || typeof userId !== 'string') return [];
  const db = await getDb();
  const docs = await db.collection(COLLECTION).find({ members: userId.trim() }).toArray();
  return docs.map(docToRecord);
}

async function upsertRoom(roomObject) {
  if (!roomObject || !roomObject.id) return;
  const id = String(roomObject.id).trim();
  const record = {
    id,
    meta: roomObject.meta && typeof roomObject.meta === 'object'
      ? { ...roomObject.meta }
      : { name: '', thumbnailUrl: null, createdAt: 0, createdBy: '' },
    members: Array.isArray(roomObject.members) ? [...roomObject.members] : [],
    roles: roomObject.roles && typeof roomObject.roles === 'object' ? { ...roomObject.roles } : {},
    joinedAtByUser: roomObject.joinedAtByUser && typeof roomObject.joinedAtByUser === 'object'
      ? { ...roomObject.joinedAtByUser }
      : {},
    version: typeof roomObject.version === 'number' ? roomObject.version : 1,
    updatedAt: typeof roomObject.updatedAt === 'number' ? roomObject.updatedAt : Date.now(),
  };
  const db = await getDb();
  await db.collection(COLLECTION).updateOne(
    { id },
    { $set: record },
    { upsert: true }
  );
}

async function deleteRoom(roomId) {
  if (!roomId || typeof roomId !== 'string') return;
  const db = await getDb();
  await db.collection(COLLECTION).deleteOne({ id: roomId.trim() });
}

async function getAllRooms() {
  const db = await getDb();
  const docs = await db.collection(COLLECTION).find({}).toArray();
  return docs.map(docToRecord);
}

function hydrate() {}

module.exports = {
  hydrate,
  getRoom,
  listRoomsForUser,
  upsertRoom,
  deleteRoom,
  getAllRooms,
};
