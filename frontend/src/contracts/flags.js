/**
 * Phase 5 Security: Mock flags guard.
 * Mock chat MUST NEVER be enabled in production builds.
 * (Mock auth removed in Phase 3; frontend always uses real backend auth.)
 */

const PROD = import.meta.env.PROD === true;
const RAW_MOCK_CHAT = import.meta.env.VITE_USE_MOCK_CHAT === "true";

/**
 * @returns {boolean} True if running a production build.
 */
export function isProd() {
  return PROD;
}

/**
 * @returns {boolean} True only in dev when VITE_USE_MOCK_CHAT=true. Always false in prod.
 */
export function allowMockChat() {
  if (PROD) return false;
  return RAW_MOCK_CHAT;
}

// Warn (dev only) if mock chat flag is set in production build - it is ignored
if (PROD && RAW_MOCK_CHAT) {
  console.warn("[SECURITY] VITE_USE_MOCK_CHAT is ignored in production builds.");
}
