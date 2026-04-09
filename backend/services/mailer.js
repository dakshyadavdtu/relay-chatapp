'use strict';

/**
 * Mailer for password reset OTP. Uses nodemailer when SMTP configured.
 * When SMTP env missing: logs [DEV OTP] email=... otp=... to console.
 */

const nodemailer = require('nodemailer');
const dns = require('dns').promises;

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_SECURE = process.env.SMTP_SECURE === 'true';
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const SMTP_FROM = process.env.SMTP_FROM || (SMTP_USER ? SMTP_USER : 'noreply@localhost');

const isConfigured = !!(SMTP_HOST && SMTP_USER && SMTP_PASS);

function maskEmail(value) {
  if (!value || typeof value !== 'string') return '(empty)';
  const normalized = value.trim().toLowerCase();
  const at = normalized.indexOf('@');
  if (at <= 1) return '***';
  return normalized.slice(0, 2) + '***' + normalized.slice(at);
}

/** True if SMTP_HOST is already an IPv4 literal (skip DNS). */
function isIPv4Literal(host) {
  if (!host || typeof host !== 'string') return false;
  const parts = host.trim().split('.');
  if (parts.length !== 4) return false;
  return parts.every((p) => {
    const n = Number(p);
    return Number.isInteger(n) && n >= 0 && n <= 255;
  });
}

/**
 * Render (and some clouds) resolve smtp.gmail.com to IPv6 but have no IPv6 egress.
 * Nodemailer does not reliably honor `family: 4` for SMTP. We resolve A records and
 * connect to IPv4, while keeping TLS SNI as the original hostname (required for Gmail).
 * @returns {{ connectHost: string, tlsServername: string }}
 */
async function resolveSmtpConnectHost(hostname) {
  const trimmed = hostname.trim();
  if (isIPv4Literal(trimmed)) {
    const sni = process.env.SMTP_TLS_SERVERNAME || trimmed;
    return { connectHost: trimmed, tlsServername: sni };
  }
  try {
    const addresses = await dns.resolve4(trimmed);
    if (addresses && addresses.length) {
      console.log('[MAIL] using IPv4 for SMTP (A record)', {
        hostname: trimmed,
        connectHost: addresses[0],
      });
      return { connectHost: addresses[0], tlsServername: trimmed };
    }
  } catch (err) {
    console.warn('[MAIL] resolve4 failed; falling back to hostname (may use IPv6)', {
      hostname: trimmed,
      message: err?.message,
      code: err?.code,
    });
  }
  return { connectHost: trimmed, tlsServername: trimmed };
}

/**
 * Send OTP email. If SMTP not configured, logs to console (dev mode).
 * @param {string} to - Recipient email
 * @param {string} otp - Plain OTP (e.g. 6 digits)
 * @returns {Promise<void>}
 */
async function sendPasswordResetOTP(to, otp) {
  if (!to || !otp) return;

  const smtpHostNow = !!process.env.SMTP_HOST;
  const smtpUserNow = !!process.env.SMTP_USER;
  const smtpPassNow = !!process.env.SMTP_PASS;
  console.log('[MAIL] env check', {
    HOST: smtpHostNow,
    USER: smtpUserNow,
    PASS: smtpPassNow,
    isConfigured,
  });

  if (!isConfigured) {
    console.log('[MAIL] SMTP not configured; send skipped', { to: maskEmail(to) });
    return;
  }

  const { connectHost, tlsServername } = await resolveSmtpConnectHost(SMTP_HOST);

  const transporter = nodemailer.createTransport({
    host: connectHost,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
    tls: {
      servername: tlsServername,
    },
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
    console.log('[MAIL] before transporter.sendMail', { to: maskEmail(to) });
    const info = await transporter.sendMail(mailOptions);
    console.log('[MAIL] after transporter.sendMail', { messageId: info && info.messageId ? info.messageId : '(none)' });
  } catch (err) {
    console.error('[MAIL ERROR]', {
      name: err?.name,
      message: err?.message,
      code: err?.code,
    });
    throw err;
  }
}

module.exports = {
  sendPasswordResetOTP,
  isConfigured,
};
