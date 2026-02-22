'use strict';

/**
 * Idempotent root admin bootstrap: ensure a usable ROOT ADMIN user exists in the DB
 * so /api/admin/* is accessible and the admin panel can open.
 *
 * - Prefer email match (ROOT_ADMIN_EMAIL), then username match (ROOT_ADMIN_USERNAME).
 * - If found: promote to ADMIN if role !== 'ADMIN'.
 * - If not found: create user with email, username, hashed password, role ADMIN.
 * - Production: ROOT_ADMIN_EMAIL and ROOT_ADMIN_PASSWORD required; missing => throw.
 * - Non-production: if either missing => skip bootstrap (no-op).
 */

const bcrypt = require('bcrypt');
const config = require('../config/constants');
const { ROLES } = require('./roles');
const userStore = require('../storage/user.store');

const SALT_ROUNDS = 10;

/**
 * Derive a safe username from email local-part (e.g. admin@example.com -> admin).
 * @param {string} emailNorm - Normalized (lowercase) email
 * @returns {string}
 */
function deriveUsernameFromEmail(emailNorm) {
  if (!emailNorm || typeof emailNorm !== 'string') return 'root_admin';
  const local = emailNorm.split('@')[0] || '';
  const safe = local
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  const out = (safe && safe.length >= 3 && safe.length <= 50) ? safe : 'root_admin';
  return out || 'root_admin';
}

/**
 * Ensure root admin user exists: find by email or username; promote to ADMIN if needed, or create.
 * Idempotent and safe for repeated calls.
 * @throws {Error} In production if ROOT_ADMIN_EMAIL or ROOT_ADMIN_PASSWORD missing, or if bootstrap fails.
 */
async function ensureRootAdmin() {
  const isProduction = process.env.NODE_ENV === 'production';
  const email = (config.ROOT_ADMIN_EMAIL || '').trim().toLowerCase();
  const password = (config.ROOT_ADMIN_PASSWORD || '').trim();

  if (!email || !password) {
    if (isProduction) {
      throw new Error('ROOT_ADMIN_EMAIL and ROOT_ADMIN_PASSWORD are required in production');
    }
    return;
  }

  const rootUsernameProvided = (config.ROOT_ADMIN_USERNAME || '').trim();
  const rootUsername = rootUsernameProvided || deriveUsernameFromEmail(email);
  const rootUsernameNorm = rootUsername.toLowerCase();

  // Prefer email match, then username match (case-insensitive)
  let user = await userStore.findByEmail(email);
  if (!user && rootUsernameNorm) {
    user = await userStore.findByUsername(rootUsername);
  }

  if (user) {
    if (user.role !== ROLES.ADMIN) {
      const updated = await userStore.updateRole(user.id, ROLES.ADMIN);
      if (!updated) {
        if (isProduction) {
          throw new Error('ensureRootAdmin: failed to promote root user to ADMIN');
        }
      }
    }
    console.log('Root admin ensured.');
    return;
  }

  // Not found: create root admin user
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const emailForCreate = (config.ROOT_ADMIN_EMAIL || email).trim();

  await userStore.create({
    username: rootUsername,
    email: emailForCreate,
    passwordHash,
    role: ROLES.ADMIN,
  });

  console.log('Root admin ensured.');
}

module.exports = {
  ensureRootAdmin,
};
