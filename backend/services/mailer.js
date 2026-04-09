'use strict';

/**
 * Password reset OTP mailer.
 * - Prefer Resend HTTP API (HTTPS :443) when RESEND_API_KEY is set — works on hosts that block outbound SMTP (e.g. Render).
 * - Else nodemailer SMTP when SMTP_HOST, SMTP_USER, SMTP_PASS are set.
 * - Else dev: log skip (no secrets in logs).
 */

const nodemailer = require('nodemailer');
const dns = require('dns').promises;

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_SECURE = process.env.SMTP_SECURE === 'true';
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const SMTP_FROM = process.env.SMTP_FROM || (SMTP_USER ? SMTP_USER : 'noreply@localhost');

function hasResend() {
  const k = process.env.RESEND_API_KEY;
  return !!(k && String(k).trim());
}

function hasSmtp() {
  return !!(SMTP_HOST && SMTP_USER && SMTP_PASS);
}

function getIsConfigured() {
  return hasResend() || hasSmtp();
}

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
 * Render: IPv6 to Gmail can be unreachable; resolve A and connect over IPv4 with correct TLS SNI.
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
 * @param {string} to
 * @param {string} subject
 * @param {string} text
 * @param {string} html
 */
async function sendViaResend(to, subject, text, html) {
  const key = String(process.env.RESEND_API_KEY).trim();
  const from = (process.env.RESEND_FROM || SMTP_FROM || '').trim();
  if (!from) {
    const err = new Error('RESEND_FROM or SMTP_FROM required when using Resend');
    err.code = 'RESEND_CONFIG';
    throw err;
  }

  console.log('[MAIL] before Resend API', { to: maskEmail(to) });
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      text,
      html,
    }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body?.message || 'Resend API request failed');
    err.code = 'RESEND_API';
    err.status = res.status;
    console.error('[MAIL ERROR]', {
      name: err.name,
      message: err.message,
      code: err.code,
      status: res.status,
    });
    throw err;
  }
  console.log('[MAIL] after Resend API', { id: body?.id || '(none)' });
}

async function sendViaSmtp(to, subject, text, html) {
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

  try {
    console.log('[MAIL] before transporter.sendMail', { to: maskEmail(to) });
    const info = await transporter.sendMail({
      from: SMTP_FROM,
      to,
      subject,
      text,
      html,
    });
    console.log('[MAIL] after transporter.sendMail', { messageId: info && info.messageId ? info.messageId : '(none)' });
  } catch (err) {
    if (err?.code === 'ETIMEDOUT' || err?.code === 'ESOCKET') {
      console.error(
        '[MAIL] SMTP connect failed (timeout/unreachable). Many PaaS block outbound SMTP; set RESEND_API_KEY + RESEND_FROM to send over HTTPS.'
      );
    }
    console.error('[MAIL ERROR]', {
      name: err?.name,
      message: err?.message,
      code: err?.code,
    });
    throw err;
  }
}

/**
 * Send OTP email.
 * @param {string} to - Recipient email
 * @param {string} otp - Plain OTP (e.g. 6 digits)
 * @returns {Promise<void>}
 */
async function sendPasswordResetOTP(to, otp) {
  if (!to || !otp) return;

  const resend = hasResend();
  const smtp = hasSmtp();
  console.log('[MAIL] env check', {
    resend,
    smtp: { HOST: !!process.env.SMTP_HOST, USER: !!process.env.SMTP_USER, PASS: !!process.env.SMTP_PASS },
    isConfigured: resend || smtp,
  });

  if (!resend && !smtp) {
    console.log('[MAIL] neither Resend nor SMTP configured; send skipped', { to: maskEmail(to) });
    return;
  }

  const subject = 'Password reset code';
  const text = 'Your password reset code is: ' + otp + '. It expires in 10 minutes.';
  const html = '<p>Your password reset code is: <strong>' + otp + '</strong>.</p><p>It expires in 10 minutes.</p>';

  if (resend) {
    await sendViaResend(to, subject, text, html);
    return;
  }

  await sendViaSmtp(to, subject, text, html);
}

module.exports = {
  sendPasswordResetOTP,
  get isConfigured() {
    return getIsConfigured();
  },
};
