'use strict';

/**
 * User storage layer — MongoDB. Same public API as user.store.js (async).
 * Uses shared mongo.client.js. Collection: users.
 */

const crypto = require('crypto');
const mongoClient = require('./mongo.client');
const { ROLES } = require('../auth/roles');

const COLLECTION = 'users';
let indexesEnsured = false;

async function getDb() {
  const db = await mongoClient.getDb();
  if (!indexesEnsured) {
    const col = db.collection(COLLECTION);
    await col.createIndex({ usernameLower: 1 }, { unique: true });
    await col.createIndex({ emailLower: 1 }, { unique: true, sparse: true });
    await col.createIndex({ role: 1 });
    await col.createIndex({ createdAt: -1 });
    indexesEnsured = true;
  }
  return db;
}

function docToRecord(doc) {
  if (!doc) return null;
  const { _id, ...rest } = doc;
  return { ...rest };
}

/**
 * @param {Object} user - { username, passwordHash, role, email? }
 * @returns {Promise<{ id: string, username: string, role: string, createdAt: number }>}
 */
async function create(user) {
  const username = (user.username || '').trim();
  const usernameLower = username.toLowerCase();
  const email = (user.email || '').trim();
  const emailLower = email ? email.toLowerCase() : null;
  // Unique placeholder for index when no email (avoids duplicate key on emailLower if unique index doesn't allow multiple nulls)
  const emailLowerForIndex = emailLower || `${usernameLower}+${Date.now()}@noreply.local`;

  const db = await getDb();
  const col = db.collection(COLLECTION);

  const existingByUsername = await col.findOne({ usernameLower });
  if (existingByUsername) {
    const err = new Error('Username already exists');
    err.code = 'DUPLICATE_USERNAME';
    throw err;
  }
  if (emailLower) {
    const existingByEmail = await col.findOne({ emailLower });
    if (existingByEmail) {
      const err = new Error('Email already registered');
      err.code = 'DUPLICATE_EMAIL';
      throw err;
    }
  }

  const id = crypto.randomUUID();
  const now = Date.now();
  const record = {
    id,
    username,
    usernameLower,
    email: email || null,
    emailLower: emailLowerForIndex,
    passwordHash: user.passwordHash,
    role: user.role || ROLES.USER,
    createdAt: now,
    updatedAt: now,
    bannedAt: null,
    displayName: null,
    avatarUrl: null,
    uiPreferences: {
      soundNotifications: true,
      desktopNotifications: false,
    },
  };
  await col.insertOne(record);
  return { id: record.id, username: record.username, role: record.role, createdAt: record.createdAt };
}

/**
 * @param {string} userId
 * @param {string} role
 * @param {string} [email] - Optional; if omitted, uses userId + '@dev.local' to avoid unique index on emailLower.
 * @returns {Promise<{ id: string, username: string, role: string, createdAt: number }>}
 */
async function createDevUser(userId, role, email) {
  const id = String(userId || '').trim();
  const username = id || 'dev_anon';
  const usernameLower = username.toLowerCase();
  const r = role && ['USER', 'ADMIN'].includes(role) ? role : ROLES.USER;
  const emailVal = email != null && String(email).trim()
    ? String(email).trim()
    : (id ? `${id}@dev.local` : null);
  const emailLowerVal = emailVal ? emailVal.toLowerCase() : null;

  const db = await getDb();
  const col = db.collection(COLLECTION);

  const existing = await col.findOne({ id });
  if (existing) {
    await col.updateOne({ id }, { $set: { role: r, updatedAt: Date.now() } });
    const updated = await col.findOne({ id });
    return {
      id: updated.id,
      username: updated.username,
      role: updated.role,
      createdAt: updated.createdAt,
      banned: !!(updated.bannedAt != null && updated.bannedAt > 0),
    };
  }

  const byUsername = await col.findOne({ usernameLower });
  if (byUsername && byUsername.id !== id) {
    const err = new Error('Username conflict for dev user');
    err.code = 'DUPLICATE_USERNAME';
    throw err;
  }

  const now = Date.now();
  const record = {
    id,
    username,
    usernameLower,
    email: emailVal,
    emailLower: emailLowerVal,
    passwordHash: 'dev-no-password-check',
    role: r,
    createdAt: now,
    updatedAt: now,
    bannedAt: null,
    displayName: null,
    avatarUrl: null,
    uiPreferences: {
      soundNotifications: true,
      desktopNotifications: false,
    },
  };
  await col.insertOne(record);
  return { id: record.id, username: record.username, role: record.role, createdAt: record.createdAt };
}

async function findById(id) {
  if (!id || typeof id !== 'string') return null;
  const db = await getDb();
  const doc = await db.collection(COLLECTION).findOne({ id: id.trim() });
  return doc ? docToRecord(doc) : null;
}

/** Filter out soft-deleted users for login/discovery. */
const notDeleted = { $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }] };

async function findByUsername(username) {
  if (!username || typeof username !== 'string') return null;
  const usernameLower = username.trim().toLowerCase();
  const db = await getDb();
  const doc = await db.collection(COLLECTION).findOne({ usernameLower, ...notDeleted });
  return doc ? docToRecord(doc) : null;
}

async function findByEmail(email) {
  if (!email || typeof email !== 'string') return null;
  const emailLower = email.trim().toLowerCase();
  const db = await getDb();
  const doc = await db.collection(COLLECTION).findOne({ emailLower, ...notDeleted });
  return doc ? docToRecord(doc) : null;
}

async function listAll() {
  const db = await getDb();
  const docs = await db.collection(COLLECTION).find(notDeleted).toArray();
  return docs.map((d) => toSanitized(docToRecord(d))).filter(Boolean);
}

async function listAllWithEmail() {
  const db = await getDb();
  const docs = await db.collection(COLLECTION).find(notDeleted).toArray();
  return docs.map((d) => {
    const r = docToRecord(d);
    return {
      id: r.id,
      email: r.email ?? null,
      username: r.username,
      role: r.role || ROLES.USER,
      createdAt: r.createdAt,
      displayName: r.displayName ?? null,
      avatarUrl: r.avatarUrl ?? null,
    };
  });
}

function toSanitized(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    role: user.role || ROLES.USER,
    createdAt: user.createdAt,
    banned: !!(user.bannedAt != null && user.bannedAt > 0),
  };
}

async function setBanned(userId) {
  if (!userId || typeof userId !== 'string') return false;
  const db = await getDb();
  const r = await db.collection(COLLECTION).updateOne(
    { id: userId.trim() },
    { $set: { bannedAt: Date.now(), updatedAt: Date.now() } }
  );
  return r.matchedCount > 0;
}

async function setUnbanned(userId) {
  if (!userId || typeof userId !== 'string') return false;
  const db = await getDb();
  const r = await db.collection(COLLECTION).updateOne(
    { id: userId.trim() },
    { $set: { bannedAt: null, updatedAt: Date.now() } }
  );
  return r.matchedCount > 0;
}

async function isBanned(userId) {
  if (!userId || typeof userId !== 'string') return false;
  const u = await findById(userId.trim());
  return !!(u && u.bannedAt != null && u.bannedAt > 0);
}

async function updatePasswordHash(userId, passwordHash) {
  if (!userId || typeof userId !== 'string' || !passwordHash) return false;
  const db = await getDb();
  const r = await db.collection(COLLECTION).updateOne(
    { id: userId.trim() },
    { $set: { passwordHash, updatedAt: Date.now() } }
  );
  return r.matchedCount > 0;
}

async function updateProfile(userId, patch) {
  if (!userId || typeof userId !== 'string' || !patch || typeof patch !== 'object') return false;
  const u = await findById(userId.trim());
  if (!u) return false;
  const updates = {};
  if (patch.hasOwnProperty('displayName')) {
    updates.displayName = patch.displayName === null || patch.displayName === '' ? null : String(patch.displayName).trim();
  }
  if (patch.hasOwnProperty('avatarUrl')) {
    updates.avatarUrl = patch.avatarUrl === null || patch.avatarUrl === '' ? null : String(patch.avatarUrl).trim();
  }
  if (Object.keys(updates).length === 0) return true;
  updates.updatedAt = Date.now();
  const db = await getDb();
  const r = await db.collection(COLLECTION).updateOne({ id: userId.trim() }, { $set: updates });
  return r.matchedCount > 0;
}

/**
 * Soft-delete a user: set deletedAt, bannedAt, anonymize profile; prevent login and uniqueness collisions.
 * @param {string} userId
 * @returns {Promise<Object|null>} Updated record or null if not found
 */
async function softDeleteUser(userId) {
  if (!userId || typeof userId !== 'string') return null;
  const id = userId.trim();
  const db = await getDb();
  const user = await db.collection(COLLECTION).findOne({ id });
  if (!user) return null;
  if (user.deletedAt != null && user.deletedAt > 0) return null;
  const now = Date.now();
  const first8 = id.slice(0, 8);
  const deletedUsername = `deleted_${first8}`;
  const deletedUsernameLower = `deleted_${id}`;
  const deletedEmailLower = `deleted_${id}@deleted.local`;
  const update = {
    $set: {
      deletedAt: now,
      bannedAt: now,
      email: null,
      emailLower: deletedEmailLower,
      username: deletedUsername,
      usernameLower: deletedUsernameLower,
      displayName: 'Deleted User',
      avatarUrl: null,
      updatedAt: now,
    },
  };
  const r = await db.collection(COLLECTION).updateOne({ id }, update);
  if (r.matchedCount === 0) return null;
  const doc = await db.collection(COLLECTION).findOne({ id });
  return doc ? docToRecord(doc) : null;
}

async function updateRole(userId, role) {
  if (!userId || typeof userId !== 'string' || !role || typeof role !== 'string') return false;
  if (!['USER', 'ADMIN'].includes(role)) return false;
  const db = await getDb();
  const r = await db.collection(COLLECTION).updateOne(
    { id: userId.trim() },
    { $set: { role, updatedAt: Date.now() } }
  );
  return r.matchedCount > 0;
}

const UI_PREFS_DEFAULTS = {
  soundNotifications: true,
  desktopNotifications: false,
};

/**
 * Get UI preferences for a user (or defaults if missing).
 * @param {string} userId
 * @returns {Promise<{ soundNotifications: boolean, desktopNotifications: boolean }>}
 */
async function getUiPreferences(userId) {
  if (!userId || typeof userId !== 'string') return UI_PREFS_DEFAULTS;
  const db = await getDb();
  const doc = await db.collection(COLLECTION).findOne({ id: userId.trim() }, { projection: { uiPreferences: 1 } });
  if (!doc || !doc.uiPreferences || typeof doc.uiPreferences !== 'object') {
    return UI_PREFS_DEFAULTS;
  }
  return {
    soundNotifications: typeof doc.uiPreferences.soundNotifications === 'boolean' ? doc.uiPreferences.soundNotifications : UI_PREFS_DEFAULTS.soundNotifications,
    desktopNotifications: typeof doc.uiPreferences.desktopNotifications === 'boolean' ? doc.uiPreferences.desktopNotifications : UI_PREFS_DEFAULTS.desktopNotifications,
  };
}

/**
 * Patch UI preferences for a user (only known boolean keys allowed).
 * @param {string} userId
 * @param {Object} patch - { soundNotifications?: boolean, desktopNotifications?: boolean }
 * @returns {Promise<boolean>} - true if updated, false if user not found or invalid patch
 */
async function patchUiPreferences(userId, patch) {
  if (!userId || typeof userId !== 'string' || !patch || typeof patch !== 'object') return false;
  const updates = {};
  if (patch.hasOwnProperty('soundNotifications')) {
    if (typeof patch.soundNotifications !== 'boolean') return false;
    updates['uiPreferences.soundNotifications'] = patch.soundNotifications;
  }
  if (patch.hasOwnProperty('desktopNotifications')) {
    if (typeof patch.desktopNotifications !== 'boolean') return false;
    updates['uiPreferences.desktopNotifications'] = patch.desktopNotifications;
  }
  if (Object.keys(updates).length === 0) return true; // No changes
  updates.updatedAt = Date.now();
  const db = await getDb();
  const r = await db.collection(COLLECTION).updateOne({ id: userId.trim() }, { $set: updates });
  return r.matchedCount > 0;
}

async function clear() {
  const db = await getDb();
  await db.collection(COLLECTION).deleteMany({});
}

/** Operators that modify field paths (used for conflict detection). */
const UPDATE_PATH_OPERATORS = [
  '$set', '$setOnInsert', '$unset', '$inc', '$addToSet', '$push', '$pull',
  '$min', '$max', '$rename',
];

/**
 * Collect all top-level and dotted paths from an object (one level only for $set keys).
 * For nested objects like { a: 1, b: { c: 2 } }, returns ['a', 'b'] only unless recurse.
 * For conflict check we need full dotted paths: recurse into plain objects.
 * @param {Object} obj
 * @param {string} prefix
 * @returns {string[]}
 */
function collectPathsFromValue(obj, prefix = '') {
  if (obj == null || typeof obj !== 'object') return prefix ? [prefix] : [];
  const isPlain =
    Object.prototype.toString.call(obj) === '[object Object]' &&
    !(obj instanceof Date);
  if (!isPlain) return prefix ? [prefix] : [];
  const paths = [];
  for (const key of Object.keys(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const val = obj[key];
    if (val != null && typeof val === 'object' && !(val instanceof Date) &&
        Object.prototype.toString.call(val) === '[object Object]') {
      paths.push(...collectPathsFromValue(val, path));
    } else {
      paths.push(path);
    }
  }
  return paths;
}

/**
 * Collect modified paths per operator from an update document.
 * @param {Object} updateDoc - e.g. { $set: {...}, $setOnInsert: {...} }
 * @returns {Map<string, string>} path -> operator name (first operator that sets it)
 */
function collectUpdatePathsByOperator(updateDoc) {
  const pathToOp = new Map();
  for (const op of UPDATE_PATH_OPERATORS) {
    const val = updateDoc[op];
    if (val == null || typeof val !== 'object') continue;
    let paths = [];
    if (op === '$unset') {
      paths = Object.keys(val);
    } else if (op === '$rename') {
      paths = [...Object.keys(val), ...Object.values(val).filter((v) => typeof v === 'string')];
    } else {
      paths = collectPathsFromValue(val);
    }
    for (const p of paths) {
      const normalized = String(p).trim();
      if (!normalized) continue;
      if (pathToOp.has(normalized)) {
        throw new Error(
          `Conflicting Mongo update paths: ${normalized} conflicts with ${normalized} (operators: ${pathToOp.get(normalized)}, ${op})`
        );
      }
      pathToOp.set(normalized, op);
    }
  }
  return pathToOp;
}

/**
 * Check for prefix conflicts: one path is a strict prefix of another (e.g. "role" and "role.name").
 * @param {string[]} paths
 * @param {Map<string, string>} pathToOp - path -> operator name
 * @returns {void}
 */
function assertNoPrefixConflicts(paths, pathToOp) {
  for (let i = 0; i < paths.length; i++) {
    for (let j = 0; j < paths.length; j++) {
      if (i === j) continue;
      const a = paths[i];
      const b = paths[j];
      if (a.startsWith(b + '.')) {
        throw new Error(
          `Conflicting Mongo update paths: ${a} conflicts with ${b} (operators: ${pathToOp.get(a)}, ${pathToOp.get(b)})`
        );
      }
    }
  }
}

/**
 * Guardrail: throw before findOneAndUpdate if the update doc has the same path in multiple
 * operators or prefix conflicts (e.g. role and role.name).
 * @param {Object} updateDoc - The update object passed to findOneAndUpdate
 * @throws {Error} If any path appears in more than one operator or has a prefix conflict
 */
function assertNoConflictingUpdatePaths(updateDoc) {
  if (!updateDoc || typeof updateDoc !== 'object') return;
  const pathToOp = collectUpdatePathsByOperator(updateDoc);
  const paths = [...pathToOp.keys()];
  assertNoPrefixConflicts(paths, pathToOp);
}

/**
 * Idempotent root admin bootstrap: ensure user with email exists with role ADMIN.
 * - If not exists: insert with id, username (rootUsername or emailNorm), email, passwordHash, role ADMIN.
 * - If exists: only refresh updatedAt; do NOT rewrite role (role is set only on insert).
 * @param {string} emailNorm - Normalized (lowercase) email
 * @param {string} passwordHash - Bcrypt hash for password
 * @param {string} [rootUsername] - Username for root (e.g. daksh_root); used on insert
 * @returns {Promise<{ id: string, username: string, role: string }>}
 */
async function ensureRootAdminUser(emailNorm, passwordHash, rootUsername) {
  if (!emailNorm || typeof emailNorm !== 'string' || !passwordHash) {
    throw new Error('ensureRootAdminUser requires emailNorm and passwordHash');
  }
  const db = await getDb();
  const col = db.collection(COLLECTION);
  const now = Date.now();
  const username = (rootUsername && String(rootUsername).trim()) || emailNorm;
  const usernameLower = username.toLowerCase();
  const id = crypto.randomUUID();
  const setOnInsertDoc = {
    id,
    username,
    usernameLower,
    email: emailNorm,
    emailLower: emailNorm,
    passwordHash,
    role: ROLES.ADMIN,
    createdAt: now,
    bannedAt: null,
    displayName: null,
    avatarUrl: null,
    uiPreferences: {
      soundNotifications: true,
      desktopNotifications: false,
    },
  };

  const update = {
    $set: { updatedAt: now },
    $setOnInsert: setOnInsertDoc,
  };
  assertNoConflictingUpdatePaths(update);

  const result = await col.findOneAndUpdate(
    { emailLower: emailNorm },
    update,
    { upsert: true, returnDocument: 'after' }
  );
  const doc = result && (result.value !== undefined ? result.value : result);
  if (!doc) {
    const existing = await col.findOne({ emailLower: emailNorm });
    if (!existing) throw new Error('ensureRootAdminUser: upsert failed');
    const needHash = !existing.passwordHash || existing.passwordHash === 'dev-no-password-check';
    if (needHash) {
      await col.updateOne(
        { emailLower: emailNorm },
        { $set: { passwordHash, updatedAt: Date.now() } }
      );
    }
    return {
      id: existing.id,
      username: existing.username,
      role: ROLES.ADMIN,
    };
  }
  const needHash = !doc.passwordHash || doc.passwordHash === 'dev-no-password-check';
  if (needHash) {
    await col.updateOne(
      { emailLower: emailNorm },
      { $set: { passwordHash, updatedAt: Date.now() } }
    );
  }
  return {
    id: doc.id,
    username: doc.username,
    role: doc.role || ROLES.ADMIN,
  };
}

module.exports = {
  create,
  createDevUser,
  ensureRootAdminUser,
  findById,
  findByUsername,
  findByEmail,
  listAll,
  listAllWithEmail,
  toSanitized,
  setBanned,
  setUnbanned,
  isBanned,
  updatePasswordHash,
  updateProfile,
  updateRole,
  softDeleteUser,
  getUiPreferences,
  patchUiPreferences,
  clear,
};
