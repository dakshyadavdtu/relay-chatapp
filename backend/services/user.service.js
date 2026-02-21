'use strict';

/**
 * User service.
 * Handles user creation, password hashing, and credential validation.
 * NEVER stores or returns plain passwords.
 */

const bcrypt = require('bcrypt');
const userStore = require('../storage/user.store');
const { ROLES } = require('../auth/roles');
const config = require('../config/constants');

const SALT_ROUNDS = 10;
const MIN_PASSWORD_LENGTH = 6;
const MIN_USERNAME_LENGTH = 3;
const MAX_USERNAME_LENGTH = 50;

/**
 * Hash a plain password. NEVER store the result alongside the plain password.
 * @param {string} plainPassword - Plain text password
 * @returns {Promise<string>} bcrypt hash
 */
async function hashPassword(plainPassword) {
  return bcrypt.hash(plainPassword, SALT_ROUNDS);
}

/**
 * Compare plain password with stored hash.
 * @param {string} plainPassword - Plain text password
 * @param {string} hash - Stored bcrypt hash
 * @returns {Promise<boolean>} True if match
 */
async function comparePassword(plainPassword, hash) {
  if (!plainPassword || !hash) return false;
  return bcrypt.compare(plainPassword, hash);
}

/**
 * Validate username for registration.
 * @param {string} username
 * @returns {{ valid: boolean, error?: string, code?: string }}
 */
function validateUsername(username) {
  if (!username || typeof username !== 'string') {
    return { valid: false, error: 'username is required', code: 'INVALID_USERNAME' };
  }
  const trimmed = username.trim();
  if (trimmed.length === 0) {
    return { valid: false, error: 'username is required', code: 'INVALID_USERNAME' };
  }
  if (trimmed.length < MIN_USERNAME_LENGTH) {
    return { valid: false, error: `username must be at least ${MIN_USERNAME_LENGTH} characters`, code: 'INVALID_USERNAME' };
  }
  if (trimmed.length > MAX_USERNAME_LENGTH) {
    return { valid: false, error: `username must be at most ${MAX_USERNAME_LENGTH} characters`, code: 'INVALID_USERNAME' };
  }
  return { valid: true };
}

/**
 * Validate password for registration.
 * @param {string} password
 * @returns {{ valid: boolean, error?: string, code?: string }}
 */
function validatePassword(password) {
  if (!password || typeof password !== 'string') {
    return { valid: false, error: 'password is required', code: 'INVALID_PASSWORD' };
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { valid: false, error: `password must be at least ${MIN_PASSWORD_LENGTH} characters`, code: 'INVALID_PASSWORD' };
  }
  return { valid: true };
}

/**
 * Register a new user. Validates, hashes password, stores. Returns sanitized user.
 * @param {Object} input - { username, password, email? }
 * @returns {Promise<Object>} { id, username, role, createdAt }
 * @throws {{ code: string }} DUPLICATE_USERNAME, DUPLICATE_EMAIL, INVALID_USERNAME, INVALID_PASSWORD
 */
async function register(input) {
  const { username, password, email } = input || {};

  const userValidation = validateUsername(username);
  if (!userValidation.valid) {
    const err = new Error(userValidation.error);
    err.code = userValidation.code;
    throw err;
  }

  const pwValidation = validatePassword(password);
  if (!pwValidation.valid) {
    const err = new Error(pwValidation.error);
    err.code = pwValidation.code;
    throw err;
  }

  const trimmedUsername = username.trim();
  const trimmedEmail = typeof email === 'string' ? email.trim() : '';
  const passwordHash = await hashPassword(password);

  const { isRootUser } = require('../auth/rootProtection');
  const initialRole = isRootUser({ email: trimmedEmail, username: trimmedUsername }) ? ROLES.ADMIN : ROLES.USER;

  try {
    const user = await userStore.create({
      username: trimmedUsername,
      email: trimmedEmail || undefined,
      passwordHash,
      role: initialRole,
    });
    return userStore.toSanitized(user);
  } catch (e) {
    if (e.code === 'DUPLICATE_USERNAME') {
      const err = new Error('Username already taken');
      err.code = 'INVALID_USERNAME';
      throw err;
    }
    if (e.code === 'DUPLICATE_EMAIL') {
      const err = new Error('Email already registered');
      err.code = 'DUPLICATE_EMAIL';
      throw err;
    }
    throw e;
  }
}

/**
 * Validate login credentials. Returns sanitized user if valid, null otherwise.
 * Accepts identifier as username OR email; backend decides based on presence of '@'.
 * @param {string} identifier - Username or email (case-insensitive)
 * @param {string} password
 * @returns {Promise<Object|null>} Sanitized user or null
 */
async function validateCredentials(identifier, password) {
  if (!identifier || typeof identifier !== 'string' || identifier.trim().length === 0) {
    return null;
  }
  if (!password || typeof password !== 'string') {
    return null;
  }

  const normalized = identifier.trim().toLowerCase();
  let user;
  if (normalized.includes('@')) {
    user = await userStore.findByEmail(normalized);
  } else {
    user = await userStore.findByUsername(normalized);
  }
  if (!user) return null;

  const match = await comparePassword(password, user.passwordHash);
  if (!match) return null;

  return userStore.toSanitized(user);
}

/**
 * Find user by id (sanitized).
 * @param {string} id
 * @returns {Promise<Object|null>}
 */
async function findById(id) {
  const user = await userStore.findById(id);
  return user ? userStore.toSanitized(user) : null;
}

/**
 * Find user by email or username (for password reset). Returns full record with email for sending OTP.
 * @param {string} emailOrUsername - Email or username
 * @returns {Promise<Object|null>} { id, username, email } or null (email may be null if user has none)
 */
async function findUserByEmailOrUsername(emailOrUsername) {
  if (!emailOrUsername || typeof emailOrUsername !== 'string') return null;
  const trimmed = emailOrUsername.trim();
  const byEmail = await userStore.findByEmail(trimmed);
  if (byEmail) return { id: byEmail.id, username: byEmail.username, email: byEmail.email || null };
  const byUsername = await userStore.findByUsername(trimmed);
  if (byUsername) return { id: byUsername.id, username: byUsername.username, email: byUsername.email || null };
  return null;
}

/**
 * Set new password for user (e.g. after OTP reset). Hashes and updates store.
 * @param {string} userId
 * @param {string} newPassword - Plain password
 * @returns {Promise<boolean>} true if updated
 */
async function updatePassword(userId, newPassword) {
  if (!userId || !newPassword || typeof newPassword !== 'string') return false;
  const pwValidation = validatePassword(newPassword);
  if (!pwValidation.valid) return false;
  const user = await userStore.findById(userId);
  if (!user) return false;
  const hash = await hashPassword(newPassword);
  return userStore.updatePasswordHash(userId, hash);
}

/**
 * DEV_SEED_ADMIN: Ensure dev_admin (ADMIN) exists for login when bypass is OFF.
 * Idempotent: does nothing if user already exists or env DEV_SEED_ADMIN is not true.
 * Password from DEV_SEED_ADMIN_PASSWORD (default: "dev_admin"). Works with file-backed store.
 */
async function ensureDevAdminUser() {
  if (process.env.DEV_SEED_ADMIN !== 'true') return;

  const existing = await userStore.findByUsername('dev_admin');
  if (existing) {
    console.log('DEV_SEED_ADMIN enabled: ensured dev_admin (ADMIN) exists');
    return;
  }

  const password = process.env.DEV_SEED_ADMIN_PASSWORD || 'dev_admin';
  const passwordHash = await hashPassword(password);
  await userStore.create({
    username: 'dev_admin',
    passwordHash,
    role: ROLES.ADMIN,
  });
  console.log('DEV_SEED_ADMIN enabled: ensured dev_admin (ADMIN) exists');
}

/**
 * Root admin bootstrap: ensure user with ROOT_ADMIN_EMAIL exists in DB with role ADMIN.
 * Idempotent: findOneAndUpdate with upsert; then ensure role ADMIN and passwordHash.
 * Requires ROOT_ADMIN_EMAIL and ROOT_ADMIN_PASSWORD in env when ROOT_ADMIN_EMAIL is set.
 */
async function ensureRootAdmin() {
  const email = (config.ROOT_ADMIN_EMAIL || '').trim().toLowerCase();
  if (!email) return;

  const password = (process.env.ROOT_ADMIN_PASSWORD || '').trim();
  if (!password) {
    console.warn('ROOT_ADMIN_EMAIL is set but ROOT_ADMIN_PASSWORD is missing; skipping root admin bootstrap.');
    return;
  }

  const rootUsername = (config.ROOT_ADMIN_USERNAME || '').trim() || undefined;
  const passwordHash = await hashPassword(password);
  const user = await userStore.ensureRootAdminUser(email, passwordHash, rootUsername);
  console.log('Root admin ensured:', user.id, user.username, user.role);
}

module.exports = {
  register,
  validateCredentials,
  findById,
  findUserByEmailOrUsername,
  updatePassword,
  hashPassword,
  comparePassword,
  validateUsername,
  validatePassword,
  ensureDevAdminUser,
  ensureRootAdmin,
};
