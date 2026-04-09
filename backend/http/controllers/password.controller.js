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

function maskEmail(value) {
  if (!value || typeof value !== 'string') return '(empty)';
  const normalized = value.trim().toLowerCase();
  const at = normalized.indexOf('@');
  if (at <= 1) return '***';
  return normalized.slice(0, 2) + '***' + normalized.slice(at);
}

/**
 * POST /password/forgot
 * Body: { email } or { username } (one of both)
 * Returns 200 always (no enumeration). If user found and has email, sends OTP.
 */
async function forgot(req, res) {
  console.log('[OTP] forgot route entered');
  try {
    const { email, username } = req.body || {};
    const emailOrUsername = typeof email === 'string' && email.trim()
      ? email.trim()
      : (typeof username === 'string' && username.trim() ? username.trim() : null);
    console.log('[OTP] payload received', {
      email: maskEmail(email),
      usernamePresent: typeof username === 'string' && username.trim().length > 0,
    });

    if (!emailOrUsername) {
      console.log('[OTP] missing email/username -> 400');
      return sendError(res, 400, 'Email or username is required', 'INVALID_REQUEST');
    }

    const user = await userService.findUserByEmailOrUsername(emailOrUsername);
    const targetEmail = user && user.email ? user.email.trim().toLowerCase() : null;
    console.log('[OTP] user lookup result:', user ? 'FOUND' : 'NOT_FOUND');
    console.log('[OTP] resolved targetEmail:', maskEmail(targetEmail));

    if (targetEmail) {
      try {
        console.log('[OTP] before createOTPForEmail');
        const { otp } = passwordResetStore.createOTPForEmail(targetEmail);
        console.log('[OTP] after createOTPForEmail');
        console.log('[OTP] before mailer.sendPasswordResetOTP');
        await mailer.sendPasswordResetOTP(targetEmail, otp);
        console.log('[OTP] after mailer.sendPasswordResetOTP');
      } catch (err) {
        console.error('[OTP MAIL ERROR]', {
          name: err?.name,
          message: err?.message,
          code: err?.code,
        });
        // Still return 200 to avoid enumeration
      }
    } else {
      console.log('[OTP] send skipped (no target email)');
    }

    return sendSuccess(res, { ok: true });
  } catch (err) {
    console.error('[OTP ERROR]', {
      name: err?.name,
      message: err?.message,
      code: err?.code,
    });
    return res.status(500).json({ message: 'Failed to process password reset' });
  }
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

/**
 * TEMPORARY DEBUG ROUTE — POST /password/debug-mail
 * Bypasses forgot/OTP flow entirely. Tests mailer+SMTP in isolation.
 * Body: { email }
 * Returns 200 with messageId on success, 500 with structured error on failure.
 * Remove after confirming mail delivery works.
 */
async function debugMail(req, res) {
  console.log('[DEBUG-MAIL] route entered');
  const { email } = req.body || {};
  if (!email || typeof email !== 'string' || !email.trim()) {
    return res.status(400).json({ success: false, error: 'email is required' });
  }
  const to = email.trim().toLowerCase();
  console.log('[DEBUG-MAIL] target:', maskEmail(to));
  console.log('[DEBUG-MAIL] mailer.isConfigured:', mailer.isConfigured);

  if (!mailer.isConfigured) {
    console.log('[DEBUG-MAIL] SMTP not configured; cannot send');
    return res.status(500).json({ success: false, error: 'SMTP not configured', isConfigured: false });
  }

  try {
    await mailer.sendPasswordResetOTP(to, '000000');
    console.log('[DEBUG-MAIL] send succeeded');
    return res.status(200).json({ success: true, message: 'Mail sent. Check inbox + spam.' });
  } catch (err) {
    console.error('[DEBUG-MAIL] send failed', {
      name: err?.name,
      message: err?.message,
      code: err?.code,
    });
    return res.status(500).json({
      success: false,
      error: err?.message || 'sendMail failed',
      code: err?.code || null,
    });
  }
}

module.exports = {
  forgot,
  verify,
  reset,
  debugMail,
};
