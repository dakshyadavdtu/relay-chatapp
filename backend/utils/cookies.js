'use strict';

/**
 * Parse Cookie header string into key-value object
 * @param {string} cookieHeader - Raw Cookie header value
 * @returns {Object} Parsed cookies as key-value pairs
 */
function parseCookies(cookieHeader) {
  const cookies = {};

  if (!cookieHeader || typeof cookieHeader !== 'string') {
    return cookies;
  }

  const pairs = cookieHeader.split(';');

  for (const pair of pairs) {
    const trimmed = pair.trim();
    if (!trimmed) continue;

    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;

    const key = trimmed.substring(0, eqIndex).trim();
    let value = trimmed.substring(eqIndex + 1).trim();

    // Remove surrounding quotes if present
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }

    // Decode URI-encoded values safely
    try {
      cookies[key] = decodeURIComponent(value);
    } catch {
      cookies[key] = value;
    }
  }

  return cookies;
}

/**
 * Get a specific cookie value from header
 * @param {string} cookieHeader - Raw Cookie header value
 * @param {string} name - Cookie name to retrieve
 * @returns {string|null} Cookie value or null if not found
 */
function getCookie(cookieHeader, name) {
  const cookies = parseCookies(cookieHeader);
  return cookies[name] ?? null;
}

module.exports = {
  parseCookies,
  getCookie,
};
