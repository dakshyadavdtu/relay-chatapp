'use strict';

/**
 * Mailer for password reset OTP. Uses nodemailer when SMTP configured.
 * When SMTP env missing: logs [DEV OTP] email=... otp=... to console.
 */

const nodemailer = require('nodemailer');

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_SECURE = process.env.SMTP_SECURE === 'true';
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const SMTP_FROM = process.env.SMTP_FROM || (SMTP_USER ? SMTP_USER : 'noreply@localhost');

const isConfigured = !!(SMTP_HOST && SMTP_USER && SMTP_PASS);

/**
 * Send OTP email. If SMTP not configured, logs to console (dev mode).
 * @param {string} to - Recipient email
 * @param {string} otp - Plain OTP (e.g. 6 digits)
 * @returns {Promise<void>}
 */
async function sendPasswordResetOTP(to, otp) {
  if (!to || !otp) return;

  console.log('[MAIL] USER exists:', !!process.env.SMTP_USER);
  console.log('[MAIL] PASS exists:', !!process.env.SMTP_PASS);

  if (!isConfigured) {
    console.log('[DEV OTP] email=' + to + ' otp=' + otp);
    return;
  }

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
  });

  const mailOptions = {
    from: SMTP_FROM,
    to,
    subject: 'Password reset code',
    text: 'Your password reset code is: ' + otp + '. It expires in 10 minutes.',
    html: '<p>Your password reset code is: <strong>' + otp + '</strong>.</p><p>It expires in 10 minutes.</p>',
  };

  try {
    console.log('[MAIL] Sending...');
    await transporter.sendMail(mailOptions);
    console.log('[MAIL] Sent');
  } catch (err) {
    console.error('[MAIL ERROR]', err);
    throw err;
  }
}

module.exports = {
  sendPasswordResetOTP,
  isConfigured,
};
