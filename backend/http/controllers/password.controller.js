'use strict';

/**
 * Password reset (OTP) controller.
 * POST /api/password/forgot, /api/password/verify, /api/password/reset
 * No auth required; avoids user enumeration on forgot.
 */

const userService = require('../../services/user.service');
const passwordResetStore = require('../../auth/passwordResetStore');
const mailer = require('../../services/mailer');
const { sendError, sendSuccess } = require('../../utils/errorResponse');

/**
 * POST /password/forgot
 * Body: { email } or { username } (one of both)
 * Returns 200 always (no enumeration). If user found and has email, sends OTP.
 */
async function forgot(req, res) {
  const { email, username } = req.body || {};
  const emailOrUsername = typeof email === 'string' && email.trim()
    ? email.trim()
    : (typeof username === 'string' && username.trim() ? username.trim() : null);

  if (!emailOrUsername) {
    return sendError(res, 400, 'Email or username is required', 'INVALID_REQUEST');
  }

  const user = await userService.findUserByEmailOrUsername(emailOrUsername);
  const targetEmail = user && user.email ? user.email.trim().toLowerCase() : null;

  if (targetEmail) {
    try {
      const { otp } = passwordResetStore.createOTPForEmail(targetEmail);
      await mailer.sendPasswordResetOTP(targetEmail, otp);
    } catch (err) {
      console.error('Password reset OTP send error:', err);
      // Still return 200 to avoid enumeration
    }
  }

  return sendSuccess(res, { ok: true });
}

/**
 * POST /password/verify
 * Body: { email, otp }
 * Returns 200 if valid, 400 if invalid/expired.
 */
async function verify(req, res) {
  const { email, otp } = req.body || {};
  if (!email || typeof email !== 'string' || !otp || typeof otp !== 'string') {
    return sendError(res, 400, 'Email and OTP are required', 'INVALID_REQUEST');
  }

  const valid = passwordResetStore.verifyOTP(email.trim(), otp.trim());
  if (!valid) {
    passwordResetStore.recordFailedAttempt(email.trim());
    return sendError(res, 400, 'Invalid or expired OTP', 'INVALID_OTP');
  }

  return sendSuccess(res, { ok: true });
}

/**
 * POST /password/reset
 * Body: { email, otp, newPassword }
 * Verifies OTP, sets new password, consumes OTP. Returns 200 or 400.
 */
async function reset(req, res) {
  const { email, otp, newPassword } = req.body || {};
  if (!email || typeof email !== 'string' || !otp || typeof otp !== 'string') {
    return sendError(res, 400, 'Email and OTP are required', 'INVALID_REQUEST');
  }
  if (!newPassword || typeof newPassword !== 'string') {
    return sendError(res, 400, 'New password is required', 'INVALID_REQUEST');
  }

  const emailNorm = email.trim().toLowerCase();
  const valid = passwordResetStore.verifyOTP(emailNorm, otp.trim());
  if (!valid) {
    passwordResetStore.recordFailedAttempt(emailNorm);
    return sendError(res, 400, 'Invalid or expired OTP', 'INVALID_OTP');
  }

  const user = await userService.findUserByEmailOrUsername(emailNorm);
  if (!user || !user.id) {
    return sendError(res, 400, 'Invalid or expired OTP', 'INVALID_OTP');
  }

  const updated = await userService.updatePassword(user.id, newPassword);
  if (!updated) {
    return sendError(res, 400, 'Password does not meet requirements', 'INVALID_PASSWORD');
  }

  passwordResetStore.consumeOTP(emailNorm);
  return sendSuccess(res, { ok: true });
}

module.exports = {
  forgot,
  verify,
  reset,
};
