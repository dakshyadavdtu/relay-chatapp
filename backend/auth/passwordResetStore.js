'use strict';

/**
 * In-memory OTP store for password reset. TTL per entry; single-use after verify.
 * Map<normalizedEmail, { otpHash, expiresAt, attempts }>
 */

const crypto = require('crypto');

const TTL_MS = 10 * 60 * 1000; // 10 min
const MAX_ATTEMPTS = 5;

/** @type {Map<string, { otpHash: string, expiresAt: number, attempts: number }>} */
const store = new Map();

function normalizeEmail(email) {
  if (!email || typeof email !== 'string') return '';
  return email.trim().toLowerCase();
}

function hashOtp(otp) {
  return crypto.createHash('sha256').update(otp).digest('hex');
}

/**
 * Generate a 6-digit OTP string.
 * @returns {string}
 */
function createOTP() {
  const n = crypto.randomInt(0, 1e6);
  return String(n).padStart(6, '0');
}

/**
 * Store OTP for email (hashed). Overwrites any existing. Returns plain OTP for sending.
 * @param {string} email - Target email (normalized internally)
 * @returns {{ otp: string, expiresAt: number }}
 */
function createOTPForEmail(email) {
  const key = normalizeEmail(email);
  if (!key) throw new Error('Email required');
  const otp = createOTP();
  const otpHash = hashOtp(otp);
  const expiresAt = Date.now() + TTL_MS;
  store.set(key, { otpHash, expiresAt, attempts: 0 });
  return { otp, expiresAt };
}

/**
 * Verify OTP for email. Does not consume (use consumeOTP after reset).
 * @param {string} email - Email (normalized internally)
 * @param {string} otp - Plain OTP
 * @returns {boolean} true if valid and not expired
 */
function verifyOTP(email, otp) {
  const key = normalizeEmail(email);
  if (!key || !otp || typeof otp !== 'string') return false;
  const entry = store.get(key);
  if (!entry) return false;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return false;
  }
  if (entry.attempts >= MAX_ATTEMPTS) {
    store.delete(key);
    return false;
  }
  const hash = hashOtp(otp.trim());
  return hash === entry.otpHash;
}

/**
 * Consume OTP (remove from store). Call after successful reset.
 * @param {string} email - Email (normalized internally)
 */
function consumeOTP(email) {
  const key = normalizeEmail(email);
  if (key) store.delete(key);
}

/**
 * Increment attempt count (call on failed verify). Removes entry if MAX_ATTEMPTS.
 * @param {string} email
 */
function recordFailedAttempt(email) {
  const key = normalizeEmail(email);
  const entry = store.get(key);
  if (!entry) return;
  entry.attempts += 1;
  if (entry.attempts >= MAX_ATTEMPTS) store.delete(key);
  else store.set(key, entry);
}

module.exports = {
  createOTP,
  createOTPForEmail,
  verifyOTP,
  consumeOTP,
  recordFailedAttempt,
  TTL_MS,
};
