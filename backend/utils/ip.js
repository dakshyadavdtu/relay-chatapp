'use strict';

/**
 * IP normalization and capture for consistent display and storage.
 * - On localhost dev: 127.0.0.1 (not ::1, not ::ffff:127.0.0.1).
 * - Behind proxy: first client IP from X-Forwarded-For.
 * - Session store and API responses use normalized IP only (no port).
 */

/**
 * Normalize a raw IP string (or array from headers) to a display/storage value.
 * @param {string|string[]|null|undefined} raw - Header value or socket.remoteAddress
 * @returns {string|null} Normalized IP or null if empty/unknown
 */
function normalizeIp(raw) {
  if (raw == null) return null;
  let s;
  if (Array.isArray(raw)) {
    s = raw.length ? String(raw[0]).trim() : '';
  } else {
    s = typeof raw === 'string' ? raw.trim() : String(raw).trim();
  }
  if (!s || s === 'unknown') return null;

  // X-Forwarded-For can be "client, proxy1, proxy2" — take first
  if (s.includes(',')) {
    s = s.split(',')[0].trim();
  }
  if (!s) return null;

  // IPv6 loopback -> IPv4 loopback for consistent dev display
  if (s === '::1') return '127.0.0.1';
  // [::1]:PORT or :::1:PORT (local dev with port)
  if (/^\[::1\]:\d+$/.test(s) || /^:::?1(:\d+)?$/.test(s)) return '127.0.0.1';

  // Strip IPv4-mapped prefix (::ffff:127.0.0.1 -> 127.0.0.1)
  if (s.toLowerCase().startsWith('::ffff:')) {
    s = s.slice(7).trim();
  }
  if (!s) return null;

  // IPv4 with port (e.g. 127.0.0.1:52311) — strip :PORT only if port is numeric
  const ipv4PortMatch = s.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}):(\d+)$/);
  if (ipv4PortMatch && /^\d+$/.test(ipv4PortMatch[2])) {
    s = ipv4PortMatch[1];
  }

  return s || null;
}

/**
 * Get client IP from Express HTTP request.
 * Priority: 1) x-forwarded-for, 2) x-real-ip, 3) req.ip, 4) req.socket?.remoteAddress.
 * @param {import('express').Request} req
 * @returns {string|null} Normalized IP or null
 */
function getClientIpFromReq(req) {
  if (!req || typeof req !== 'object') return null;
  const headers = req.headers || {};
  const forwarded = headers['x-forwarded-for'];
  if (forwarded != null) {
    const out = normalizeIp(forwarded);
    if (out) return out;
  }
  const realIp = headers['x-real-ip'];
  if (realIp != null) {
    const out = normalizeIp(realIp);
    if (out) return out;
  }
  const reqIp = req.ip;
  if (reqIp != null) {
    const out = normalizeIp(reqIp);
    if (out) return out;
  }
  const socketAddr = req.socket && req.socket.remoteAddress;
  return normalizeIp(socketAddr);
}

/**
 * Get client IP from WebSocket upgrade request (same semantics as HTTP).
 * @param {import('http').IncomingMessage} request - The HTTP upgrade request
 * @returns {string|null} Normalized IP or null
 */
function getClientIpFromWsRequest(request) {
  if (!request || typeof request !== 'object') return null;
  const headers = request.headers || {};
  const forwarded = headers['x-forwarded-for'];
  if (forwarded != null) {
    const out = normalizeIp(forwarded);
    if (out) return out;
  }
  const realIp = headers['x-real-ip'];
  if (realIp != null) {
    const out = normalizeIp(realIp);
    if (out) return out;
  }
  const socket = request.socket ?? request.connection;
  const fallback = socket && socket.remoteAddress;
  return normalizeIp(fallback);
}

module.exports = {
  normalizeIp,
  getClientIpFromReq,
  getClientIpFromWsRequest,
};
