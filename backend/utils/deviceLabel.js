'use strict';

/**
 * Derive a human-readable device label from User-Agent (and optionally IP).
 * Used for session list / devices UI. Simple rules: browser + OS, fallback truncated UA.
 *
 * Smoke: pass undefined/null → returns ''; pass short UA → returns truncated or parsed.
 */

const MAX_FALLBACK_LEN = 60;

/**
 * @param {string|null|undefined} userAgent - Request User-Agent
 * @returns {string} e.g. "Chrome on Windows", "Safari on macOS", or truncated UA
 */
function deviceLabel(userAgent) {
  if (userAgent == null || typeof userAgent !== 'string') return '';
  const ua = userAgent.trim();
  if (!ua) return '';

  let browser = '';
  if (ua.includes('Edg/')) browser = 'Edge';
  else if (ua.includes('Chrome/') && !ua.includes('Chromium')) browser = 'Chrome';
  else if (ua.includes('Firefox/')) browser = 'Firefox';
  else if (ua.includes('Safari/') && !ua.includes('Chrome')) browser = 'Safari';

  let os = '';
  if (ua.includes('Windows')) os = 'Windows';
  else if (ua.includes('Mac OS') || ua.includes('Macintosh')) os = 'macOS';
  else if (ua.includes('Linux')) os = 'Linux';

  if (browser && os) return `${browser} on ${os}`;
  if (browser) return browser;
  if (os) return os;
  return ua.length > MAX_FALLBACK_LEN ? ua.slice(0, MAX_FALLBACK_LEN) + '…' : ua;
}

module.exports = { deviceLabel };
